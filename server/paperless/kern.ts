import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { Feldtyp } from "../../shared/ordnung.ts";
import { mitAkteur, type Tx } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumentDokumenttypen, felder, feldwerte, importEintraege, importZuordnungen, notizen } from "../db/schema.ts";
import { type Umgebung, zeileAnlegen } from "../dokumente/dokumente.ts";
import { einordnenIn } from "../einordnung/einordnung.ts";
import { dokumenttypMitNamen, feldwertSpalten } from "../ordnung/ordnung.ts";
import {
  type Feldabbildung,
  feldAbbilden,
  notizText,
  type PaperlessFeld,
  pruefsummePasst,
  restNotiz,
  tagAus,
  wertAbbilden,
} from "./abbildung.ts";

/*
 * Gemeinsamer Kern für Import über die API und aus einem Export: ein Dokument aus Paperless-ngx mit seinem Original
 * aufnehmen. Die Prüfsumme aus Paperless-ngx muss zum Original passen, sonst kommt es nicht ins Archiv. Liegt dasselbe
 * Original (SHA-256) schon im Archiv, wird es nur verknüpft. Sonst entstehen Dokument (Quelle „import“), Tags,
 * Dokumenttyp, Feldwerte, Notizen und, wenn eine Zuordnung passt, die Einordnung in einer Transaktion mit dem Akteur
 * import:paperless, zusammen mit dem Ergebnis in import_eintraege. Ein abgebrochener Lauf hinterlässt so nie ein
 * Dokument ohne Ergebnis.
 */

export const AKTEUR = "import:paperless";

/** Name des Feldes für die Archivnummer aus Paperless-ngx; Belegt vergibt eine eigene */
export const ASN_FELD = "Paperless-ASN";

/** Ein Dokument aus Paperless-ngx, wie API und Export es liefern, mit Namen statt IDs */
export interface PaperlessDokument {
  id: number;
  titel: string | null;
  korrespondent: string | null;
  dokumenttyp: string | null;
  tags: string[];
  created: string | null;
  asn: number | null;
  dateiname: string | null;
  /** MD5 (ältere Versionen) oder SHA-256 des Originals */
  pruefsumme: string | null;
  notizen: { text: string; autor: string | null; erstellt: string | null }[];
  felder: { feldId: number; wert: unknown }[];
}

type Art = (typeof importZuordnungen.$inferSelect)["zielArt"];

interface Zielfeld {
  id: string;
  typ: Feldtyp;
  optionen: string[];
}

/** Was ein Lauf einmal vorbereitet: die eigenen Felder in Belegt und die Zuordnungen zu einer Art */
export interface Vorbereitet {
  felder: Map<number, { paperless: PaperlessFeld; ziel: Zielfeld | null }>;
  zuordnungen: { art: "dokumenttyp" | "tag"; name: string; zielArt: Art }[];
  hinweise: string[];
}

/**
 * Das Feld in Belegt für ein Paperless-Feld: per Namen (ohne Groß- und Kleinschreibung), angelegt, wenn es fehlt.
 * Hat ein vorhandenes Feld einen anderen Typ, nimmt es „Name (Paperless-ngx)“; passt auch das nicht, null. Einer
 * Auswahl fügt es fehlende Optionen hinzu.
 */
async function feldFuer(tx: Tx, name: string, a: Feldabbildung): Promise<Zielfeld | null> {
  const basis = name.trim().slice(0, 85) || "Feld";
  for (const kandidat of [name.trim().slice(0, 100) || "Feld", `${basis} (Paperless-ngx)`]) {
    const [da] = await tx.select().from(felder).where(sql`lower(${felder.name}) = lower(${kandidat})`);
    if (!da) {
      const [neu] = await tx.insert(felder).values({ name: kandidat, typ: a.typ, optionen: a.optionen }).returning();
      return { id: neu!.id, typ: a.typ, optionen: a.optionen };
    }
    if (da.typ !== a.typ) continue;
    if (a.typ !== "auswahl") return { id: da.id, typ: a.typ, optionen: [] };
    const bekannt = new Set(da.optionen.map((o) => o.toLowerCase()));
    const optionen = [...da.optionen, ...a.optionen.filter((o) => !bekannt.has(o.toLowerCase()))];
    if (optionen.length > 50) continue;
    if (optionen.length !== da.optionen.length) await tx.update(felder).set({ optionen }).where(eq(felder.id, da.id));
    return { id: da.id, typ: "auswahl", optionen };
  }
  return null;
}

