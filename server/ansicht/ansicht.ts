import { eq, sql } from "drizzle-orm";
import { ansichten, inhalte } from "../db/schema.ts";
import { ALTE_OFFICE_TYPEN } from "../dokumente/dateityp.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { speicherbar } from "../inhalt/erechnung.ts";
import { lesenImKind } from "../inhalt/inhalt.ts";
import { OFFICE_TYPEN } from "../inhalt/office.ts";

/*
 * Ansicht als PDF für Office-Dateien über einen Vorschau-Dienst mit der Schnittstelle von Gotenberg
 * (POST /forms/libreoffice/convert, Feld „files“, https://gotenberg.dev/docs/routes#convert-with-libreoffice).
 * LibreOffice läuft dort in einem eigenen Container, nie im Prozess von Belegt, denn es öffnet fremde Dateien.
 */

/** Typ → Endung, an der LibreOffice im Dienst das Format erkennt */
const ENDUNG: Record<string, string> = Object.fromEntries(
  Object.entries({ ...OFFICE_TYPEN, ...ALTE_OFFICE_TYPEN }).map(([endung, typ]) => [typ, endung]),
);
export const MIT_ANSICHT = Object.keys(ENDUNG);

/** Alte Formate liest Belegt selbst nicht; ihr Text für die Suche kommt aus der Ansicht */
const ALT: string[] = Object.values(ALTE_OFFICE_TYPEN);

/** Größer wird keine Ansicht gespeichert */
export const MAX_ANSICHT = 50 * 1024 * 1024;

export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

/** Der Dienst ist gerade nicht da: nichts festhalten, im nächsten Lauf wieder */
const nichtErreichbar = (meldung: string) => Object.assign(new Error(meldung), { nichtErreichbar: true });
const istNichtErreichbar = (err: unknown) => err instanceof Error && "nichtErreichbar" in err;

async function begrenztLesen(res: Response): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_ANSICHT) throw new Error("Ansicht zu groß");
  const teile: Uint8Array[] = [];
  let laenge = 0;
  for await (const teil of res.body ?? []) {
    laenge += teil.length;
    if (laenge > MAX_ANSICHT) throw new Error("Ansicht zu groß");
    teile.push(teil);
  }
  return new Uint8Array(Buffer.concat(teile));
}

export async function zuPdf(
  bytes: Uint8Array,
  mimeType: string,
  url: string,
  { abfragen = fetch, zeitlimit = 120_000 }: { abfragen?: Abfragen; zeitlimit?: number } = {},
): Promise<Uint8Array> {
  const endung = ENDUNG[mimeType];
  if (!endung) throw new Error(`Keine Ansicht für ${mimeType}`);
  const form = new FormData();
  form.append("files", new File([new Uint8Array(bytes)], `dokument.${endung}`));
  let res: Response;
  try {
    res = await abfragen(new URL("/forms/libreoffice/convert", url).href, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(zeitlimit),
    });
  } catch {
    throw nichtErreichbar("Vorschau-Dienst nicht erreichbar");
  }
  if ([502, 503, 504].includes(res.status)) throw nichtErreichbar(`Vorschau-Dienst antwortet ${res.status}`);
  if (!res.ok) throw new Error(`Nicht umwandelbar (${res.status})`);
  const pdf = await begrenztLesen(res);
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-") throw new Error("Antwort ist kein PDF");
  return pdf;
}

/**
 * Erzeugt Ansichten für Office-Dateien ohne Ansicht, die nicht gelöscht sind. Ein Fehler der Datei wird festgehalten,
 * damit sie nicht in jedem Lauf wieder scheitert; ist der Dienst nicht da, endet der Lauf ohne Eintrag.
 */
export async function ansichtenErzeugen(
  { db, speicher }: Umgebung,
  url: string,
  { stapel = 5, abfragen }: { stapel?: number; abfragen?: Abfragen } = {},
) {
  const typen = sql`array[${sql.join(
    MIT_ANSICHT.map((t) => sql`${t}`),
    sql`, `,
  )}]::text[]`;
  const offen = await db.execute<{ id: string; sha256: string; mime_type: string }>(sql`
    select d.id, d.sha256, d.mime_type from dokumente d
     where d.mime_type = any(${typen})
       and not exists (select 1 from ansichten a where a.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am limit ${stapel}`);
  let erzeugt = 0;
  let fehler = 0;
  for (const d of offen) {
    let pdf: Uint8Array;
    try {
      pdf = await zuPdf(new Uint8Array(await speicher.laden(d.sha256)), d.mime_type, url, { abfragen });
    } catch (err) {
      if (istNichtErreichbar(err)) return { erzeugt, fehler, meldung: (err as Error).message };
      const meldung = speicherbar(
        (err instanceof Error ? err.message : "Nicht umwandelbar").split("\n")[0]!.slice(0, 300),
      );
      await db.insert(ansichten).values({ dokumentId: d.id, fehler: meldung }).onConflictDoNothing();
      fehler++;
      continue;
    }
    await db
      .insert(ansichten)
      .values({ dokumentId: d.id, pdf: Buffer.from(pdf) })
      .onConflictDoNothing();
    if (ALT.includes(d.mime_type)) {
      const g = await lesenImKind(pdf, "application/pdf").catch(() => null);
      if (g) await db.insert(inhalte).values({ dokumentId: d.id, text: g.text }).onConflictDoNothing();
    }
    erzeugt++;
  }
  return { erzeugt, fehler };
}

/** Die Ansicht eines Dokuments als PDF, null ohne (noch nicht erzeugt, nicht umwandelbar, kein Office) */
export async function ansichtZu(db: Umgebung["db"], dokumentId: string): Promise<Uint8Array | null> {
  const [a] = await db.select({ pdf: ansichten.pdf }).from(ansichten).where(eq(ansichten.dokumentId, dokumentId));
  return a?.pdf ? new Uint8Array(a.pdf) : null;
}

export async function hatAnsicht(db: Umgebung["db"], dokumentId: string): Promise<boolean> {
  const [a] = await db
    .select({ da: sql<boolean>`${ansichten.pdf} is not null` })
    .from(ansichten)
    .where(eq(ansichten.dokumentId, dokumentId));
  return a?.da ?? false;
}
