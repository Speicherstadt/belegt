import { sha256Of } from "@firsttris/gobd-kern/dateispeicher";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import { dokumente, mails, postfachAktionen, postfachMails, quellen } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { type AbrufOptionen, type Oeffnen, type Ordner, quellenAkteur, type Zugang, zugangZu } from "./abruf.ts";
import { jmapBearbeiten } from "./jmap.ts";

/*
 * Führt die Aktionen nach dem Abholen aus (Einstellung in aktionen.ts). Wie bei Paperless-ngx (src/paperless_mail/
 * mail.py, apply_mail_action als Abschluss nach der Aufnahme) läuft eine Aktion nur für eine Mail, die im Archiv liegt;
 * hier wird das vor jeder Aktion erneut geprüft: Dokument als Mail in der Datenbank, Datei aus dem Speicher gelesen und
 * ihr SHA-256 gleich. Löschen zusätzlich nur mit Bestätigung, nach der Wartezeit und, wenn verlangt, erst mit Sperre im
 * Bucket; vorher wird die Mail aus dem Postfach geholt und ihr Hash verglichen. Jedes Ergebnis steht im Protokoll
 * (postfach_aktionen, wächst nur an); ein Fehler wird höchstens VERSUCHE-mal wiederholt.
 */

type QuelleZeile = typeof quellen.$inferSelect;
type Eintrag = typeof postfachMails.$inferSelect;
type Ergebnis = "ausgefuehrt" | "entfallen" | "fehler";

export const VERSUCHE = 5;
/** Abstand nach dem n-ten Fehler: 15 Minuten, dann jeweils doppelt so lang */
const abstand = (versuche: number) => 15 * 60_000 * 2 ** (versuche - 1);
const STAPEL = 200;

export interface AktionenErgebnis {
  ausgefuehrt: number;
  entfallen: number;
  fehler: number;
}

/** Eine Aktion an einer Mail im Postfach; IMAP und JMAP setzen sie um (imapAdapter, jmapAdapter) */
interface Adapter {
  /** Grund, aus dem der Eintrag in diesem Postfach nicht mehr adressierbar ist (UIDVALIDITY) */
  unpassend(e: Eintrag): string | null;
  /** Der Zielordner, IMAP über den Pfad, JMAP über die Mailbox-ID; null, wenn es ihn nicht gibt */
  zielordner(id: string): Promise<Ordner | null>;
  gibtEs(e: Eintrag): Promise<boolean>;
  roh(e: Eintrag): Promise<Uint8Array | null>;
  gelesen(e: Eintrag): Promise<void>;
  markieren(e: Eintrag): Promise<void>;
  verschieben(e: Eintrag, ziel: string): Promise<void>;
  loeschen(e: Eintrag): Promise<void>;
  schliessen(): Promise<void>;
}

/** Löschen, oder Verschieben in einen Papierkorb (papierkorb.ts): Bestätigung, Wartezeit, Sperre, Hash-Vergleich */
export const wieLoeschen = (q: Pick<QuelleZeile, "aktion" | "aktionZielPapierkorb">) =>
  q.aktion === "loeschen" || (q.aktion === "verschieben" && q.aktionZielPapierkorb);

const meldungVon = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** Fällige Einträge: offen, Wiederholung erreicht; Löschen erst nach der Wartezeit und gegebenenfalls mit Sperre */
async function faellige({ db }: Umgebung, q: QuelleZeile, jetzt: Date) {
  const loeschen = wieLoeschen(q);
  return db
    .select()
    .from(postfachMails)
    .where(
      and(
        eq(postfachMails.quelleId, q.id),
        eq(postfachMails.status, "offen"),
        lte(postfachMails.naechsterVersuch, jetzt),
        loeschen
          ? lte(postfachMails.archiviertAm, new Date(jetzt.getTime() - q.loeschenWarteStunden * 3_600_000))
          : undefined,
        loeschen && q.loeschenNachSperre
          ? sql`exists (select 1 from objektsperren o where o.sha256 = ${postfachMails.sha256}
                         and o.bis >= (${jetzt.toISOString()}::timestamptz at time zone 'Europe/Berlin')::date)`
          : undefined,
      ),
    )
    .orderBy(asc(postfachMails.erstelltAm), asc(postfachMails.id))
    .limit(STAPEL);
}

/**
 * Liegt die Mail nachweislich im Archiv? Dokument als Mail mit diesem Hash, nicht gelöscht, Datei gelesen und Hash
 * gleich. Nach einer bestätigten Löschung bleibt die Zeile in dokumente als Nachweis, und die Datei kann noch im
 * Speicher liegen (Entfernen gescheitert oder nachgeholt, server/loeschung/loeschung.ts); im Archiv ist die Mail nicht.
 */