/** Legt die Felder eines Laufs an oder ordnet sie per Namen zu und lädt die Zuordnungen zu einer Art */
export async function vorbereiten(db: Datenbank, paperlessFelder: PaperlessFeld[]): Promise<Vorbereitet> {
  const hinweise: string[] = [];
  const zugeordnet = await mitAkteur(db, AKTEUR, async (tx) => {
    const m: Vorbereitet["felder"] = new Map();
    for (const f of paperlessFelder) {
      const a = feldAbbilden(f);
      if (a.hinweis) hinweise.push(a.hinweis);
      const ziel = await feldFuer(tx, f.name, a);
      if (!ziel) hinweise.push(`Feld „${f.name}“: Es gibt schon Felder dieses Namens mit anderem Typ, Werte als Notiz`);
      m.set(f.id, { paperless: f, ziel });
    }
    return m;
  });
  const zuordnungen = await db
    .select({ art: importZuordnungen.art, name: importZuordnungen.name, zielArt: importZuordnungen.zielArt })
    .from(importZuordnungen)
    .orderBy(asc(importZuordnungen.erstelltAm));
  return { felder: zugeordnet, zuordnungen, hinweise };
}

/** Die Art aus der ersten passenden Zuordnung: zuerst der Dokumenttyp, dann die Tags */
export function artFuer(v: Pick<Vorbereitet, "zuordnungen">, d: Pick<PaperlessDokument, "dokumenttyp" | "tags">) {
  const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const typ = d.dokumenttyp;
  const ueberTyp = typ ? v.zuordnungen.find((z) => z.art === "dokumenttyp" && gleich(z.name, typ)) : undefined;
  if (ueberTyp) return ueberTyp.zielArt;
  return v.zuordnungen.find((z) => z.art === "tag" && d.tags.some((t) => gleich(z.name, t)))?.zielArt ?? null;
}

export type Ergebnis =
  | { ergebnis: "uebernommen" | "doppelt"; dokumentId: string }
  | { ergebnis: "fehler"; grund: string };

/** Vorschlag für die Einordnung aus Paperless-ngx, wie er in import_eintraege steht */
const vorschlag = (d: PaperlessDokument) => ({
  titel: d.titel?.trim().slice(0, 300) || null,
  korrespondent: d.korrespondent?.trim().slice(0, 300) || null,
  entstanden: tagAus(d.created),
});

/** Hält einen Fehler zu einem Dokument fest; ein zweites Mal im selben Lauf ändert nichts */
export async function fehlerFesthalten(
  db: Datenbank,
  importId: string,
  d: Pick<PaperlessDokument, "id" | "pruefsumme"> & Partial<PaperlessDokument>,
  grund: string,
): Promise<Ergebnis> {
  const g = grund.slice(0, 1000);
  await mitAkteur(db, AKTEUR, (tx) =>
    tx
      .insert(importEintraege)
      .values({
        importId,
        paperlessId: d.id,
        ergebnis: "fehler",
        grund: g,
        pruefsumme: d.pruefsumme,
        titel: d.titel?.slice(0, 300) ?? null,
      })
      .onConflictDoNothing(),
  );
  return { ergebnis: "fehler", grund: g };
}

/** Ein Dokument, das nicht gelöscht ist, mit diesem Original; das älteste */
async function schonImArchiv(db: Datenbank, sha256: string): Promise<string | null> {
  const [d] = await db.execute<{ id: string }>(sql`
    select d.id from dokumente d
     where d.sha256 = ${sha256}
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am, d.id limit 1`);
  return d?.id ?? null;
}

/** Feldwerte, Archivnummer aus Paperless-ngx und Notizen eines neuen Dokuments; was in kein Feld passt, als Notiz */
async function ordnungSetzen(tx: Tx, dokumentId: string, v: Vorbereitet, d: PaperlessDokument) {
  const rest: string[] = [];
  const setzen = (ex: Tx, feld: Zielfeld, wert: unknown) =>
    ex.insert(feldwerte).values({ dokumentId, feldId: feld.id, ...feldwertSpalten(feld, wert) });
  for (const { feldId, wert } of d.felder) {
    const f = v.felder.get(feldId);
    if (!f) continue;
    const a = wertAbbilden(f.paperless, f.ziel?.typ ?? "text", wert);
    if (!a) continue;
    if ("notiz" in a || !f.ziel) {
      rest.push("notiz" in a ? a.notiz : `${f.paperless.name}: ${String(a.wert)}`);
      continue;
    }
    try {
      // Ein eigener Savepoint: Ein Wert, den Postgres ablehnt, soll das Dokument nicht verhindern
      await tx.transaction((sp) => setzen(sp as Tx, f.ziel!, a.wert));
    } catch {
      rest.push(`${f.paperless.name}: ${String(a.wert)}`);
    }
  }
  if (d.asn !== null) {
    const asn = await feldFuer(tx, ASN_FELD, { typ: "zahl", optionen: [], hinweis: null });
    if (asn) await setzen(tx, asn, d.asn);
    else rest.push(`${ASN_FELD}: ${d.asn}`);
  }
  const texte = [
    ...d.notizen.filter((n) => n.text.trim()).map((n) => notizText(n.text, n.autor, n.erstellt)),
    ...[restNotiz(rest)].filter((t): t is string => t !== null),
  ];
  for (const text of texte) await tx.insert(notizen).values({ dokumentId, text, erstelltVon: AKTEUR });
}

