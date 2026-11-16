import { and, asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { account, passkey } from "../db/schema.ts";
import { codeSchreiben } from "../trennen/barcode.ts";
import { PflichtEingabe, pflichtLaden, pflichtSetzen, stand, zuruecksetzen } from "../zugang/zwei-faktor.ts";
import { type App, type AppUmgebung, akteur } from "./gemeinsam.ts";

/*
 * Konto und zweiter Faktor (docs/zugaenge.md#zwei-faktor). Einrichten, Bestätigen und Entfernen laufen über die
 * Plugins von Better Auth unter /api/auth/two-factor/ und /api/auth/passkey/; hier stehen der Stand fürs eigene Konto,
 * der QR-Code (lokal erzeugt, kein Dienst draußen) und, nur für den Inhaber, Pflicht und Zurücksetzen.
 */

const QrEingabe = z.object({ text: z.string().startsWith("otpauth://totp/").max(1000) });

/** Ein QR-Code als SVG-Pfad (ein Quadrat je dunklem Modul), ohne Ruhezone; die Oberfläche zeichnet ihn */
async function qrPfad(text: string): Promise<{ groesse: number; pfad: string }> {
  const code = await codeSchreiben(text, "QRCode");
  let pfad = "";
  for (let y = 0; y < code.height; y++)
    for (let x = 0; x < code.width; x++) if (code.data[y * code.width + x] === 0) pfad += `M${x} ${y}h1v1h-1z`;
  return { groesse: code.width, pfad };
}

export function kontoRouten(app: App, umgebung: AppUmgebung) {
  const { db } = umgebung;

  /** Stand des eigenen zweiten Faktors; ohne TOTP-Geheimnis und Backup-Codes */
  app.get("/api/konto", async (c) => {
    const nutzer = c.get("nutzer");
    if (nutzer.token) return c.json({ fehler: "Nur mit einer Sitzung" }, 403);
    const [s, keys, passwort, pflicht] = await Promise.all([
      stand(db, nutzer.id),
      db
        .select({ id: passkey.id, name: passkey.name, erstelltAm: passkey.createdAt })
        .from(passkey)
        .where(eq(passkey.userId, nutzer.id))
        .orderBy(asc(passkey.createdAt)),
      db
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, nutzer.id), eq(account.providerId, "credential"), isNotNull(account.password))),
      pflichtLaden(db),
    ]);
    return c.json({
      totp: s.totp,
      passkeys: keys,
      // Ohne Passwort (nur über den OIDC-Anbieter) lässt sich TOTP nicht einrichten; der Anbieter ist zuständig
      passwort: passwort.length > 0,
      pflicht: pflicht.includes(nutzer.role),
      einrichten: !!nutzer.zweiFaktorEinrichten,
    });
  });

  /** QR-Code für die Adresse aus /api/auth/two-factor/enable; nichts davon wird gespeichert oder protokolliert */
  app.post("/api/konto/qr", async (c) => {
    if (c.get("nutzer").token) return c.json({ fehler: "Nur mit einer Sitzung" }, 403);
    const eingabe = QrEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "text: otpauth://totp/…" }, 400);
    return c.json(await qrPfad(eingabe.data.text));
  });

  /** Für welche Rollen ein zweiter Faktor Pflicht ist; nur für den Inhaber */
  app.get("/api/zwei-faktor", async (c) => {
    if (c.get("nutzer").role !== "inhaber") return c.json({ fehler: "Nur für den Inhaber" }, 403);
    return c.json({ pflicht: await pflichtLaden(db) });
  });

  app.put("/api/zwei-faktor", async (c) => {
    const nutzer = c.get("nutzer");
    if (nutzer.role !== "inhaber" || nutzer.token) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const eingabe = PflichtEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "rollen: Liste der Rollen mit Pflicht" }, 400);
    return c.json({ pflicht: await pflichtSetzen(db, eingabe.data.rollen, akteur(nutzer)) });
  });

  /**
   * Den zweiten Faktor eines anderen Zugangs zurücksetzen, etwa nach Verlust des Telefons; nie den eigenen (dafür ein
   * Backup-Code oder im Notfall server/zugang/notfall.ts)
   */
  app.post("/api/zugaenge/:id/zwei-faktor-zuruecksetzen", async (c) => {
    const nutzer = c.get("nutzer");
    if (nutzer.role !== "inhaber" || nutzer.token) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = c.req.param("id");
    if (id === nutzer.id)
      return c.json({ fehler: "Den eigenen zweiten Faktor setzt du mit einem Backup-Code zurück." }, 400);
    const ok = await zuruecksetzen(db, id, akteur(nutzer));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein Zugang mit dieser ID" }, 404);
  });
}
