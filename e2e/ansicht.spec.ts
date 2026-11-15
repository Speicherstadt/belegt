import AxeBuilder from "@axe-core/playwright";
import { expect, request, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

const docx = () =>
  Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>Angebot</w:t></w:r></w:p></w:body></w:document>",
      ),
    }),
  );

test("eine Word-Datei zeigt ihre Ansicht als PDF und sagt, dass das Original maßgeblich ist", async ({
  page,
}, info) => {
  const name = `angebot-${info.project.name}.docx`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/octet-stream", buffer: docx() });
  const link = page.getByRole("link", { name });
  const id = (await link.getAttribute("href"))!.split("/").pop()!;
  // Der Worker (hier der E2E-Server mit nachgebautem Dienst) erzeugt die Ansicht kurz nach dem Hochladen
  await expect.poll(async () => (await (await page.request.get(`/api/dokumente/${id}`)).json()).ansicht).toBe(true);

  await link.click();
  const vorschau = page.getByRole("region", { name: "Vorschau" });
  await expect(vorschau).toContainText("Ansicht als PDF, aus dem Original erzeugt.");
  await expect(vorschau.locator("iframe")).toHaveAttribute("src", `/api/dokumente/${id}/ansicht`);
  await expect(page.getByRole("link", { name: "Original herunterladen" })).toHaveAttribute(
    "href",
    `/api/dokumente/${id}/datei`,
  );
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("iframe").analyze();
  expect(axe.violations).toEqual([]);
});

test("„Öffnen mit …“ öffnet die App in einem neuen Tab mit einem Link auf das Original", async ({
  page,
  context,
}, info) => {
  const name = `vertrag-${info.project.name}.docx`;
  // Einmal gebaut: das ZIP enthält die Uhrzeit
  const original = docx();
  await context.route("https://office.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Office</title><p>Office</p>" }),
  );
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/octet-stream", buffer: original });
  await page.getByRole("link", { name }).click();

  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "Öffnen mit Office im Browser" }).click(),
  ]);
  await tab.waitForURL(/^https:\/\/office\.example\/oeffnen\?/);
  const adresse = new URL(tab.url());
  expect(adresse.searchParams.get("name")).toBe(name);
  const link = adresse.searchParams.get("datei")!;
  expect(link).toMatch(/\/api\/freigabe\/[A-Za-z0-9_-]{43}$/);
  // Der Link liefert das Original ohne Anmeldung
  const ohneSitzung = await request.newContext();
  const datei = await ohneSitzung.get(link);
  expect(datei.status()).toBe(200);
  expect(Buffer.from(await datei.body())).toEqual(original);
  await ohneSitzung.dispose();
});