/**
 * Nimmt ein Dokument aus Paperless-ngx auf (siehe oben). Wirft nur, wenn Datenbank oder Speicher ausfallen; ein Fehler
 * am Dokument selbst steht im Ergebnis und in import_eintraege.
 */
export async function dokumentUebernehmen(
  umgebung: Umgebung,
  importId: string,
  v: Vorbereitet,
  d: PaperlessDokument,
  bytes: Uint8Array,
): Promise<Ergebnis> {
  const { db } = umgebung;
  if (!d.pruefsumme) return fehlerFesthalten(db, importId, d, "Paperless-ngx nennt keine Prüfsumme");
  if (!pruefsummePasst(bytes, d.pruefsumme))
    return fehlerFesthalten(db, importId, d, "Prüfsumme passt nicht zum geladenen Original");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const v0 = vorschlag(d);
  const schon = await schonImArchiv(db, sha256);
  if (schon) {
    await mitAkteur(db, AKTEUR, (tx) =>
      tx.insert(importEintraege).values({
        importId,
        paperlessId: d.id,
        ergebnis: "doppelt",
        dokumentId: schon,
        pruefsumme: d.pruefsumme,
        sha256,
        ...v0,
      }),
    );
    return { ergebnis: "doppelt", dokumentId: schon };
  }
  await umgebung.speicher.speichern(bytes);
  const id = await mitAkteur(db, AKTEUR, async (tx): Promise<string> => {
    const dok = await zeileAnlegen(tx, sha256, { bytes, dateiname: d.dateiname, quelle: "import", tags: d.tags });
    if (d.dokumenttyp?.trim()) {
      const typ = await dokumenttypMitNamen(tx, d.dokumenttyp);
      await tx.insert(dokumentDokumenttypen).values({ dokumentId: dok.id, dokumenttypId: typ.id });
    }
    await ordnungSetzen(tx, dok.id, v, d);
    const art = artFuer(v, d);
    if (art) {
      const [eingang] = await tx.execute<{ tag: string }>(
        sql`select (now() at time zone 'Europe/Berlin')::date::text as tag`,
      );
      await einordnenIn(tx, dok.id, {
        art,
        entstanden: v0.entstanden ?? eingang!.tag,
        titel: v0.titel ?? undefined,
        korrespondent: v0.korrespondent ?? undefined,
      });
    }
    await tx.insert(importEintraege).values({
      importId,
      paperlessId: d.id,
      ergebnis: "uebernommen",
      dokumentId: dok.id,
      pruefsumme: d.pruefsumme,
      sha256,
      ...v0,
    });
    return dok.id;
  }).catch((err: Error) => err);
  // Lehnt Postgres das Dokument ab (etwa einen Namen, der nicht passt), ist nichts davon gespeichert: ein Fehler am
  // Dokument. Ist die Datenbank weg, scheitert auch das Festhalten, und der Lauf endet
  if (id instanceof Error) return fehlerFesthalten(db, importId, d, `Nicht aufgenommen: ${id.message}`);
  return { ergebnis: "uebernommen", dokumentId: id };
}

/** Paperless-IDs, die ein Lauf überspringt: schon in diesem Lauf, und bei der API in früheren Läufen derselben Quelle */
export async function erledigt(db: Datenbank, importId: string): Promise<Set<number>> {
  const zeilen = await db.execute<{ paperless_id: number }>(sql`
    select e.paperless_id from import_eintraege e where e.import_id = ${importId}
    union
    select e.paperless_id from import_eintraege e
      join importe vorher on vorher.id = e.import_id
      join importe dieser on dieser.id = ${importId}
     where dieser.quelle_id is not null and vorher.quelle_id = dieser.quelle_id and vorher.id <> dieser.id
       and e.ergebnis in ('uebernommen', 'doppelt')`);
  return new Set([...zeilen].map((z) => Number(z.paperless_id)));
}

/** Vorschlag aus Paperless-ngx für die Einordnung eines Dokuments, aus dem neuesten Import, der es betrifft */
export async function importVorschlagZu(db: Datenbank, dokumentId: string) {
  const [e] = await db
    .select({
      titel: importEintraege.titel,
      korrespondent: importEintraege.korrespondent,
      entstanden: importEintraege.entstanden,
    })
    .from(importEintraege)
    .where(eq(importEintraege.dokumentId, dokumentId))
    .orderBy(sql`${importEintraege.erstelltAm} desc`)
    .limit(1);
  return e && (e.titel || e.korrespondent || e.entstanden) ? { ...e, herkunft: "Paperless-ngx" as const } : null;
}
