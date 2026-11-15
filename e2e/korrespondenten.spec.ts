import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const axe = (page: Page) =>
  new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function barrierefrei(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
}

const abschnitt = (page: Page, name: string) =>
  page.locator("section", { has: page.getByRole("heading", { name, exact: true }) });

test("Korrespondent mit Zuordnungsregel anlegen, Dokument hochladen, Vorschlag übernehmen", async ({ page }, info) => {
  const projekt = info.project.name;
  const korrespondent = `Kornblume ${projekt}`;
  const wort = `kornblume${projekt.replace(/\W/g, "")}`;
  const name = `brief-${projekt}.txt`;

  await page.goto("/ordnung");
  const liste = abschnitt(page, "Korrespondenten");
  await liste.getByLabel("Neuer Korrespondent").fill(korrespondent);
  await liste.getByRole("combobox", { name: "Zuordnung" }).selectOption("irgendein_wort");
  await liste.getByLabel("Text", { exact: true }).fill(wort);
  await liste.getByRole("button", { name: "Korrespondent anlegen" }).click();
  await expect(liste.getByRole("listitem").filter({ hasText: korrespondent })).toContainText(
    `0 Dokumente · Irgendein Wort: ${wort}`,
  );
  await barrierefrei(page);

  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(`Grüße von ${wort.toUpperCase()}`) });
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  const id = (await link.getAttribute("href"))!.split("/").pop()!;
  // Der Worker liest den Text und wertet dann die Regeln aus
  await expect
    .poll(
      async () => (await (await page.request.get(`/api/dokumente/${id}/vorschlag`)).json()).zuordnung?.korrespondent,
    )
    .toMatchObject({ name: korrespondent });

  await link.click();
  const vorschlag = page.getByText("Vorschlag der Zuordnungsregeln:").locator("..");
  await expect(vorschlag).toContainText(`Korrespondent ${korrespondent}`);
  await barrierefrei(page);
  await vorschlag.getByRole("button", { name: "Übernehmen" }).click();
  const ordnung = abschnitt(page, "Ordnung");
  await expect(ordnung.getByRole("combobox", { name: "Korrespondent", exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await expect(
    ordnung.getByRole("combobox", { name: "Korrespondent", exact: true }).locator("option:checked"),
  ).toHaveText(korrespondent);
  await expect(abschnitt(page, "Verlauf")).toContainText(`Korrespondent gesetzt: ${korrespondent}`);
  // Das Formular der Einordnung nimmt den Namen aus der Liste
  await expect(page.getByLabel("Korrespondent (optional)")).toHaveValue(korrespondent);

  // Im Archiv als Chip, der auf alle Dokumente des Korrespondenten filtert
  await page.goto("/archiv");
  await page
    .getByRole("link", { name: `Alle Dokumente von ${korrespondent}` })
    .first()
    .click();
  await expect(page).toHaveURL(/korrespondent=/);
  await expect(page.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Korrespondent", exact: true })).toHaveValue(/[0-9a-f-]{36}/);
  await barrierefrei(page);
});

test("zwei Schreibweisen zusammenführen; die Einordnung behält den Text", async ({ page }, info) => {
  const projekt = info.project.name;
  const [kurz, lang] = [`Lindenhof ${projekt}`, `Lindenhof GmbH ${projekt}`];
  const r = page.request;
  const hoch = async (name: string, korrespondent: string) => {
    const res = await r.post("/api/dokumente", {
      multipart: { datei: { name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) } },
    });
    const { id } = (await res.json()) as { id: string };
    expect(
      (
        await r.post(`/api/dokumente/${id}/einordnung`, {
          data: { art: "beleg", entstanden: "2026-05-01", korrespondent },
        })
      ).status(),
    ).toBe(201);
    return id;
  };
  await hoch(`linden-1-${projekt}.pdf`, kurz);
  const zweites = await hoch(`linden-2-${projekt}.pdf`, lang);

  await page.goto("/ordnung");
  const liste = abschnitt(page, "Korrespondenten");
  await liste.getByRole("button", { name: `„${lang}“ zusammenführen` }).click();
  await liste.getByRole("combobox", { name: `„${lang}“ aufgehen lassen in` }).selectOption({ label: kurz });
  await barrierefrei(page);
  await liste.getByRole("button", { name: "Zusammenführen", exact: true }).click();
  await expect(liste.getByRole("listitem").filter({ hasText: lang })).toHaveCount(0);
  await expect(liste.getByRole("listitem").filter({ hasText: kurz })).toContainText("2 Dokumente");

  await page.goto(`/dokumente/${zweites}`);
  await expect(
    abschnitt(page, "Ordnung").getByRole("combobox", { name: "Korrespondent", exact: true }).locator("option:checked"),
  ).toHaveText(kurz);
  // Der Verlauf zeigt den Namen, wie ihn die versiegelte Einordnung festhält
  await expect(abschnitt(page, "Verlauf")).toContainText(`Eingeordnet (Korrespondent: ${lang})`);
  await barrierefrei(page);
});
