import { createHash } from "node:crypto";
import PostalMime from "postal-mime";

/*
 * Zerlegt eine Mail (RFC 5322, .eml) für Suche und Anzeige. Aufbewahrt wird immer das Original: Diese Angaben
 * werden daraus abgeleitet und lassen sich jederzeit neu erzeugen. Der Hash über die Rohdaten belegt, welche
 * Datei gemeint ist.
 */

export interface Person {
  name: string;
  adresse: string;
}

export interface Anhang {
  dateiname: string | null;
  mimeType: string;
  groesse: number;
  sha256: string;
  /** im Text eingebettet (Content-ID), etwa ein Logo */
  eingebettet: boolean;
}

export interface Mail {
  /** SHA-256 der Rohdaten */
  sha256: string;
  von: Person | null;
  an: Person[];
  kopie: Person[];
  betreff: string;
  /** Sendezeit als ISO 8601; null, wenn der Kopf fehlt oder kein Datum ist */
  datum: string | null;
  messageId: string | null;
  antwortAuf: string | null;
  /** Message-IDs aus References, für den Verlauf einer Unterhaltung */
  verweise: string[];
  text: string;
  anhaenge: Anhang[];
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Adresse = { name: string; address?: string; group?: Adresse[] };

/** Gruppen („Team: a@x, b@y;“) aufgelöst, ohne Einträge ohne Adresse */
function personen(liste: Adresse[] | undefined): Person[] {
  return (liste ?? []).flatMap((a) =>
    a.group ? personen(a.group) : a.address ? [{ name: a.name, adresse: a.address.toLowerCase() }] : [],
  );
}

function isoDatum(wert: string | undefined): string | null {
  if (!wert) return null;
  const zeit = Date.parse(wert);
  return Number.isNaN(zeit) ? null : new Date(zeit).toISOString();
}

/** Message-IDs aus einem Kopf wie References: „<a@x> <b@y>“ */
function messageIds(wert: string | undefined): string[] {
  return wert?.match(/<[^<>\s]+>/g) ?? [];
}

/** Text der Mail; ohne Textteil aus dem HTML, ohne Tags und Skripte */
function klartext(text: string | undefined, html: string | undefined): string {
  if (text?.trim()) return text.trim();
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function emlLesen(roh: Uint8Array): Promise<Mail> {
  const mail = await PostalMime.parse(roh, { attachmentEncoding: "arraybuffer" });
  const von = personen(mail.from ? [mail.from as Adresse] : [])[0] ?? null;
  return {
    sha256: sha256(roh),
    von,
    an: personen(mail.to as Adresse[] | undefined),
    kopie: personen(mail.cc as Adresse[] | undefined),
    betreff: mail.subject?.trim() ?? "",
    datum: isoDatum(mail.date),
    messageId: messageIds(mail.messageId)[0] ?? null,
    antwortAuf: messageIds(mail.inReplyTo)[0] ?? null,
    verweise: messageIds(mail.references),
    text: klartext(mail.text, mail.html),
    anhaenge: mail.attachments.map((a) => {
      const bytes = typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
      return {
        dateiname: a.filename,
        mimeType: a.mimeType,
        groesse: bytes.byteLength,
        sha256: sha256(bytes),
        eingebettet: a.disposition === "inline" && Boolean(a.contentId),
      };
    }),
  };
}
