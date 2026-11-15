import { rm } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { verschluesseln } from "../crypto.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { importe, importZuordnungen, paperlessQuellen } from "../db/schema.ts";
import { adresseAus } from "./api.ts";

/*
 * Quellen, Läufe und Zuordnungen des Imports aus Paperless-ngx. Das API-Token geht nur hinein und liegt verschlüsselt
 * in ciphertext (server/crypto.ts); keine Antwort und kein Eintrag im Audit-Log enthält es. Ein Export liegt bis zum
 * Ende seines Laufs als <id>.zip im Importordner, den Server und Worker teilen.
 */

export const QuelleEingabe = z.object({
  name: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .max(2000)
    .transform((u, ctx) => {
      const a = adresseAus(u);
      if (!a) {
        ctx.addIssue({ code: "custom", message: "Adresse mit http:// oder https://" });
        return z.NEVER;
      }
      return a;
    }),
  token: z.string().trim().min(1).max(500),
});

export const ZuordnungEingabe = z.object({
  art: z.enum(["dokumenttyp", "tag"]),
  name: z.string().trim().min(1).max(200),
  zielArt: z.enum(["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige", "frei"]),
});

export type PaperlessQuelle = Omit<typeof paperlessQuellen.$inferSelect, "ciphertext">;

const ohneGeheimnis = ({ ciphertext: _, ...q }: typeof paperlessQuellen.$inferSelect): PaperlessQuelle => q;

export async function quelleAnlegen(
  db: Datenbank,
  schluessel: Buffer,
  e: z.infer<typeof QuelleEingabe>,
  akteur: string,
): Promise<PaperlessQuelle> {
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(paperlessQuellen)
      .values({ name: e.name, url: e.url, ciphertext: verschluesseln(schluessel, Buffer.from(e.token)) })
      .returning(),
  );
  return ohneGeheimnis(neu!);
}

export async function quellenListen(db: Datenbank): Promise<PaperlessQuelle[]> {
  return (await db.select().from(paperlessQuellen).orderBy(asc(paperlessQuellen.erstelltAm))).map(ohneGeheimnis);
}

const OFFEN = ["wartet", "laeuft"] as const;

/** Ein Fehler, den die Oberfläche zeigen kann (409); keine Klasse, nur ein Error mit Kennung */
export const belegt = (meldung: string) => Object.assign(new Error(meldung), { belegt: true as const });
export const istBelegt = (err: unknown): err is Error & { belegt: true } => err instanceof Error && "belegt" in err;

