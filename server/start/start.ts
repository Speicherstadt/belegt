import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Angemeldet } from "../auth.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { quellen, startKacheln } from "../db/schema.ts";
import { laeufeListen } from "../paperless/laeufe.ts";
import { sichtBedingung, sichtVon } from "../zugang/sicht.ts";

/*
 * Zahlen für die Startseite (docs/eingang.md#startseite). Gelöschte Dokumente zählen nirgends als aktiv. Der Prüfer
 * bekommt nur, was in seinem Zeitraum liegt, und nichts zu Fristen, Löschanträgen, Sperren, Quellen und Speicher,
 * die er auch sonst nicht sieht. Kette und Zeitstempel holt die Oberfläche aus /api/pruefung und /api/zeitstempel.
 */

export interface FristEintrag {
  id: string;
  asn: number;
  titel: string | null;
  dateiname: string | null;
  fristBis: string;
}

export interface Start {
  /** Im Eingang: noch nicht eingeordnet */
  eingang: number;
  gesamt: number;
  /** In diesem Kalenderjahr eingegangen */
  diesesJahr: number;
  /** Frist endet in den nächsten 90 Tagen (löschbar ab dem Tag danach); die nächsten fünf */
  fristen?: { anzahl: number; naechste: FristEintrag[] };
  loeschantraege?: number;
  sperren?: { aktiv: number; dokumente: number };
  quellen?: {
    postfaecher: {
      id: string;
      name: string;
      art: string;
      aktiv: boolean;
      letzterAbruf: string | null;
      letzterFehler: string | null;
    }[];
    /** Nur mit Eingangsordner: wann zuletzt ein Dokument von dort kam */
    ordner: { letzterEingang: string | null } | null;
    /** Der neueste Lauf aus Paperless-ngx */
    paperless: { status: string; fehler: number; uebernommen: number; zeitpunkt: string } | null;
  };
  /** Größe der Originale im Speicher, jede Datei einmal; ohne gelöschte */
  speicher?: { bytes: number; dateien: number };
}

const geloescht = sql`exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)`;