async function imArchiv({ db, speicher }: Umgebung, e: Eintrag) {
  const [d] = await db
    .select({ sha256: dokumente.sha256 })
    .from(dokumente)
    .innerJoin(mails, eq(mails.dokumentId, dokumente.id))
    .where(
      and(
        eq(dokumente.id, e.dokumentId),
        sql`not exists (select 1 from loeschungen l where l.dokument_id = ${dokumente.id} and l.bestaetigt_am is not null)`,
      ),
    );
  if (!d || d.sha256 !== e.sha256) throw new Error("Die Mail liegt nicht im Archiv");
  const bytes = await speicher.laden(e.sha256).catch((err) => {
    throw new Error(`Original im Speicher nicht lesbar: ${meldungVon(err)}`);
  });
  if (sha256Of(bytes) !== e.sha256) throw new Error("Original im Speicher weicht vom Hash ab");
}

/** Protokolliert ein Ergebnis und schreibt den Eintrag fort, in einer Transaktion */
async function festhalten(
  { db }: Umgebung,
  akteur: string,
  q: QuelleZeile,
  e: Eintrag,
  ergebnis: Ergebnis,
  { meldung = null, endgueltig = false, jetzt }: { meldung?: string | null; endgueltig?: boolean; jetzt: Date },
) {
  const versuche = e.versuche + (ergebnis === "fehler" ? 1 : 0);
  const status =
    ergebnis === "ausgefuehrt"
      ? "erledigt"
      : ergebnis === "entfallen"
        ? "entfallen"
        : endgueltig || versuche >= VERSUCHE
          ? "fehlgeschlagen"
          : "offen";
  await mitAkteur(db, akteur, async (tx) => {
    await tx.insert(postfachAktionen).values({
      postfachMailId: e.id,
      quelleId: q.id,
      dokumentId: e.dokumentId,
      aktion: q.aktion,
      ziel: q.aktion === "verschieben" ? (q.aktionZielPfad ?? q.aktionZiel) : null,
      ordner: e.ordner,
      uidValidity: e.uidValidity,
      uid: e.uid,
      jmapId: e.jmapId,
      ergebnis,
      meldung,
    });
    await tx
      .update(postfachMails)
      .set({
        status,
        versuche,
        letzterFehler: ergebnis === "fehler" ? meldung : e.letzterFehler,
        naechsterVersuch: status === "offen" ? new Date(jetzt.getTime() + abstand(versuche)) : e.naechsterVersuch,
      })
      .where(and(eq(postfachMails.id, e.id), eq(postfachMails.status, "offen")));
  });
}

/** Führt die Aktion an den geprüften Einträgen aus; ein Fehler betrifft nur seinen Eintrag */
async function anwenden(
  a: Adapter,
  q: QuelleZeile,
  eintraege: Eintrag[],
  melden: (e: Eintrag, ergebnis: Ergebnis, meldung?: string | null, endgueltig?: boolean) => Promise<void>,
) {
  // Wie Paperless-ngx (_handle_mail_rule): beim Verschieben zuerst prüfen, ob es den Zielordner gibt
  if (q.aktion === "verschieben") {
    const ziel = await a.zielordner(q.aktionZiel!);
    const name = q.aktionZielPfad ?? q.aktionZiel;
    const grund = !ziel
      ? `Zielordner „${name}“ gibt es nicht`
      : ziel.papierkorb && !wieLoeschen(q)
        ? `Zielordner „${name}“ ist ein Papierkorb; Verschieben dorthin muss wie Löschen bestätigt werden`
        : null;
    if (grund) {
      for (const e of eintraege) await melden(e, "fehler", grund);
      return;
    }
  }
  for (const e of eintraege) {
    const grund = a.unpassend(e);
    if (grund) {
      await melden(e, "entfallen", grund);
      continue;
    }
    try {
      if (wieLoeschen(q)) {
        // Gelöscht (oder in den Papierkorb gelegt) wird nur, was Byte für Byte dem Original im Archiv entspricht
        const roh = await a.roh(e);
        if (!roh) {
          await melden(e, "entfallen", "Die Mail liegt nicht mehr im Ordner");
          continue;
        }
        if (sha256Of(roh) !== e.sha256) {
          await melden(e, "fehler", "Die Mail im Postfach weicht vom Original im Archiv ab; nicht gelöscht", true);
          continue;
        }
        if (q.aktion === "loeschen") await a.loeschen(e);
        else await a.verschieben(e, q.aktionZiel!);
      } else {
        if (!(await a.gibtEs(e))) {
          await melden(e, "entfallen", "Die Mail liegt nicht mehr im Ordner");
          continue;
        }
        if (q.aktion === "gelesen") await a.gelesen(e);
        else if (q.aktion === "markieren") await a.markieren(e);
        else if (q.aktion === "verschieben") await a.verschieben(e, q.aktionZiel!);
      }
      await melden(e, "ausgefuehrt");
    } catch (err) {
      await melden(e, "fehler", meldungVon(err));
    }
  }
}

