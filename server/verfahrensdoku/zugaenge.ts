import { sql } from "drizzle-orm";
import type { Sichtbereich } from "../../shared/rollen.ts";
import type { Datenbank } from "../db/client.ts";
import { listen as zugaengeListen } from "../zugang/einladungen.ts";

const ROLLE: Record<string, string> = {
  inhaber: "Inhaber",
  steuerberatung: "Steuerberatung",
  pruefer: "Prüfer",
  mitarbeiter: "Mitarbeiter",
};

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
  return zugaenge.map((u) =>
    [
      `${u.email}: ${ROLLE[u.rolle] ?? u.rolle}`,
      u.zeitraumVon && u.zeitraumBis ? `Zeitraum ${u.zeitraumVon} bis ${u.zeitraumBis}` : "",
      u.rolle === "mitarbeiter" && u.recht ? (u.recht === "bearbeiten" ? "liest und bearbeitet" : "liest") : "",
      u.rolle === "mitarbeiter" && u.sichtbereich ? sichtbereichText(u.sichtbereich, name) : "",
      `seit ${tag(new Date(u.erstelltAm))}`,
      u.entzogenAm ? `entzogen am ${tag(new Date(u.entzogenAm))}` : "",
    ]
      .filter(Boolean)
      .join(", "),
  );
}
