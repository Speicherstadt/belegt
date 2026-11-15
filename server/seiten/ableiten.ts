import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import { ableitungen } from "../db/schema.ts";
import { type Dokument, laden, type Umgebung, zeileAnlegen } from "../dokumente/dokumente.ts";
import { ausfuehren } from "../inhalt/ocr.ts";
import { fuerDokument } from "../loeschung/loeschung.ts";
import type { Zeitraum } from "../zugang/einladungen.ts";
import { neuerName, type Operation, type SeitenOperation } from "./seiten.ts";

/*
 * Neue Dokumente aus Seiten vorhandener: Die Quelle bleibt Byte für Byte, wie sie ist. pdf-lib läuft in einem eigenen
 * Prozess mit Zeitlimit (wie beim Trennen), denn ein kaputtes PDF hielte sonst den Server auf. Die neuen Dokumente und
 * ihre Verknüpfung (ableitungen, versiegelt) entstehen in einer Transaktion.
 */

export type Auftrag = SeitenOperation | { operation: "zusammenfuegen" };

/** Fehler, den die Schnittstelle mit Status und Meldung beantwortet */
export const ableitungsFehler = (status: 400 | 404 | 409 | 410 | 422, meldung: string) =>
  Object.assign(new Error(meldung), { status });
export const istAbleitungsFehler = (err: unknown): err is Error & { status: 400 | 404 | 409 | 410 | 422 } =>
  err instanceof Error && "status" in err;

const KIND = fileURLToPath(new URL("./seiten-kind.ts", import.meta.url));