async function imapAdapter(oeffnen: Oeffnen, zugang: Zugang): Promise<Adapter> {
  const postfach = await oeffnen({ ...zugang, schreiben: true });
  const b = postfach.bearbeiten;
  if (!b) {
    await postfach.schliessen().catch(() => {});
    throw new Error("Das Postfach lässt sich nicht zum Schreiben öffnen");
  }
  return {
    // UIDs gelten nur zusammen mit UIDVALIDITY (RFC 3501, 2.3.1.1); nach einem Wechsel ordnet der nächste Abruf die
    // Mail neu zu, als doppelt erkannt
    unpassend: (e) =>
      e.uidValidity === postfach.uidValidity
        ? null
        : "UIDVALIDITY des Ordners hat sich geändert; der nächste Abruf ordnet die Mail neu zu",
    zielordner: async (id) => (await postfach.ordner?.())?.find((o) => o.id === id) ?? null,
    gibtEs: (e) => b.gibtEs(e.uid!),
    roh: (e) => b.roh(e.uid!),
    gelesen: (e) => b.flagge(e.uid!, "\\Seen"),
    markieren: (e) => b.flagge(e.uid!, "\\Flagged"),
    verschieben: (e, ziel) => b.verschieben(e.uid!, ziel),
    loeschen: (e) => b.loeschen(e.uid!),
    schliessen: () => postfach.schliessen(),
  };
}

async function jmapAdapter(zugang: Zugang, abfragen: AbrufOptionen["abfragen"]): Promise<Adapter> {
  const j = await jmapBearbeiten(zugang, abfragen);
  return {
    unpassend: (e) => (e.jmapId ? null : "Keine Email-ID"),
    zielordner: async (id) => j.ziel(id),
    gibtEs: (e) => j.gibtEs(e.jmapId!),
    roh: (e) => j.roh(e.jmapId!),
    gelesen: (e) => j.schluesselwort(e.jmapId!, "$seen"),
    markieren: (e) => j.schluesselwort(e.jmapId!, "$flagged"),
    verschieben: (e, ziel) => j.verschieben(e.jmapId!, ziel),
    loeschen: (e) => j.loeschen(e.jmapId!),
    schliessen: async () => {},
  };
}

/**
 * Führt die fälligen Aktionen einer Quelle aus. Ohne fällige Einträge baut es keine Verbindung auf. Ist die Aktion
 * abgeschaltet, entfällt, was noch offen war; eine Verbindung, die nicht zustande kommt oder abbricht, zählt als Fehler
 * der betroffenen Einträge.
 */
export async function aktionenAusfuehren(
  umgebung: Umgebung,
  schluessel: Buffer,
  quelleId: string,
  oeffnen: Oeffnen,
  { jetzt = new Date(), ...optionen }: AbrufOptionen & { jetzt?: Date } = {},
): Promise<AktionenErgebnis> {
  const ergebnis: AktionenErgebnis = { ausgefuehrt: 0, entfallen: 0, fehler: 0 };
  const [q] = await umgebung.db.select().from(quellen).where(eq(quellen.id, quelleId));
  if (!q?.aktiv) return ergebnis;
  const akteur = quellenAkteur(q);
  const erledigt = new Set<string>();
  const melden = async (e: Eintrag, art: Ergebnis, meldung: string | null = null, endgueltig = false) => {
    await festhalten(umgebung, akteur, q, e, art, { meldung, endgueltig, jetzt });
    erledigt.add(e.id);
    ergebnis[art]++;
  };

  if (q.aktion === "keine") {
    const offen = await umgebung.db
      .select()
      .from(postfachMails)
      .where(and(eq(postfachMails.quelleId, q.id), eq(postfachMails.status, "offen")))
      .limit(STAPEL);
    for (const e of offen) await melden(e, "entfallen", "Keine Aktion mehr eingestellt");
    return ergebnis;
  }
  // Die Datenbank lässt Löschen ohne Bestätigung nicht zu (quellen_loeschen_bestaetigt); hier noch einmal
  if (wieLoeschen(q) && !q.loeschenBestaetigtAm) return ergebnis;

  const geprueft: Eintrag[] = [];
  for (const e of await faellige(umgebung, q, jetzt)) {
    try {
      await imArchiv(umgebung, e);
      geprueft.push(e);
    } catch (err) {
      await melden(e, "fehler", meldungVon(err));
    }
  }
  // Je Ordner eine Verbindung: Die UID gilt in dem Ordner, aus dem die Mail abgeholt wurde
  const nachOrdner = new Map<string, Eintrag[]>();
  for (const e of geprueft) nachOrdner.set(e.ordner, [...(nachOrdner.get(e.ordner) ?? []), e]);
  for (const [ordner, eintraege] of nachOrdner) {
    let adapter: Adapter | null = null;
    try {
      const zugang = { ...(await zugangZu(umgebung.db, schluessel, q, akteur, optionen)), ordner };
      adapter = q.art === "jmap" ? await jmapAdapter(zugang, optionen.abfragen) : await imapAdapter(oeffnen, zugang);
      await anwenden(adapter, q, eintraege, melden);
    } catch (err) {
      for (const e of eintraege) if (!erledigt.has(e.id)) await melden(e, "fehler", meldungVon(err));
    } finally {
      await adapter?.schliessen().catch(() => {});
    }
  }
  return ergebnis;
}
