import { createHash } from "node:crypto";
import { PSTFile, type PSTFolder, type PSTMessage } from "pst-extractor";

/**
 * Outlook-Datendateien (PST, OST): Outlook speichert Mails nicht als MIME, sondern als Felder. Belegt baut aus jeder
 * Mail eine .eml: die Kopfzeilen aus dem Transport (die Originale, wie sie ankamen), sonst aus den Feldern, dazu Text,
 * HTML und Anhänge. Maßgeblich ist die PST selbst, die als eigenes Dokument unverändert im Archiv liegt (importieren).
 */

/** Kopfzeilen, die zur MIME-Struktur gehören; Belegt baut sie neu, alle anderen bleiben, wie sie ankamen */
const MIME_KOPF = /^(content-[a-z-]+|mime-version)$/i;

const b64 = (b: Uint8Array | string) =>
  Buffer.from(b)
    .toString("base64")
    .replace(/.{76}(?=.)/g, "$&\r\n");

/** Ein Wort nach RFC 2047, wenn es nicht nur aus ASCII besteht */
const kopfwert = (t: string) =>
  /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t.replace(/[\r\n]+/g, " ")).toString("base64")}?=`;

/** Dateiname nach RFC 2231 */
const dateiname = (n: string) => `filename*=UTF-8''${encodeURIComponent(n.replace(/[\r\n"]/g, "_"))}`;

const datum = (d: Date | null) => (d ? d.toUTCString().replace("GMT", "+0000") : null);

function kopfAusTransport(roh: string): string[] {
  // Fortsetzungszeilen beginnen mit Leerraum; sie gehören zur Zeile davor
  const zeilen = roh.replace(/\r?\n(?=[ \t])/g, "\r\n").split(/\r?\n(?![ \t])/);
  return zeilen.filter((z) => z.includes(":") && !MIME_KOPF.test(z.slice(0, z.indexOf(":")).trim()));
}

function kopfAusFeldern(m: PSTMessage): string[] {
  const empfaenger: string[] = [];
  for (let i = 0; i < m.numberOfRecipients; i++) {
    const r = m.getRecipient(i);
    const adresse = r?.smtpAddress || r?.emailAddress;
    if (adresse) empfaenger.push(adresse);
  }
  return [
    `From: ${kopfwert(m.senderName || "")} <${m.senderEmailAddress || "unbekannt@invalid"}>`,
    ...(empfaenger.length ? [`To: ${empfaenger.join(", ")}`] : []),
    `Subject: ${kopfwert(m.subject || "")}`,
    ...(datum(m.clientSubmitTime ?? m.messageDeliveryTime)
      ? [`Date: ${datum(m.clientSubmitTime ?? m.messageDeliveryTime)}`]
      : []),
    ...(m.internetMessageId ? [`Message-ID: ${m.internetMessageId}`] : []),
  ];
}

function anhaenge(m: PSTMessage): { name: string; bytes: Buffer }[] {
  const liste: { name: string; bytes: Buffer }[] = [];
  for (let i = 0; i < m.numberOfAttachments; i++) {
    const a = m.getAttachment(i);
    const strom = a.fileInputStream;
    // Eingebettete Nachrichten und OLE-Objekte haben keinen Dateistrom
    if (!strom) continue;
    const bytes = Buffer.alloc(strom.length.toNumber());
    strom.readCompletely(bytes);
    liste.push({ name: a.longFilename || a.filename || `anhang-${i + 1}`, bytes });
  }
  return liste;
}

/** Die .eml einer Mail aus der PST */
export function emlAusPst(m: PSTMessage): Uint8Array {
  const kopf = m.transportMessageHeaders?.trim() ? kopfAusTransport(m.transportMessageHeaders) : kopfAusFeldern(m);
  // Grenzen aus dem Inhalt, nicht zufällig: Dieselbe Mail ergibt so dieselbe .eml, und ein zweiter Import erkennt sie
  const kennung = createHash("sha256")
    .update(`${kopf.join("\n")}\0${m.body ?? ""}\0${m.bodyHTML ?? ""}`)
    .digest("hex")
    .slice(0, 24);
  const grenze = (() => {
    let n = 0;
    return () => `belegt-${kennung}-${++n}`;
  })();
  const text = `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(m.body ?? "")}`;
  const html = m.bodyHTML?.trim()
    ? `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(m.bodyHTML)}`
    : null;
  let koerper = text;
  if (html) {
    const g = grenze();
    koerper = `Content-Type: multipart/alternative; boundary="${g}"\r\n\r\n--${g}\r\n${text}\r\n--${g}\r\n${html}\r\n--${g}--`;
  }
  const dateien = anhaenge(m);
  if (dateien.length) {
    const g = grenze();
    const teile = dateien.map(
      (d) =>
        `Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; ${dateiname(d.name)}\r\n\r\n${b64(d.bytes)}`,
    );
    koerper = `Content-Type: multipart/mixed; boundary="${g}"\r\n\r\n--${g}\r\n${koerper}\r\n${teile.map((t) => `--${g}\r\n${t}\r\n`).join("")}--${g}--`;
  }
  return Buffer.from(`${[...kopf, "MIME-Version: 1.0"].join("\r\n")}\r\n${koerper}\r\n`);
}

function* ordnerDurchgehen(ordner: PSTFolder): Generator<PSTMessage> {
  if (ordner.hasSubfolders) for (const u of ordner.getSubFolders()) yield* ordnerDurchgehen(u);
  if (ordner.contentCount > 0) {
    for (let m: PSTMessage | null = ordner.getNextChild(); m; m = ordner.getNextChild()) {
      // Nur Mails, keine Termine, Kontakte oder Aufgaben
      if (m.messageClass?.startsWith("IPM.Note")) yield m;
    }
  }
}

export const istPst = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x21 && b[1] === 0x42 && b[2] === 0x44 && b[3] === 0x4e;

/** Jede Mail der PST als .eml */
export function* pstMails(bytes: Uint8Array): Generator<Uint8Array> {
  const pst = new PSTFile(Buffer.from(bytes));
  try {
    for (const m of ordnerDurchgehen(pst.getRootFolder())) yield emlAusPst(m);
  } finally {
    pst.close();
  }
}
