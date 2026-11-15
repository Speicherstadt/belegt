import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type Abgleich, type Algorithmus, trifft } from "../../shared/abgleich.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumenttypen, korrespondenten, tags, zuordnungVorschlaege } from "../db/schema.ts";
import { ocrVerfuegbar } from "../inhalt/ocr.ts";
import type { AufgeloesterVorschlag } from "../ordnung/vorschlag.ts";
import { merkmalJoins, merkmalText, textBereit } from "./merkmale.ts";
import { regexSuchen } from "./regex.ts";

/*
 * Zuordnungsregeln auswerten (docs/ordnung.md#zuordnungsregeln): einmal je Dokument im Eingang, sobald sein Text
 * gelesen ist, im Worker. Das Ergebnis ist ein Vorschlag in zuordnung_vorschlaege; gesetzt wird nichts. Ändert sich
 * eine Regel, löscht Postgres die Vorschläge der Dokumente im Eingang (Trigger aus 0040), und der Worker wertet neu aus.
 */

interface Objekt extends Abgleich {
  id: string;
  name: string;
}

export const ZuordnungVorschlag = z.object({
  korrespondent: z.uuid().nullable(),
  dokumenttyp: z.uuid().nullable(),
  tags: z.array(z.uuid()),
  /** Namen der Regeln, deren regulärer Ausdruck das Zeitlimit überschritt oder ungültig war */
  uebersprungen: z.array(z.string()).default([]),
});
export type ZuordnungVorschlag = z.infer<typeof ZuordnungVorschlag>;

export interface Regelwerk {
  korrespondenten: Objekt[];
  dokumenttypen: Objekt[];
  tags: Objekt[];
}

const MIT_REGEL: Algorithmus[] = ["irgendein_wort", "alle_woerter", "exakt", "regex", "unscharf"];

/** Korrespondenten, Dokumenttypen und Tags mit einer Regel (ohne „keiner“ und „automatisch“), nach Namen */
export async function regelwerk(db: Datenbank): Promise<Regelwerk> {
  const spalten = <T extends typeof korrespondenten | typeof dokumenttypen | typeof tags>(t: T) =>
    db
      .select({
        id: t.id,
        name: t.name,
        abgleich: t.abgleich,
        abgleichText: t.abgleichText,
        grossKleinEgal: t.grossKleinEgal,
      })
      .from(t as typeof tags)
      .where(inArray(t.abgleich, MIT_REGEL))
      .orderBy(asc(sql`lower(${t.name})`)) as Promise<Objekt[]>;
  const [k, d, t] = await Promise.all([spalten(korrespondenten), spalten(dokumenttypen), spalten(tags)]);
  return { korrespondenten: k, dokumenttypen: d, tags: t };
}

/** Ob die Regel eines Objekts auf den Text passt; regulär mit Zeitlimit, ein Fehler trifft nicht */
async function passt(o: Objekt, text: string, uebersprungen: string[]): Promise<boolean> {
  const sofort = trifft(o, text);
  if (sofort !== null) return sofort;
  if (o.abgleich !== "regex" || !o.abgleichText.trim()) return false;
  const r = await regexSuchen(o.abgleichText.trim(), text, { grossKleinEgal: o.grossKleinEgal });
  if ("fehler" in r) {
    uebersprungen.push(o.name);
    return false;
  }
  return r.treffer;
}

/**
 * Wertet alle Regeln gegen einen Text aus: der erste passende Korrespondent und Dokumenttyp (nach Namen), alle
 * passenden Tags. Paperless-ngx sammelt ebenso alle Treffer (match_correspondents, match_tags).
 */
export async function auswerten(r: Regelwerk, text: string): Promise<ZuordnungVorschlag> {
  const uebersprungen: string[] = [];
  const erster = async (liste: Objekt[]) => {
    for (const o of liste) if (await passt(o, text, uebersprungen)) return o.id;
    return null;
  };
  const korrespondent = await erster(r.korrespondenten);
  const dokumenttyp = await erster(r.dokumenttypen);
  const passendeTags: string[] = [];
  for (const t of r.tags) if (await passt(t, text, uebersprungen)) passendeTags.push(t.id);
  return { korrespondent, dokumenttyp, tags: passendeTags, uebersprungen };
}

