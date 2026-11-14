import { sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { objektsperren } from "../db/schema.ts";
import type { SperrbarerSpeicher } from "./s3.ts";

/**
 * Hält die Sperren im Bucket mit den Fristen gleich: Jede Datei bleibt mindestens bis zum Ende des letzten Tags der
 * längsten Frist ihrer Dokumente gesperrt. Läuft im Worker, damit jeder Weg der Einordnung erfasst ist; ein Fehler
 * lässt den Eintrag offen, der nächste Lauf versucht es wieder.
 */

/** 0 Uhr in Berlin am Tag nach `datum` (JJJJ-MM-TT), als Zeitpunkt; ab dann darf gelöscht werden */
export function nachFristende(datum: string): Date {
  const [j, m, t] = datum.split("-").map(Number) as [number, number, number];
  const mitternachtUtc = Date.UTC(j, m - 1, t + 1);
  for (const stunden of [1, 2]) {
    const kandidat = new Date(mitternachtUtc - stunden * 3_600_000);
    const zeit = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(kandidat);
    if (zeit === "00:00") return kandidat;
  }
  return new Date(mitternachtUtc);
}

export async function sperrenAbgleichen(db: Datenbank, speicher: SperrbarerSpeicher, { stapel = 100 } = {}) {
  const offen = await db.execute<{ sha256: string; bis: string }>(sql`
    select d.sha256, max(e.frist_bis)::text as bis
      from dokumente d
      join lateral (select frist_bis from einordnungen x where x.dokument_id = d.id
                     order by x.erstellt_am desc, x.id desc limit 1) e on true
      left join objektsperren o on o.sha256 = d.sha256
     where e.frist_bis is not null
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     group by d.sha256, o.bis
    having o.bis is null or max(e.frist_bis) > o.bis
     limit ${stapel}`);
  let gesetzt = 0;
  let fehler: string | null = null;
  for (const o of offen) {
    try {
      await speicher.sperren(o.sha256, nachFristende(o.bis));
      await db
        .insert(objektsperren)
        .values({ sha256: o.sha256, bis: o.bis })
        .onConflictDoUpdate({ target: objektsperren.sha256, set: { bis: o.bis, gesetztAm: new Date() } });
      gesetzt++;
    } catch (err) {
      fehler = err instanceof Error ? err.message : String(err);
    }
  }
  return { gesetzt, fehler };
}
