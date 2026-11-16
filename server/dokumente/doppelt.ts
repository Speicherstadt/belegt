import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { mitAkteur, type Tx } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { type Sicht, sichtBedingung } from "../zugang/sicht.ts";
import { type Dokument, type Eingang, type Umgebung, zeileAnlegen } from "./dokumente.ts";

/*
 * Doppelte Dateien (docs/eingang.md#doppelte-dateien): Dieselbe Datei (SHA-256 des Originals) kommt nur einmal ins
 * Archiv, gleich ob hochgeladen, aus dem Eingangsordner, über die Schnittstelle oder als Anhang einer Mail. Gelöschte
 * Dokumente (Löschung bestätigt) zählen nicht. Abgeleitete Dokumente und Importe prüfen selbst (server/seiten/,
 * server/paperless/).
 */

/** Das vorhandene Dokument; id und asn null, wenn der Zugang es nicht sehen darf (nur „liegt schon vor“) */
export type Vorhanden = { id: string; asn: number } | { id: null; asn: null };

export const sha256Von = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Sperre je Hash bis zum Ende der Transaktion: Zwei gleichzeitige Aufnahmen derselben Datei prüfen nacheinander, die
 * zweite findet die erste
 */
export async function hashSperren(tx: Tx, sha256: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`belegt_datei:${sha256}`}, 0))`);
}

/**
 * Das älteste nicht gelöschte Dokument mit diesem Original, null ohne. Mit eingeschränkter Sicht das älteste, das der
 * Zugang sieht; sieht er keins, nur dass es eins gibt, ohne ID und Archivnummer.
 */
export async function vorhandenes(db: Datenbank | Tx, sha256: string, sicht?: Sicht): Promise<Vorhanden | null> {
  const [z] = await db.execute<{ id: string; asn: string; sichtbar: boolean }>(sql`
    select d.id, a.nummer as asn, ${sichtBedingung("d.id", sicht)} as sichtbar
      from dokumente d join archivnummern a on a.dokument_id = d.id
     where d.sha256 = ${sha256}
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by 3 desc, d.eingegangen_am, d.id limit 1`);
  if (!z) return null;
  return z.sichtbar ? { id: z.id, asn: Number(z.asn) } : { id: null, asn: null };
}

export type Aufnahme = { dokument: Dokument; vorhanden?: undefined } | { dokument?: undefined; vorhanden: Vorhanden };

/**
 * Nimmt ein Original auf, wenn es noch nicht im Archiv liegt; sonst das vorhandene Dokument und nichts Neues. Die
 * Datei kommt erst in den Speicher, wenn sie neu ist; Prüfung und Zeile laufen unter der Sperre des Hashs.
 */
export async function aufnehmenEinmal(umgebung: Umgebung, eingang: Eingang, sicht?: Sicht): Promise<Aufnahme> {
  const sha256 = sha256Von(eingang.bytes);
  const schon = await vorhandenes(umgebung.db, sha256, sicht);
  if (schon) return { vorhanden: schon };
  await umgebung.speicher.speichern(eingang.bytes);
  return mitAkteur(umgebung.db, eingang.akteur, async (tx) => {
    await hashSperren(tx, sha256);
    const inzwischen = await vorhandenes(tx, sha256, sicht);
    if (inzwischen) return { vorhanden: inzwischen };
    return { dokument: await zeileAnlegen(tx, sha256, eingang) };
  });
}