/** Die Zahlen der Startseite für einen Zugang; heute ist der Tag in Deutschland (JJJJ-MM-TT) */
export async function startZahlen(
  db: Datenbank,
  nutzer: Pick<Angemeldet, "id" | "role" | "zeitraum" | "sichtbereich">,
  { heute, eingangsordner = false }: { heute: string; eingangsordner?: boolean },
): Promise<Start> {
  const sicht = sichtVon(nutzer);
  const [zahlen] = await db.execute<{ gesamt: string; eingang: string; dieses_jahr: string; fristen: string }>(sql`
    with aktiv as (
      select d.id, d.eingegangen_am, e.id as einordnung, e.frist_bis
        from dokumente d
        left join lateral (select x.id, x.frist_bis from einordnungen x where x.dokument_id = d.id
                            order by x.erstellt_am desc, x.id desc limit 1) e on true
       where not ${geloescht} and ${sichtBedingung("d.id", sicht)}
    )
    select count(*) as gesamt,
           count(*) filter (where einordnung is null) as eingang,
           count(*) filter (where (eingegangen_am at time zone 'Europe/Berlin')::date
                                  >= date_trunc('year', ${heute}::date)::date) as dieses_jahr,
           count(*) filter (where frist_bis between ${heute}::date and ${heute}::date + 90) as fristen
      from aktiv`);
  const basis: Start = {
    eingang: Number(zahlen?.eingang ?? 0),
    gesamt: Number(zahlen?.gesamt ?? 0),
    diesesJahr: Number(zahlen?.dieses_jahr ?? 0),
  };
  if (sicht) return basis;
  const [naechste, betrieb, postfaecher, ordner, laeufe] = await Promise.all([
    fristenNaechste(db, heute),
    betriebZahlen(db),
    db
      .select({
        id: quellen.id,
        name: quellen.name,
        art: quellen.art,
        aktiv: quellen.aktiv,
        letzterAbruf: quellen.letzterAbruf,
        letzterFehler: quellen.letzterFehler,
      })
      .from(quellen)
      .orderBy(asc(quellen.erstelltAm)),
    eingangsordner
      ? db.execute<{ zuletzt: Date | null }>(
          sql`select max(eingegangen_am) as zuletzt from dokumente where quelle = 'ordner'`,
        )
      : null,
    laeufeListen(db, { limit: 1 }),
  ]);
  const lauf = laeufe[0];
  return {
    ...basis,
    fristen: { anzahl: Number(zahlen?.fristen ?? 0), naechste },
    ...betrieb,
    quellen: {
      postfaecher: postfaecher.map((p) => ({
        ...p,
        letzterAbruf: p.letzterAbruf?.toISOString() ?? null,
      })),
      ordner: ordner ? { letzterEingang: iso(ordner[0]?.zuletzt ?? null) } : null,
      paperless: lauf
        ? {
            status: lauf.status,
            fehler: lauf.fehler,
            uebernommen: lauf.uebernommen,
            zeitpunkt: lauf.beendetAm ?? lauf.begonnenAm ?? lauf.erstelltAm,
          }
        : null,
    },
  };
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

async function fristenNaechste(db: Datenbank, heute: string): Promise<FristEintrag[]> {
  const zeilen = await db.execute<{
    id: string;
    asn: string;
    titel: string | null;
    dateiname: string | null;
    frist_bis: string;
  }>(sql`
    select d.id, a.nummer as asn, e.titel, d.dateiname, e.frist_bis::text as frist_bis
      from dokumente d
      join archivnummern a on a.dokument_id = d.id
      join lateral (select x.titel, x.frist_bis from einordnungen x where x.dokument_id = d.id
                     order by x.erstellt_am desc, x.id desc limit 1) e on true
     where not ${geloescht} and e.frist_bis between ${heute}::date and ${heute}::date + 90
     order by e.frist_bis, a.nummer
     limit 5`);
  return [...zeilen].map((r) => ({
    id: r.id,
    asn: Number(r.asn),
    titel: r.titel,
    dateiname: r.dateiname,
    fristBis: r.frist_bis,
  }));
}

/** Offene Löschanträge, Sperren mit den Dokumenten darin, Größe der Originale */
async function betriebZahlen(db: Datenbank): Promise<Pick<Start, "loeschantraege" | "sperren" | "speicher">> {
  const [r] = await db.execute<{
    antraege: string;
    sperren: string;
    gesperrt: string;
    bytes: string | null;
    dateien: string;
  }>(sql`
    select (select count(*) from loeschungen where bestaetigt_am is null) as antraege,
           (select count(*) from sperren where aufgehoben_am is null) as sperren,
           (select count(*) from dokumente d
              join lateral (select x.entstanden from einordnungen x where x.dokument_id = d.id
                             order by x.erstellt_am desc, x.id desc limit 1) e on true
             where not ${geloescht}
               and exists (select 1 from sperren s where s.aufgehoben_am is null
                              and e.entstanden between s.von and s.bis)) as gesperrt,
           (select sum(groesse) from (select distinct on (d.sha256) d.groesse from dokumente d
                                       where not ${geloescht}) f) as bytes,
           (select count(distinct d.sha256) from dokumente d where not ${geloescht}) as dateien`);
  return {
    loeschantraege: Number(r?.antraege ?? 0),
    sperren: { aktiv: Number(r?.sperren ?? 0), dokumente: Number(r?.gesperrt ?? 0) },
    speicher: { bytes: Number(r?.bytes ?? 0), dateien: Number(r?.dateien ?? 0) },
  };
}

/* Kacheln aus gespeicherten Ansichten: je Zugang eine Liste in Reihenfolge */

export const KachelEingabe = z.object({ ansichten: z.array(z.uuid()).max(12) });

/** Die Ansichten, die ein Zugang auf seiner Startseite zeigt, in Reihenfolge; nur solche, die er (noch) sieht */
export async function kachelnListen(db: Datenbank, nutzer: Angemeldet): Promise<string[]> {
  const zeilen = await db.execute<{ ansicht_id: string }>(sql`
    select k.ansicht_id from start_kacheln k
      join gespeicherte_ansichten a on a.id = k.ansicht_id
     where k.besitzer = ${nutzer.id}
       and (a.besitzer = ${nutzer.id} or (a.fuer_alle and ${nutzer.role !== "pruefer"}))
     order by k.reihenfolge`);
  return [...zeilen].map((z) => z.ansicht_id);
}

/**
 * Ersetzt die Kacheln eines Zugangs. Jede Ansicht muss er sehen dürfen (eigene oder für alle, nicht für den Prüfer);
 * sonst false und nichts ändert sich. Nur Unterschiede kommen ins Audit-Log.
 */
export async function kachelnSetzen(db: Datenbank, nutzer: Angemeldet, ids: string[], akteur: string) {
  const eindeutig = [...new Set(ids)];
  return mitAkteur(db, akteur, async (tx) => {
    if (eindeutig.length) {
      const [r] = await tx.execute<{ n: string }>(sql`
        select count(*) as n from gespeicherte_ansichten a
         where a.id = any(array[${sql.join(
           eindeutig.map((id) => sql`${id}`),
           sql`, `,
         )}]::uuid[])
           and (a.besitzer = ${nutzer.id} or (a.fuer_alle and ${nutzer.role !== "pruefer"}))`);
      if (Number(r?.n) !== eindeutig.length) return false;
    }
    const bisher = await tx.select().from(startKacheln).where(eq(startKacheln.besitzer, nutzer.id));
    for (const k of bisher)
      if (!eindeutig.includes(k.ansichtId))
        await tx
          .delete(startKacheln)
          .where(and(eq(startKacheln.besitzer, nutzer.id), eq(startKacheln.ansichtId, k.ansichtId)));
    for (const [reihenfolge, ansichtId] of eindeutig.entries()) {
      const da = bisher.find((k) => k.ansichtId === ansichtId);
      if (!da) await tx.insert(startKacheln).values({ besitzer: nutzer.id, ansichtId, reihenfolge });
      else if (da.reihenfolge !== reihenfolge)
        await tx
          .update(startKacheln)
          .set({ reihenfolge })
          .where(and(eq(startKacheln.besitzer, nutzer.id), eq(startKacheln.ansichtId, ansichtId)));
    }
    return true;
  });
}
