import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

/*
 * Betrieb: Der E2E-Server läuft als eigene App-Rolle (e2e/server.ts), die Oberfläche zeigt das als getrennte Rollen.
 * Den Stand der Sicherung trägt hier der Test ein, wie es der Backup-Container mit dem Eigentümerzugang tut.
 */
const basis = process.env.E2E_DATABASE_URL ?? "postgres://belegt:belegt@localhost:5432/belegt_e2e";

test.beforeAll(async () => {
  const sql = postgres(basis, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('belegt.actor', 'backup', true)`;
      await tx`insert into backup_status (art, ok, snapshot, bytes, meldung, ziel, zeitplan, am) values
        ('backup', true, 'e2e12345', 4096, 'Datenbank und 2 Dateien', '/backups', 'täglich um 03:15', now() - interval '2 hours'),
        ('restore_check', false, 'e2e12345', null, '1 Befunde: dokumente x: Datei fehlt', '/backups', 'täglich um 03:15', now() - interval '1 hour')`;
    });
  } finally {
    await sql.end();
  }
});

const axe = async (page: import("@playwright/test").Page) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const ergebnis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(ergebnis.violations, colorScheme).toEqual([]);
  }
};

test("die Startseite zeigt getrennte Datenbankrollen und den Stand der Sicherung mit Fehler", async ({ page }) => {
  await page.goto("/");
  const betrieb = page.getByRole("region", { name: "Betrieb" });
  await expect(betrieb).toContainText("Datenbank: getrennte Rollen");
  await expect(betrieb.getByRole("alert")).toContainText("Test-Restore am");
  await expect(betrieb.getByRole("alert")).toContainText("Datei fehlt");
  await expect(betrieb).toContainText("Letzte Sicherung");
  await axe(page);
});

test("die Prüfung zeigt die wirksamen Rechte der App-Rolle und die Sicherung", async ({ page }) => {
  await page.goto("/pruefung");
  const zugriff = page.getByRole("region", { name: "Datenbankzugriff" });
  await expect(zugriff).toContainText(/Getrennte Rollen wirksam: Die Anmeldung \S+_app/);
  await zugriff.getByText("Rechte je Tabelle").click();
  const audit = zugriff.getByRole("row", { name: /^audit_log / });
  // Lesen, Einfügen ja; Ändern, Löschen, Leeren nein
  await expect(audit.getByRole("cell")).toHaveText(["audit_log", "ja", "ja", "nein", "nein", "nein"]);
  const sicherung = page.getByRole("region", { name: "Sicherung" });
  await expect(sicherung).toContainText("/backups");
  await expect(sicherung.getByRole("alert")).toContainText("1 Befunde");
  await axe(page);
});
