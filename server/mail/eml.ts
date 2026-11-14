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
  /** Inhalt des Anhangs, für die Aufnahme als eigenes Dokument */
  bytes: Uint8Array;
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

/** Postgres speichert U+0000 nicht in text; in Kopf und Text einer Mail trägt es nichts */
const ohneNull = <T extends string | null | undefined>(wert: T): T => wert?.replaceAll("\u0000", "") as T;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Adresse = { name: string; address?: string; group?: Adresse[] };

/** Gruppen („Team: a@x, b@y;“) aufgelöst, ohne Einträge ohne Adresse */
function personen(liste: Adresse[] | undefined): Person[] {
  return (liste ?? []).flatMap((a) =>
    a.group
      ? personen(a.group)
      : a.address
        ? [{ name: ohneNull(a.name), adresse: ohneNull(a.address).toLowerCase() }]
        : [],
  );
}

function isoDatum(wert: string | undefined): string | null {
  if (!wert) return null;
  const zeit = Date.parse(wert);
  if (Number.isNaN(zeit)) return null;
  // Jahre außerhalb von 0 bis 9999 schreibt toISOString sechsstellig (+010000-…), das nimmt Postgres nicht an; ein
  // solches Datum ist ohnehin nicht echt, die Mail kommt trotzdem ins Archiv
  const iso = new Date(zeit).toISOString();
  return /^\d{4}-/.test(iso) ? iso : null;
}

/** Message-IDs aus einem Kopf wie References: „<a@x> <b@y>“ */
function messageIds(wert: string | undefined): string[] {
  return ohneNull(wert)?.match(/<[^<>\s]+>/g) ?? [];
}

// Benannte Zeichen von HTML 4 für U+00A0 bis U+00FF, in dieser Reihenfolge (HTML 4.01, Abschnitt 24.2)
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute " +
  "micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig " +
  "Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash " +
  "Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute " +
  "ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc " +
  "uuml yacute thorn yuml";

const ZEICHEN: Record<string, string> = {
  ...Object.fromEntries(LATIN1.split(" ").map((n, i) => [n, String.fromCodePoint(0xa0 + i)])),
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  euro: "€",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  bull: "•",
  trade: "™",
};

/** Zeichenreferenzen in einem Durchgang, damit „&amp;uuml;“ zu „&uuml;“ wird; Unbekanntes bleibt stehen */
function zeichenAufloesen(html: string): string {
  return html.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]*));/g, (roh, dez, hex, name) => {
    if (name) return ZEICHEN[name] ?? roh;
    const code = dez ? Number(dez) : Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : roh;
  });
}

/** Text der Mail; ohne Textteil aus dem HTML, ohne Tags und Skripte */
function klartext(text: string | undefined, html: string | undefined): string {
  if (text?.trim()) return text.trim();
  if (!html) return "";
  const ohneTags = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  // erst nach den Tags, sonst würde „&lt;b&gt;“ als Tag entfernt; &nbsp; wird zu U+00A0 und fällt unter \s
  return zeichenAufloesen(ohneTags).replace(/\s+/g, " ").trim();
}

export async function emlLesen(roh: Uint8Array): Promise<Mail> {
  const mail = await PostalMime.parse(roh, { attachmentEncoding: "arraybuffer" });
  const von = personen(mail.from ? [mail.from as Adresse] : [])[0] ?? null;
  return {
    sha256: sha256(roh),
    von,
    an: personen(mail.to as Adresse[] | undefined),
    kopie: personen(mail.cc as Adresse[] | undefined),
    betreff: ohneNull(mail.subject)?.trim() ?? "",
    datum: isoDatum(mail.date),
    messageId: messageIds(mail.messageId)[0] ?? null,
    antwortAuf: messageIds(mail.inReplyTo)[0] ?? null,
    verweise: messageIds(mail.references),
    text: klartext(ohneNull(mail.text), ohneNull(mail.html)),
    anhaenge: mail.attachments.map((a) => {
      const bytes = typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
      return {
        dateiname: ohneNull(a.filename),
        bytes,
        mimeType: ohneNull(a.mimeType),
        groesse: bytes.byteLength,
        sha256: sha256(bytes),
        eingebettet: a.disposition === "inline" && Boolean(a.contentId),
      };
    }),
  };
}
