import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
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
  await page.goto("/");
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