/** Wendet den Auftrag in einem eigenen Bun-Prozess an; die PDFs gehen über einen eigenen Ordner hin und zurück */
export async function bearbeitenImKind(pdfs: Uint8Array[], auftrag: Auftrag, zeitlimit = 2 * 60_000) {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-seiten-"));
  try {
    for (const [i, pdf] of pdfs.entries()) await writeFile(join(ordner, `eingabe-${i + 1}.pdf`), pdf);
    const aus = JSON.parse(
      await ausfuehren("bun", [KIND, JSON.stringify(auftrag), ordner, String(pdfs.length)], undefined, zeitlimit).catch(
        () => {
          throw ableitungsFehler(422, "Das PDF lässt sich nicht bearbeiten (Zeitlimit)");
        },
      ),
    ) as { anzahl: number } | { fehler: string; ungueltig: boolean };
    if ("fehler" in aus) throw ableitungsFehler(aus.ungueltig ? 400 : 422, aus.fehler);
    const neu: Uint8Array[] = [];
    for (let i = 1; i <= aus.anzahl; i++) neu.push(new Uint8Array(await readFile(join(ordner, `ausgabe-${i}.pdf`))));
    return neu;
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

/** Eine Quelle: vorhanden, ein PDF, nicht gelöscht, Datei passt zu ihrem Hash */
async function quelleLaden({ db, speicher }: Umgebung, id: string): Promise<{ dokument: Dokument; pdf: Uint8Array }> {
  const dokument = await laden(db, id);
  if (!dokument) throw ableitungsFehler(404, "Nicht gefunden");
  if (dokument.mimeType !== "application/pdf") throw ableitungsFehler(400, "Nur PDFs lassen sich bearbeiten");
  if ((await fuerDokument(db, id))?.bestaetigtAm) throw ableitungsFehler(410, "Das Dokument ist gelöscht");
  const bytes = await speicher.laden(dokument.sha256).catch(() => null);
  if (!bytes) throw ableitungsFehler(409, "Die Datei fehlt oder wurde verändert");
  return { dokument, pdf: new Uint8Array(bytes) };
}

/** Was in parameter steht: der Auftrag ohne seinen Namen, beim Teilen dazu, welcher Teil */
function parameter(auftrag: Auftrag, teil: number): Record<string, unknown> {
  const { operation: _, ...rest } = auftrag;
  return auftrag.operation === "teilen" ? { ...rest, teil } : rest;
}

/**
 * Leitet aus den Quellen (beim Zusammenfügen mehrere, in dieser Reihenfolge) neue Dokumente ab. Sie kommen wie jedes
 * Original in den Eingang; Tags, Dokumenttyp und Felder der Quelle übernehmen sie nicht von selbst.
 */
export async function ableiten(
  umgebung: Umgebung,
  { quellen, auftrag, akteur }: { quellen: string[]; auftrag: Auftrag; akteur: string },
): Promise<Dokument[]> {
  const geladen: Awaited<ReturnType<typeof quelleLaden>>[] = [];
  for (const id of quellen) geladen.push(await quelleLaden(umgebung, id));
  const neu = await bearbeitenImKind(
    geladen.map((q) => q.pdf),
    auftrag,
  );
  const erste = geladen[0]!.dokument;
  const operation: Operation = auftrag.operation;
  const dateien: { bytes: Uint8Array; sha256: string }[] = [];
  for (const bytes of neu) dateien.push({ bytes, sha256: await umgebung.speicher.speichern(bytes) });
  return mitAkteur(umgebung.db, akteur, async (tx) => {
    const dokumente: Dokument[] = [];
    for (const [i, datei] of dateien.entries()) {
      const dokument = await zeileAnlegen(tx, datei.sha256, {
        bytes: datei.bytes,
        dateiname: neuerName(erste.dateiname, operation, i + 1),
        quelle: "abgeleitet",
      });
      await tx.insert(ableitungen).values(
        geladen.map((q, position) => ({
          dokumentId: dokument.id,
          quelleId: q.dokument.id,
          position: position + 1,
          operation,
          parameter: parameter(auftrag, i + 1),
          akteur,
        })),
      );
      dokumente.push(dokument);
    }
    return dokumente;
  });
}

export interface Verknuepfung {
  dokumentId: string;
  dateiname: string | null;
  titel: string | null;
  asn: number;
  operation: Operation;
  parameter: Record<string, unknown>;
  position: number;
  akteur: string;
  erstelltAm: string;
  geloescht: boolean;
}

/**
 * Woraus ein Dokument abgeleitet ist (aus) und was daraus abgeleitet wurde (daraus); mit Zeitraum (Prüfer) nur die
 * anderen Dokumente, die darin liegen
 */
export async function ableitungenZu(
  db: Umgebung["db"],
  id: string,
  zeitraum?: Zeitraum,
): Promise<{ aus: Verknuepfung[]; daraus: Verknuepfung[] }> {
  const zeilen = await db.execute<{
    richtung: "aus" | "daraus";
    dokument_id: string;
    dateiname: string | null;
    titel: string | null;
    asn: string;
    operation: Operation;
    parameter: Record<string, unknown>;
    position: number;
    akteur: string;
    erstellt_am: Date;
    geloescht: boolean;
  }>(sql`
    select x.richtung, d.id as dokument_id, d.dateiname, e.titel, n.nummer as asn, x.operation, x.parameter,
           x.position, x.akteur, x.erstellt_am,
           exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null) as geloescht
      from (select 'aus' as richtung, quelle_id as anderes, * from ableitungen where dokument_id = ${id}
            union all
            select 'daraus', dokument_id, * from ableitungen where quelle_id = ${id}) x
      join dokumente d on d.id = x.anderes
      join archivnummern n on n.dokument_id = d.id
      left join lateral (select titel from einordnungen y where y.dokument_id = d.id
                          order by y.erstellt_am desc, y.id desc limit 1) e on true
     where (${zeitraum?.von ?? null}::date is null
            or belegt_dokument_tag(d.id) between ${zeitraum?.von ?? null}::date and ${zeitraum?.bis ?? null}::date)
     order by x.erstellt_am, x.position, n.nummer`);
  const alle = [...zeilen].map((z) => ({
    richtung: z.richtung,
    dokumentId: z.dokument_id,
    dateiname: z.dateiname,
    titel: z.titel,
    asn: Number(z.asn),
    operation: z.operation,
    parameter: z.parameter,
    position: z.position,
    akteur: z.akteur,
    erstelltAm: new Date(z.erstellt_am).toISOString(),
    geloescht: z.geloescht,
  }));
  const ohne = ({ richtung: _, ...v }: (typeof alle)[number]): Verknuepfung => v;
  return {
    aus: alle.filter((v) => v.richtung === "aus").map(ohne),
    daraus: alle.filter((v) => v.richtung === "daraus").map(ohne),
  };
}
