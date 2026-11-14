import { expect, test } from "@playwright/test";

test("ein API-Token nimmt ohne Anmeldung ein Dokument auf, bis es widerrufen ist", async ({ page, browser }, info) => {
  const name = `Scanner ${info.project.name}`;
  await page.goto("/quellen");
  const bereich = page.getByRole("region", { name: "API-Tokens" });
  await bereich.getByLabel("Name").fill(name);
  await bereich.getByLabel("Recht").selectOption("schreiben");
  await bereich.getByRole("button", { name: "Token anlegen" }).click();
  const token = (await bereich.getByRole("status").locator("code").textContent())!;
  expect(token).toMatch(/^belegt_/);

  const programm = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const datei = `api-${info.project.name}.pdf`;
    const res = await programm.request.post("/api/dokumente", {
      headers: { authorization: `Bearer ${token}` },
      multipart: { datei: { name: datei, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n% per API\n") } },
    });
    expect(res.status()).toBe(201);

    await page.goto("/");
    await expect(page.getByRole("link", { name: datei })).toBeVisible();

    await page.goto("/quellen");
    await bereich.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Widerrufen" }).click();
    await expect(bereich.getByRole("listitem").filter({ hasText: name })).toContainText("widerrufen");
    const danach = await programm.request.get("/api/dokumente", { headers: { authorization: `Bearer ${token}` } });
    expect(danach.status()).toBe(401);
  } finally {
    await programm.close();
  }
});
