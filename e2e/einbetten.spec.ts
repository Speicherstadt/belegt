import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test("im Frame der erlaubten Seite: Design von dort, Nachrichten nur zwischen beiden", async ({ browser, baseURL }) => {
  const kontext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const seite = await kontext.newPage();
  // Die einbettende Seite als echter Server: Chromium lässt eine nur nachgebaute Seite (route) als „öffentlich“
  // nicht auf localhost zugreifen (Local Network Access); in Betrieb liegen beide unter derselben Domain
  const html = `<!doctype html><title>Portal</title>
    <iframe id="belegt" title="Belegt" src="${baseURL}/?embedded=1" style="width:900px;height:700px"></iframe>
    <script>
      window.nachrichten = [];
      addEventListener("message", (e) => {
        window.nachrichten.push({ origin: e.origin, data: e.data });
        if (e.data && e.data.type === "ready")
          document.getElementById("belegt").contentWindow.postMessage({ type: "theme", theme: "dark" }, "${new URL(baseURL!).origin}");
      });
    </script>`;
  const portal = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  });
  await new Promise<void>((ok) => portal.listen(5199, "127.0.0.1", ok));
  try {
    await seite.goto("http://localhost:5199/");
    const frame = seite.frameLocator("#belegt");
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
    const nachrichten = await seite.evaluate(
      () =>
        (
          window as unknown as {
            nachrichten: { origin: string; data: { source: string; type: string; path?: string } }[];
          }
        ).nachrichten,
    );
    // Alles, was ankam, kam von Belegt aus dem Frame unter seinem Origin
    expect(nachrichten.every((n) => n.origin === new URL(baseURL!).origin && n.data.source === "belegt")).toBe(true);
    expect(nachrichten.map((n) => n.data.type)).toEqual(expect.arrayContaining(["ready", "route"]));
    expect(nachrichten.find((n) => n.data.type === "route")?.data.path).toMatch(/^\//);
  } finally {
    await kontext.close();
    await new Promise<void>((ok) => portal.close(() => ok()));
  }
});
