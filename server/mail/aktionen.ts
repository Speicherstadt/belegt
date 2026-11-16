import { sha256Of } from "@firsttris/gobd-kern/dateispeicher";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumente, postfachAktionen, postfachMails, quellen } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { type AbrufOptionen, type Oeffnen, type Ordner, quellenAkteur, zugangZu } from "./abruf.ts";
import { jmapOrdner } from "./jmap.ts";

/*
 * Aktionen im Postfach nach dem Abholen, je Quelle eine: keine (Vorgabe), als gelesen markieren, markieren
 * (Flag/Stern), in einen Ordner verschieben, löschen. Vorbild ist Paperless-ngx (src/paperless_mail/mail.py: MarkRead-,
 * Flag-, Move- und DeleteMailAction, ausgeführt erst nach der Aufnahme). Hier: Einstellen, Vormerken beim Abruf, Ordner
 * und Protokoll; ausgeführt wird in aktionen-ausfuehren.ts.
 */

export const AKTIONEN = ["keine", "gelesen", "markieren", "verschieben", "loeschen"] as const;
export type Aktion = (typeof AKTIONEN)[number];

export const AktionEingabe = z
  .object({
    aktion: z.enum(AKTIONEN),
    /** Zielordner für verschieben: bei IMAP der volle Pfad, bei JMAP die Mailbox-ID (aus ordnerListen) */
    ziel: z.string().trim().min(1).max(200).nullable().default(null),
    /** Löschen frühestens so viele Stunden nach der Archivierung (1 bis 90 Tage) */
    warteStunden: z.number().int().min(1).max(2160).default(24),
    /** Löschen erst, wenn die Datei im S3-Bucket bis zum Fristende gesperrt ist */
    nachSperre: z.boolean().default(false),
    /** Ausdrückliche Bestätigung des Inhabers; ohne sie wird Löschen abgelehnt */
    loeschenBestaetigt: z.boolean().default(false),
  })
  .refine((e) => e.aktion !== "verschieben" || e.ziel, { message: "Zielordner fehlt", path: ["ziel"] })
  .refine((e) => e.aktion !== "loeschen" || e.loeschenBestaetigt, {
    message: "Löschen im Postfach muss ausdrücklich bestätigt werden",
    path: ["loeschenBestaetigt"],
  });

/** Stellt die Aktion einer Quelle ein; die Bestätigung des Löschens hält fest, wer und wann (Audit-Log über quellen) */
export async function aktionEinstellen(
  db: Datenbank,
  quelleId: string,
  e: z.infer<typeof AktionEingabe>,
  akteur: string,
  /** Der Zielordner aus ordnerListen, beim Verschieben */
  ziel: Ordner | null = null,
) {
  const loeschen = e.aktion === "loeschen";
  const [q] = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(quellen)
      .set({
        aktion: e.aktion,
        aktionZiel: e.aktion === "verschieben" ? e.ziel : null,
        aktionZielPfad: e.aktion === "verschieben" ? (ziel?.pfad ?? e.ziel) : null,
        loeschenWarteStunden: e.warteStunden,
        loeschenNachSperre: loeschen && e.nachSperre,
        loeschenBestaetigtVon: loeschen ? akteur : null,
        loeschenBestaetigtAm: loeschen ? new Date() : null,
      })
      .where(eq(quellen.id, quelleId))
      .returning({ id: quellen.id }),
  );
  return q ?? null;
}

/** Wo die Mail im Postfach liegt: IMAP über Ordner, UIDVALIDITY und UID, JMAP über die Email-ID */
export type Adresse = { ordner: string } & ({ uidValidity: number; uid: number } | { jmapId: string });

/**
 * Merkt eine Mail für die Aktion vor. Aufgerufen erst, wenn die Aufnahme festgeschrieben ist; ein Trigger prüft
 * zusätzlich, dass das Dokument als Mail mit diesem Hash im Archiv liegt. Eine schon vorgemerkte Mail bleibt, wie sie
 * ist (zweiter Abruf, neuer Abruf nach UIDVALIDITY-Wechsel mit derselben UID).
 */
export async function vormerken(
  db: Datenbank,
  akteur: string,
  m: { quelleId: string; dokumentId: string; roh: Uint8Array } & Adresse,
) {
  const [d] = await db
    .select({ eingegangenAm: dokumente.eingegangenAm })
    .from(dokumente)
    .where(eq(dokumente.id, m.dokumentId));
  if (!d) throw new Error("Mail nicht im Archiv");
  await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(postfachMails)
      .values({
        quelleId: m.quelleId,
        dokumentId: m.dokumentId,
        sha256: sha256Of(m.roh),
        ordner: m.ordner,
        ...("jmapId" in m ? { jmapId: m.jmapId } : { uidValidity: m.uidValidity, uid: m.uid }),
        // Ein doppeltes Dokument lag schon vorher im Archiv; die Wartezeit zählt ab dem ersten Eingang
        archiviertAm: d.eingegangenAm,
      })
      .onConflictDoNothing(),
  );
}

/** Ordner des Kontos für die Wahl des Zielordners; wirft, wenn das Postfach nicht erreichbar ist */
export async function ordnerListen(
  { db }: Umgebung,
  schluessel: Buffer,
  quelleId: string,
  oeffnen: Oeffnen,
  optionen: AbrufOptionen = {},
): Promise<Ordner[] | null> {
  const [q] = await db.select().from(quellen).where(eq(quellen.id, quelleId));
  if (!q) return null;
  const zugang = await zugangZu(db, schluessel, q, quellenAkteur(q), optionen);
  if (q.art === "jmap") return jmapOrdner(zugang, optionen.abfragen);
  const postfach = await oeffnen(zugang);
  try {
    if (!postfach.ordner) throw new Error("Das Postfach nennt keine Ordner");
    return await postfach.ordner();
  } finally {
    await postfach.schliessen().catch(() => {});
  }
}

/** Stand der Warteschlange und die letzten Einträge im Protokoll einer Quelle */
export async function protokoll(db: Datenbank, quelleId: string, anzahl = 50) {
  const zahlen = await db
    .select({ status: postfachMails.status, anzahl: sql<number>`count(*)::int` })
    .from(postfachMails)
    .where(eq(postfachMails.quelleId, quelleId))
    .groupBy(postfachMails.status);
  const stand = { offen: 0, erledigt: 0, entfallen: 0, fehlgeschlagen: 0 };
  for (const z of zahlen) stand[z.status] = z.anzahl;
  const eintraege = await db
    .select({
      id: postfachAktionen.id,
      dokumentId: postfachAktionen.dokumentId,
      aktion: postfachAktionen.aktion,
      ziel: postfachAktionen.ziel,
      ordner: postfachAktionen.ordner,
      uidValidity: postfachAktionen.uidValidity,
      uid: postfachAktionen.uid,
      jmapId: postfachAktionen.jmapId,
      ergebnis: postfachAktionen.ergebnis,
      meldung: postfachAktionen.meldung,
      zeit: postfachAktionen.zeit,
    })
    .from(postfachAktionen)
    .where(eq(postfachAktionen.quelleId, quelleId))
    .orderBy(desc(postfachAktionen.zeit), desc(postfachAktionen.id))
    .limit(anzahl);
  return { stand, eintraege };
}
