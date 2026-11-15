import { eq, sql } from "drizzle-orm";
import { vorschaubilder } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { speicherbar } from "../inhalt/erechnung.ts";
import { BILDER, rasterVerfuegbar, vorschaubild } from "./raster.ts";

/*
 * Vorschaubilder für Liste und Kacheln, erzeugt im Worker: die erste Seite eines PDFs, ein verkleinertes JPEG oder PNG
 * und bei Office-Dateien die erste Seite ihrer Ansicht (server/ansicht/). Mails, Text und alles andere bekommen keins;
 * die Oberfläche zeigt dort ein Symbol. Abgeleitet wie die Ansicht, maßgeblich bleibt das Original.
 */

/** Größer wird kein Vorschaubild gespeichert; 300 px breit sind es meist 20 bis 60 KB */
export const MAX_VORSCHAUBILD = 1024 * 1024;

const nichtErreichbar = (meldung: string) => Object.assign(new Error(meldung), { nichtErreichbar: true });

/**
 * Erzeugt Vorschaubilder für Dokumente ohne, die nicht gelöscht sind. Ein Fehler der Datei wird festgehalten, damit sie
 * nicht in jedem Lauf wieder scheitert; fehlt der Speicher kurz, endet der Lauf ohne Eintrag. Ohne pdftoppm: nichts.
 */
export async function vorschaubilderErzeugen(
  { db, speicher }: Umgebung,
  { stapel = 10, zeitlimit }: { stapel?: number; zeitlimit?: number } = {},
) {
  if (!rasterVerfuegbar()) return { erzeugt: 0, fehler: 0 };
  const typen = sql`array[${sql.join(
    ["application/pdf", ...BILDER].map((t) => sql`${t}`),
    sql`, `,
  )}]::text[]`;
  const offen = await db.execute<{ id: string; sha256: string; mime_type: string; ansicht: boolean }>(sql`
    select d.id, d.sha256, d.mime_type, a.pdf is not null as ansicht from dokumente d
      left join ansichten a on a.dokument_id = d.id
     where (d.mime_type = any(${typen}) or a.pdf is not null)
       and not exists (select 1 from vorschaubilder v where v.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am desc limit ${stapel}`);
  let erzeugt = 0;
  let fehler = 0;
  for (const d of offen) {
    let bild: Uint8Array;
    try {
      // Office: aus der Ansicht, die schon ein PDF ist; sonst aus dem Original
      const quelle = d.ansicht
        ? await db
            .execute<{ pdf: Buffer }>(sql`select pdf from ansichten where dokument_id = ${d.id}`)
            .then(([a]) => new Uint8Array(a!.pdf))
        : await speicher.laden(d.sha256).then(
            (b) => new Uint8Array(b),
            () => {
              throw nichtErreichbar("Speicher nicht erreichbar");
            },
          );
      bild = await vorschaubild(quelle, d.ansicht ? "application/pdf" : d.mime_type, zeitlimit);
      if (bild.byteLength > MAX_VORSCHAUBILD) throw new Error("Vorschaubild zu groß");
    } catch (err) {
      if (err instanceof Error && "nichtErreichbar" in err) return { erzeugt, fehler, meldung: err.message };
      const meldung = speicherbar(
        (err instanceof Error ? err.message : "Kein Vorschaubild").split("\n")[0]!.slice(0, 300),
      );
      await db.insert(vorschaubilder).values({ dokumentId: d.id, fehler: meldung }).onConflictDoNothing();
      fehler++;
      continue;
    }
    await db
      .insert(vorschaubilder)
      .values({ dokumentId: d.id, bild: Buffer.from(bild) })
      .onConflictDoNothing();
    erzeugt++;
  }
  return { erzeugt, fehler };
}

/** Das Vorschaubild eines Dokuments als JPEG, null ohne (noch nicht erzeugt, nicht möglich) */
export async function vorschaubildZu(db: Umgebung["db"], dokumentId: string): Promise<Uint8Array | null> {
  const [v] = await db
    .select({ bild: vorschaubilder.bild })
    .from(vorschaubilder)
    .where(eq(vorschaubilder.dokumentId, dokumentId));
  return v?.bild ? new Uint8Array(v.bild) : null;
}
