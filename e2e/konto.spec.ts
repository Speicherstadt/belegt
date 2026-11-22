import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { base32, totpCode } from "../server/test-totp.ts";
import { menueOeffnen } from "./menue.ts";

/*
 * Zweiter Faktor (docs/zugaenge.md#zwei-faktor) mit eigenen Zugängen, nie mit dem Inhaber: dessen Sitzung teilen alle
 * anderen Tests. Den TOTP-Code rechnet der Test selbst (RFC 6238), den Passkey hält der virtuelle Authenticator von
 * Chromium (WebAuthn über CDP).
 */

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function axeHellUndDunkel(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
}

/** Lädt mit der Sitzung des Inhabers ein und legt das Konto über die Einladungsseite in einem eigenen Browser an */
async function eingeladen(page: Page, browser: Browser, rolle: "steuerberatung" | "pruefer", email: string) {
  const zugang = rolle === "pruefer" ? { rolle, zeitraum: { von: "2001-01-01", bis: "2001-12-31" } } : { rolle };
  const { pfad } = await (await page.request.post("/api/einladungen", { data: zugang })).json();
  const kontext = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "de-DE" });
  const fremd = await kontext.newPage();
  await fremd.goto(pfad);
  await fremd.getByLabel("E-Mail-Adresse").fill(email);
  await fremd.getByLabel("Passwort").fill("ein-langes-konto-passwort");
  await fremd.getByRole("button", { name: "Konto anlegen" }).click();
  return { kontext, fremd };
}

/**
 * Klickt und wiederholt nach 429, wenn die Grenze abgelaufen ist (X-Retry-After): Better Auth begrenzt Anmeldungen und
 * Codes je Adresse (server/auth.ts), und im Test kommen alle von einer Adresse
 */
async function begrenzt(page: Page, pfad: string, klick: () => Promise<void>) {
  for (let versuch = 0; versuch < 3; versuch++) {
    const antwort = page.waitForResponse((r) => r.url().endsWith(pfad));
    await klick();
    const a = await antwort;
    if (a.status() !== 429) return;
    await page.waitForTimeout((Number(a.headers()["x-retry-after"] ?? 10) + 1) * 1000);
  }
}

async function anmelden(page: Page, email: string) {
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill("ein-langes-konto-passwort");
  await begrenzt(page, "/api/auth/sign-in/email", () =>
    page.getByRole("button", { name: "Anmelden", exact: true }).click(),
  );
}

/** Code eintragen und bestätigen; den Code bei jedem Versuch neu, denn nach dem Warten kann er abgelaufen sein */
const bestaetigen = (page: Page, pfad: string, feld: ReturnType<Page["getByLabel"]>, code: () => string) =>
  begrenzt(page, pfad, async () => {
    await feld.fill(code());
    await page.getByRole("button", { name: "Bestätigen" }).click();
  });