/** Startet einen Lauf über die API; läuft für die Quelle schon einer, ein Konflikt */
export async function apiLaufStarten(db: Datenbank, quelleId: string, akteur: string) {
  return mitAkteur(db, akteur, async (tx) => {
    // Sperre je Quelle, damit zwei Klicks nicht zwei Läufe anlegen
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`belegt_import:${quelleId}`}, 0))`);
    const [q] = await tx
      .select({ id: paperlessQuellen.id })
      .from(paperlessQuellen)
      .where(eq(paperlessQuellen.id, quelleId));
    if (!q) return null;
    const [offen] = await tx
      .select({ id: importe.id })
      .from(importe)
      .where(and(eq(importe.quelleId, quelleId), inArray(importe.status, [...OFFEN])));
    if (offen) throw belegt("Für diese Quelle läuft schon ein Import");
    const [lauf] = await tx.insert(importe).values({ art: "api", quelleId, gestartetVon: akteur }).returning();
    return lauf!;
  });
}

/**
 * Legt den Lauf für einen hochgeladenen Export an. ablegen legt die Datei unter exportPfad, bevor der Lauf sichtbar wird
 * (in derselben Transaktion): Der Worker findet nie einen Lauf ohne seine Datei.
 */
export async function exportLaufAnlegen(
  db: Datenbank,
  dateiname: string | null,
  akteur: string,
  ablegen: (importId: string) => Promise<void>,
) {
  return mitAkteur(db, akteur, async (tx) => {
    const [lauf] = await tx
      .insert(importe)
      .values({ art: "export", dateiname: dateiname?.slice(0, 300) || null, gestartetVon: akteur })
      .returning();
    await ablegen(lauf!.id);
    return lauf!;
  });
}

export const exportPfad = (ordner: string, importId: string) => join(ordner, `${importId}.zip`);

/** Entfernt den Export eines Laufs aus dem Importordner; fehlt er schon, auch gut */
export const exportEntfernen = (ordner: string | undefined, importId: string) =>
  ordner ? rm(exportPfad(ordner, importId), { force: true }) : Promise.resolve();

export interface Lauf {
  id: string;
  art: "api" | "export";
  quelleId: string | null;
  quelle: string | null;
  dateiname: string | null;
  status: (typeof importe.$inferSelect)["status"];
  gesamt: number | null;
  /** Übernommen, auch die schon vorhandenen und die aus früheren Läufen derselben Quelle */
  uebernommen: number;
  doppelt: number;
  fehler: number;
  meldung: string | null;
  hinweise: string[];
  abbrechen: boolean;
  gestartetVon: string;
  erstelltAm: string;
  begonnenAm: string | null;
  beendetAm: string | null;
}

/** Die Läufe, neueste zuerst, mit ihren Zahlen */
export async function laeufeListen(db: Datenbank, { limit = 50 }: { limit?: number } = {}): Promise<Lauf[]> {
  const zeilen = await db.execute<{
    id: string;
    art: Lauf["art"];
    quelle_id: string | null;
    quelle: string | null;
    dateiname: string | null;
    status: Lauf["status"];
    gesamt: number | null;
    neu: string;
    doppelt: string;
    fehler: string;
    vorher: string;
    meldung: string | null;
    hinweise: string[];
    abbrechen_von: string | null;
    gestartet_von: string;
    erstellt_am: Date;
    begonnen_am: Date | null;
    beendet_am: Date | null;
  }>(sql`
    select i.*, q.name as quelle,
           (select count(*) from import_eintraege e where e.import_id = i.id and e.ergebnis = 'uebernommen') as neu,
           (select count(*) from import_eintraege e where e.import_id = i.id and e.ergebnis = 'doppelt') as doppelt,
           (select count(*) from import_eintraege e where e.import_id = i.id and e.ergebnis = 'fehler') as fehler,
           (select count(distinct e.paperless_id) from import_eintraege e join importe v on v.id = e.import_id
             where i.quelle_id is not null and v.quelle_id = i.quelle_id and v.erstellt_am < i.erstellt_am
               and e.ergebnis in ('uebernommen', 'doppelt')
               and not exists (select 1 from import_eintraege x where x.import_id = i.id and x.paperless_id = e.paperless_id)) as vorher
      from importe i left join paperless_quellen q on q.id = i.quelle_id
     order by i.erstellt_am desc, i.id desc
     limit ${limit}`);
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return [...zeilen].map((z) => ({
    id: z.id,
    art: z.art,
    quelleId: z.quelle_id,
    quelle: z.quelle,
    dateiname: z.dateiname,
    status: z.status,
    gesamt: z.gesamt,
    uebernommen: Number(z.neu) + Number(z.doppelt) + Number(z.vorher),
    doppelt: Number(z.doppelt),
    fehler: Number(z.fehler),
    meldung: z.meldung,
    hinweise: z.hinweise,
    abbrechen: z.abbrechen_von !== null,
    gestartetVon: z.gestartet_von,
    erstelltAm: new Date(z.erstellt_am).toISOString(),
    begonnenAm: iso(z.begonnen_am),
    beendetAm: iso(z.beendet_am),
  }));
}

/** Fehler eines Laufs mit Grund, in der Reihenfolge der Paperless-IDs */
export async function fehlerListen(db: Datenbank, importId: string) {
  const zeilen = await db.execute<{ paperless_id: number; titel: string | null; grund: string }>(sql`
    select paperless_id, titel, grund from import_eintraege
     where import_id = ${importId} and ergebnis = 'fehler' order by paperless_id limit 1000`);
  return [...zeilen].map((z) => ({ paperlessId: Number(z.paperless_id), titel: z.titel, grund: z.grund }));
}

/**
 * Bricht einen Lauf ab: wartet er noch, sofort (und der Export wird entfernt); läuft er, hört der Worker nach dem
 * laufenden Dokument auf. false, wenn es keinen offenen Lauf mit dieser ID gibt.
 */
export async function abbrechen(db: Datenbank, importId: string, akteur: string, importOrdner?: string) {
  const sofort = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(importe)
      .set({ status: "abgebrochen", abbrechenVon: akteur, beendetAm: sql`now()` })
      .where(and(eq(importe.id, importId), eq(importe.status, "wartet")))
      .returning({ id: importe.id, art: importe.art }),
  );
  if (sofort[0]) {
    if (sofort[0].art === "export") await exportEntfernen(importOrdner, importId);
    return true;
  }
  const spaeter = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(importe)
      .set({ abbrechenVon: akteur })
      .where(and(eq(importe.id, importId), eq(importe.status, "laeuft"), sql`${importe.abbrechenVon} is null`))
      .returning({ id: importe.id }),
  );
  return spaeter.length > 0;
}

export async function zuordnungenListen(db: Datenbank) {
  return db
    .select()
    .from(importZuordnungen)
    .orderBy(asc(importZuordnungen.art), asc(sql`lower(${importZuordnungen.name})`));
}

export async function zuordnungAnlegen(db: Datenbank, e: z.infer<typeof ZuordnungEingabe>, akteur: string) {
  try {
    const [neu] = await mitAkteur(db, akteur, (tx) => tx.insert(importZuordnungen).values(e).returning());
    return neu!;
  } catch (err) {
    const c = err as { code?: string; cause?: { code?: string } };
    if ((c.code ?? c.cause?.code) === "23505") throw belegt("Für diesen Namen gibt es schon eine Zuordnung");
    throw err;
  }
}

export async function zuordnungLoeschen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  const weg = await mitAkteur(db, akteur, (tx) =>
    tx.delete(importZuordnungen).where(eq(importZuordnungen.id, id)).returning({ id: importZuordnungen.id }),
  );
  return weg.length > 0;
}

/** Für die Verfahrensdokumentation: abgeschlossene und laufende Läufe mit Zahlen, älteste zuerst */
export async function laeufeFuerVerfahrensdoku(db: Datenbank) {
  return (await laeufeListen(db, { limit: 500 })).filter((l) => l.status !== "wartet").reverse();
}
