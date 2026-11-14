import { and, eq, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import { dokumente, mailAnhaenge, mails } from "../db/schema.ts";
import { dateityp } from "../dokumente/dateityp.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { aufnehmen } from "../dokumente/dokumente.ts";
import { emlLesen } from "./eml.ts";
import { mboxAufteilen } from "./mbox.ts";
import { istPst, pstMails } from "./pst.ts";

/** Ein MBOX-Archiv beginnt mit einer From-Zeile (RFC 4155), eine einzelne Mail nicht */
const istMbox = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "From ";

/** Zeichen, die in Dateinamen stören, und Steuerzeichen */
// biome-ignore lint/suspicious/noControlCharactersInRegex: gerade Steuerzeichen sollen aus dem Dateinamen
const STOERT = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** Dateiname für das Original: Betreff ohne Zeichen, die in Dateinamen stören */
function emlName(betreff: string): string {
  const sauber = betreff.replace(STOERT, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${sauber || "Mail"}.eml`;
}

export interface Ergebnis {
  neu: string[];
  /** schon vorhanden (gleiche Rohdaten): nicht doppelt aufgenommen */
  doppelt: string[];
  /** Bei einer Outlook-Datei (PST, OST) das Dokument der Datei selbst */
  pst?: string;
}

/**
 * Nimmt eine Mail auf: die .eml unverändert als Dokument, ihre Angaben in mails, jeden Anhang als eigenes Dokument
 * mit Verweis. Alles in einer Transaktion; die Dateien liegen vorher schon unter ihrem Hash. Eine Mail mit denselben
 * Rohdaten kommt nicht doppelt (etwa bei wiederholtem Import desselben Archivs).
 */
export async function mailAufnehmen(
  { db, speicher }: Umgebung,
  roh: Uint8Array,
  quelle: "mail" | "api",
  akteur: string,
): Promise<{ id: string; neu: boolean }> {
  const mail = await emlLesen(roh);
  const [schon] = await db
    .select({ id: dokumente.id })
    .from(dokumente)
    .innerJoin(mails, eq(mails.dokumentId, dokumente.id))
    .where(and(eq(dokumente.sha256, mail.sha256)));
  if (schon) return { id: schon.id, neu: false };

  await speicher.speichern(roh);
  for (const a of mail.anhaenge) await speicher.speichern(a.bytes);

  const id = await mitAkteur(db, akteur, async (tx) => {
    const [original] = await tx
      .insert(dokumente)
      .values({
        sha256: mail.sha256,
        groesse: roh.byteLength,
        mimeType: "message/rfc822",
        dateiname: emlName(mail.betreff),
        quelle,
      })
      .returning({ id: dokumente.id });
    await tx.insert(mails).values({
      dokumentId: original!.id,
      messageId: mail.messageId,
      antwortAuf: mail.antwortAuf,
      verweise: mail.verweise,
      von: mail.von?.adresse ?? null,
      an: mail.an.map((p) => p.adresse),
      betreff: mail.betreff,
      gesendetAm: mail.datum ? new Date(mail.datum) : null,
      text: mail.text,
    });
    for (const a of mail.anhaenge) {
      const [anhang] = await tx
        .insert(dokumente)
        .values({
          sha256: a.sha256,
          groesse: a.groesse,
          mimeType: dateityp(a.bytes, a.mimeType ?? "application/octet-stream"),
          dateiname: a.dateiname,
          quelle,
        })
        .returning({ id: dokumente.id });
      await tx
        .insert(mailAnhaenge)
        .values({ mailDokumentId: original!.id, anhangDokumentId: anhang!.id, eingebettet: a.eingebettet });
    }
    return original!.id;
  });
  return { id, neu: true };
}

/** Eine .eml oder ein MBOX-Archiv: jede Mail für sich, in ihrer Reihenfolge */
export async function importieren(
  umgebung: Umgebung,
  bytes: Uint8Array,
  akteur: string,
  dateiname: string | null = null,
): Promise<Ergebnis> {
  const ergebnis: Ergebnis = { neu: [], doppelt: [] };
  if (istPst(bytes)) {
    // Die PST selbst ist das Original; die Mails daraus sind aus ihren Feldern gebaut (pst.ts)
    const original = await aufnehmen(umgebung, { bytes, dateiname, quelle: "upload", akteur });
    ergebnis.pst = original.id;
  }
  const mails = istPst(bytes) ? pstMails(bytes) : istMbox(bytes) ? mboxAufteilen(bytes) : [bytes];
  for (const roh of mails) {
    const { id, neu } = await mailAufnehmen(umgebung, roh, "mail", akteur);
    (neu ? ergebnis.neu : ergebnis.doppelt).push(id);
  }
  return ergebnis;
}

export interface MailAnsicht {
  messageId: string | null;
  von: string | null;
  an: string[];
  betreff: string;
  gesendetAm: string | null;
  text: string;
  anhaenge: { dokumentId: string; dateiname: string | null; mimeType: string; eingebettet: boolean }[];
  /** Mails derselben Unterhaltung, nach Sendezeit; enthält die Mail selbst */
  unterhaltung: { dokumentId: string; betreff: string; von: string | null; gesendetAm: string | null }[];
  /** Ist das Dokument ein Anhang, die Mail, zu der es gehört */
  ausMail: string | null;
}

/** Angaben zur Mail eines Dokuments; für einen Anhang die Mail, aus der er stammt */
export async function mailZuDokument(db: Umgebung["db"], dokumentId: string): Promise<MailAnsicht | null> {
  const [teil] = await db
    .select({ mail: mailAnhaenge.mailDokumentId })
    .from(mailAnhaenge)
    .where(eq(mailAnhaenge.anhangDokumentId, dokumentId));
  const mailId = teil?.mail ?? dokumentId;
  const [m] = await db.select().from(mails).where(eq(mails.dokumentId, mailId));
  if (!m) return null;
  const anhaenge = await db
    .select({
      dokumentId: dokumente.id,
      dateiname: dokumente.dateiname,
      mimeType: dokumente.mimeType,
      eingebettet: mailAnhaenge.eingebettet,
    })
    .from(mailAnhaenge)
    .innerJoin(dokumente, eq(dokumente.id, mailAnhaenge.anhangDokumentId))
    .where(eq(mailAnhaenge.mailDokumentId, mailId));
  // Unterhaltung: alle Mails, die eine Message-ID dieser Kette nennen oder tragen (References, In-Reply-To)
  const kette = [...new Set([m.messageId, ...m.verweise].filter((x): x is string => !!x))];
  const ids = sql`array[${sql.join(
    kette.map((k) => sql`${k}`),
    sql`, `,
  )}]::text[]`;
  const unterhaltung = kette.length
    ? await db.execute<{ dokument_id: string; betreff: string; von: string | null; gesendet_am: Date | null }>(sql`
        select dokument_id, betreff, von, gesendet_am from mails
         where message_id = any(${ids}) or verweise && ${ids} or antwort_auf = any(${ids})
         order by gesendet_am nulls last, dokument_id`)
    : [];
  const eigene = { dokument_id: mailId, betreff: m.betreff, von: m.von, gesendet_am: m.gesendetAm };
  return {
    messageId: m.messageId,
    von: m.von,
    an: m.an,
    betreff: m.betreff,
    gesendetAm: m.gesendetAm?.toISOString() ?? null,
    text: m.text,
    anhaenge,
    unterhaltung: (unterhaltung.length ? [...unterhaltung] : [eigene]).map((u) => ({
      dokumentId: u.dokument_id,
      betreff: u.betreff,
      von: u.von,
      gesendetAm: u.gesendet_am ? new Date(u.gesendet_am).toISOString() : null,
    })),
    ausMail: teil?.mail ?? null,
  };
}