test("TOTP einrichten, Backup-Codes herunterladen und mit dem Code anmelden", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  const email = `totp-${info.project.name}@example.org`;
  const { kontext, fremd } = await eingeladen(page, browser, "steuerberatung", email);
  try {
    await expect(fremd.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
    await menueOeffnen(fremd);
    await fremd.getByRole("link", { name: "Konto" }).click();
    await expect(fremd.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible();
    await axeHellUndDunkel(fremd);

    await fremd.getByLabel("Passwort").fill("ein-langes-konto-passwort");
    await fremd.getByRole("button", { name: "TOTP einrichten" }).click();
    await expect(fremd.getByRole("img", { name: "QR-Code für die Authenticator-App" })).toBeVisible();
    await axeHellUndDunkel(fremd);
    const geheimnis = base32((await fremd.getByTestId("totp-geheimnis").textContent())!);
    await bestaetigen(fremd, "/two-factor/verify-totp", fremd.getByLabel("Code aus der App"), () =>
      totpCode(geheimnis),
    );

    const codes = fremd.getByRole("list", { name: "Backup-Codes" }).getByRole("listitem");
    await expect(codes).toHaveCount(10);
    const backupCode = (await codes.first().textContent())!;
    const download = fremd.waitForEvent("download");
    await fremd.getByRole("button", { name: "Herunterladen" }).click();
    expect((await download).suggestedFilename()).toBe("belegt-backup-codes.txt");
    await fremd.getByRole("button", { name: "Ich habe sie gesichert" }).click();
    await expect(fremd.getByText("TOTP ist eingerichtet.")).toBeVisible();

    await menueOeffnen(fremd);
    await fremd.getByRole("button", { name: "Abmelden" }).click();
    await anmelden(fremd, email);
    await expect(fremd.getByRole("heading", { level: 1, name: "Zweiter Schritt" })).toBeVisible();
    await axeHellUndDunkel(fremd);
    const code = fremd.getByLabel("Code", { exact: true });
    await bestaetigen(fremd, "/two-factor/verify-totp", code, () => "000000");
    await expect(fremd.getByRole("alert")).toBeVisible();
    await bestaetigen(fremd, "/two-factor/verify-totp", code, () => totpCode(geheimnis));
    await expect(fremd.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();

    // Ohne App: ein Backup-Code, genau einmal
    await menueOeffnen(fremd);
    await fremd.getByRole("button", { name: "Abmelden" }).click();
    await anmelden(fremd, email);
    await fremd.getByRole("button", { name: "Stattdessen einen Backup-Code verwenden" }).click();
    await bestaetigen(fremd, "/two-factor/verify-backup-code", fremd.getByLabel("Backup-Code"), () => backupCode);
    await expect(fremd.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
  } finally {
    await kontext.close();
  }

  // Der Inhaber sieht den zweiten Faktor bei den Zugängen
  await page.goto("/zugaenge");
  await expect(page.getByRole("listitem").filter({ hasText: email }).first()).toContainText("Zwei-Faktor");
});

test("Pflicht zum zweiten Faktor: Einrichtung mit Passkey, danach Anmeldung mit Passkey", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  await page.goto("/zugaenge");
  const pflicht = page.getByRole("region", { name: "Zwei-Faktor-Anmeldung" });
  await pflicht.getByLabel("Prüfer").check();
  await pflicht.getByRole("button", { name: "Speichern" }).click();
  await expect(pflicht.getByRole("status")).toHaveText("Gespeichert.");
  await axeHellUndDunkel(page);
  const email = `passkey-${info.project.name}@example.org`;
  const { kontext, fremd } = await eingeladen(page, browser, "pruefer", email);
  try {
    // Virtueller Authenticator mit Nutzerprüfung, der jede Anfrage selbst bestätigt
    const cdp = await kontext.newCDPSession(fremd);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    // Ohne zweiten Faktor nur die Seite Konto
    await expect(fremd.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible();
    await expect(fremd.getByRole("status").first()).toContainText("ist ein zweiter Faktor Pflicht");
    await fremd.goto("/archiv");
    await expect(fremd.getByRole("heading", { level: 1, name: "Konto" })).toBeVisible();
    await axeHellUndDunkel(fremd);

    await fremd.getByLabel("Name").fill("Virtueller Schlüssel");
    await fremd.getByRole("button", { name: "Passkey hinzufügen" }).click();
    // Belegt meldet gleich mit dem neuen Passkey an; danach erscheint die Seite, die er aufgerufen hatte
    await expect(fremd.getByRole("heading", { level: 1, name: "Archiv" })).toBeVisible();
    await menueOeffnen(fremd);
    await fremd.getByRole("link", { name: "Konto" }).click();
    await expect(fremd.getByText("Virtueller Schlüssel")).toBeVisible();
    await expect(fremd.getByText("ist ein zweiter Faktor Pflicht")).toHaveCount(0);

    // Mit nur einem Passkey gilt das Passwort allein nicht mehr
    await menueOeffnen(fremd);
    await fremd.getByRole("button", { name: "Abmelden" }).click();
    await anmelden(fremd, email);
    await expect(fremd.getByRole("alert")).toContainText("mit seinem Passkey");
    await fremd.getByRole("button", { name: "Passkey verwenden" }).click();
    await expect(fremd.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
  } finally {
    await kontext.close();
    await page.request.put("/api/zwei-faktor", { data: { rollen: [] } });
  }
});