/**
 * Wertet die Regeln für Dokumente im Eingang aus (nicht eingeordnet, nicht gelöscht, Text gelesen), die noch keinen
 * Vorschlag haben. Auch ein leeres Ergebnis wird festgehalten, damit dasselbe Dokument nicht in jedem Lauf wiederkommt.
 */
export async function zuordnungVorschlaegeErzeugen(
  db: Datenbank,
  { stapel = 20, ocr = ocrVerfuegbar() }: { stapel?: number; ocr?: boolean } = {},
): Promise<{ ausgewertet: number; treffer: number }> {
  const offen = await db.execute<{ id: string; text: string }>(sql`
    select d.id, ${merkmalText} as text from dokumente d ${merkmalJoins}
     where not exists (select 1 from einordnungen e where e.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
       and not exists (select 1 from zuordnung_vorschlaege z where z.dokument_id = d.id)
       and ${textBereit(ocr)}
     order by d.eingegangen_am limit ${stapel}`);
  if (!offen.length) return { ausgewertet: 0, treffer: 0 };
  const r = await regelwerk(db);
  let treffer = 0;
  for (const d of offen) {
    const v = await auswerten(r, d.text);
    if (v.korrespondent || v.dokumenttyp || v.tags.length) treffer++;
    // Ein Trigger verwirft den Vorschlag, wenn die Löschung inzwischen bestätigt ist
    await db.insert(zuordnungVorschlaege).values({ dokumentId: d.id, vorschlag: v }).onConflictDoNothing();
  }
  return { ausgewertet: offen.length, treffer };
}

/** Der Vorschlag der Zuordnungsregeln mit heutigen Namen; was seitdem gelöscht wurde, fällt weg */
export async function zuordnungVorschlagZu(
  db: Datenbank,
  dokumentId: string,
): Promise<(AufgeloesterVorschlag & { uebersprungen: string[] }) | null> {
  const [z] = await db.select().from(zuordnungVorschlaege).where(eq(zuordnungVorschlaege.dokumentId, dokumentId));
  const v = ZuordnungVorschlag.safeParse(z?.vorschlag);
  if (!v.success) return null;
  const [t, typ, korr] = await Promise.all([
    v.data.tags.length
      ? db
          .select({ id: tags.id, name: tags.name, farbe: tags.farbe })
          .from(tags)
          .where(inArray(tags.id, v.data.tags))
          .orderBy(asc(sql`lower(${tags.name})`))
      : [],
    v.data.dokumenttyp
      ? db
          .select({ id: dokumenttypen.id, name: dokumenttypen.name })
          .from(dokumenttypen)
          .where(eq(dokumenttypen.id, v.data.dokumenttyp))
      : [],
    v.data.korrespondent
      ? db
          .select({ id: korrespondenten.id, name: korrespondenten.name })
          .from(korrespondenten)
          .where(eq(korrespondenten.id, v.data.korrespondent))
      : [],
  ]);
  if (!t.length && !typ[0] && !korr[0]) return null;
  return {
    tags: t,
    dokumenttyp: typ[0] ?? null,
    korrespondent: korr[0] ?? null,
    felder: [],
    uebersprungen: v.data.uebersprungen,
  };
}

const ALGORITHMUS_TEXT: Record<Algorithmus, string> = {
  keiner: "keine",
  irgendein_wort: "irgendein Wort aus",
  alle_woerter: "alle Wörter aus",
  exakt: "genau",
  regex: "regulärer Ausdruck",
  unscharf: "unscharf",
  automatisch: "automatisch",
};

/** Zuordnungsregeln in Worten für die Verfahrensdokumentation, je Korrespondent, Dokumenttyp und Tag eine Zeile */
export async function zuordnungsregelnBeschreiben(db: Datenbank): Promise<string[]> {
  const r = await regelwerk(db);
  const zeile = (was: string) => (o: Objekt) =>
    `Zuordnungsregel ${was} „${o.name}“: ${ALGORITHMUS_TEXT[o.abgleich]} „${o.abgleichText}“${o.grossKleinEgal ? "" : " (Groß- und Kleinschreibung beachtet)"}`;
  return [
    ...r.korrespondenten.map(zeile("Korrespondent")),
    ...r.dokumenttypen.map(zeile("Dokumenttyp")),
    ...r.tags.map(zeile("Tag")),
  ];
}
