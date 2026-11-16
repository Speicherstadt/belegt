import { sql } from "drizzle-orm";
import type { Sichtbereich } from "../../shared/rollen.ts";
import type { Datenbank } from "../db/client.ts";
import { listen as zugaengeListen } from "../zugang/einladungen.ts";
import { pflichtLaden, staende, type ZweiFaktorStand } from "../zugang/zwei-faktor.ts";

const ROLLE: Record<string, string> = {
  inhaber: "Inhaber",
  steuerberatung: "Steuerberatung",
  pruefer: "Prüfer",
  mitarbeiter: "Mitarbeiter",
};

/** Der zweite Faktor eines Zugangs in Worten */
function zweiFaktorText(s: ZweiFaktorStand | undefined): string {
  if (!s || (!s.totp && !s.passkeys)) return "ohne zweiten Faktor";
  const teile = [s.totp ? "TOTP" : "", s.passkeys ? `${s.passkeys} Passkey${s.passkeys > 1 ? "s" : ""}` : ""];
  return `zweiter Faktor: ${teile.filter(Boolean).join(" und ")}`;
}

/** Anmeldung und Pflicht zum zweiten Faktor für Abschnitt 6 */
export async function anmeldungBeschreiben(db: Datenbank): Promise<string> {
  const pflicht = await pflichtLaden(db);
  const fuer = pflicht.map((r) => ROLLE[r]).join(", ");
  return [
    "Personen melden sich mit E-Mail-Adresse und Passwort an, als zweiten Faktor mit einem Code aus einer Authenticator-App (TOTP, mit einmal nutzbaren Backup-Codes) oder mit einem Passkey.",
    pflicht.length
      ? `Ein zweiter Faktor ist Pflicht für: ${fuer}; ohne ihn landet der Zugang nach der Anmeldung auf seiner Einrichtung.`
      : "Ein zweiter Faktor ist für keine Rolle Pflicht.",
    "Wer sich über den angebundenen OpenID-Connect-Anbieter anmeldet, braucht in Belegt keinen eigenen zweiten Faktor; dafür ist der Anbieter zuständig. Den zweiten Faktor eines anderen Zugangs kann der Inhaber zurücksetzen; das steht mit Akteur im Protokoll.",
  ].join(" ");
}

const tag = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

/** Der Sichtbereich eines Mitarbeiters in Worten, mit den heutigen Namen von Tags, Typen und Korrespondenten */
export function sichtbereichText(b: Sichtbereich, namen: Map<string, string>): string {
  const liste = (ids: string[]) => ids.map((id) => `„${namen.get(id) ?? "gelöscht"}“`).join(" oder ");
  const teile = [
    b.tags.length ? `Tag ${liste(b.tags)}` : "",
    b.dokumenttypen.length ? `Dokumenttyp ${liste(b.dokumenttypen)}` : "",
    b.korrespondenten.length ? `Korrespondent ${liste(b.korrespondenten)}` : "",
  ].filter(Boolean);
  return [
    teile.length ? `sieht Dokumente mit ${teile.join(" und ")}` : "sieht alle Dokumente",
    b.ohneTags.length ? `außer mit Tag ${liste(b.ohneTags)}` : "",
    b.ohneOrdnung ? "dazu Dokumente ohne Tag, Typ und Korrespondent" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Die Zugänge für Abschnitt 6 der Verfahrensdokumentation, Mitarbeiter mit Recht und Sichtbereich */
export async function zugaengeBeschreiben(db: Datenbank): Promise<string[]> {
  const [{ zugaenge }, namen] = await Promise.all([
    zugaengeListen(db),
    db.execute<{ id: string; name: string }>(sql`
      select id::text, name from tags union all select id::text, name from dokumenttypen
      union all select id::text, name from korrespondenten`),
  ]);
  const name = new Map([...namen].map((n) => [n.id, n.name]));
  const zweiFaktor = await staende(
    db,
    zugaenge.map((u) => u.id),
  );
  return zugaenge.map((u) =>
    [
      `${u.email}: ${ROLLE[u.rolle] ?? u.rolle}`,
      u.zeitraumVon && u.zeitraumBis ? `Zeitraum ${u.zeitraumVon} bis ${u.zeitraumBis}` : "",
      u.rolle === "mitarbeiter" && u.recht ? (u.recht === "bearbeiten" ? "liest und bearbeitet" : "liest") : "",
      u.rolle === "mitarbeiter" && u.sichtbereich ? sichtbereichText(u.sichtbereich, name) : "",
      `seit ${tag(new Date(u.erstelltAm))}`,
      u.entzogenAm ? `entzogen am ${tag(new Date(u.entzogenAm))}` : "",
      zweiFaktorText(zweiFaktor.get(u.id)),
    ]
      .filter(Boolean)
      .join(", "),
  );
}
