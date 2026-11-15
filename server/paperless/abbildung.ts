import { createHash } from "node:crypto";
import { type Feldtyp, GRENZE } from "../../shared/ordnung.ts";

/*
 * Abbildung von Paperless-ngx auf Belegt, gleich für API und Export (rein, ohne Datenbank). Die Feldtypen stehen in
 * paperless-ngx src/documents/models.py (CustomField.FieldDataType), die Speicherung der Werte in
 * CustomFieldInstance.TYPE_TO_DATA_STORE_NAME_MAP, die Prüfung eines Betrags in src/documents/serialisers.py
 * (CustomFieldInstanceSerializer.validate: „EUR12.50“ oder ältere Zahlen wie „12.5“).
 */

/** Ein eigenes Feld aus Paperless-ngx; optionen nur bei select, waehrung nur bei monetary (extra_data) */
export interface PaperlessFeld {
  id: number;
  name: string;
  typ: string;
  optionen: { id: string; label: string }[];
  waehrung: string | null;
}

/** Wie ein Paperless-Feld in Belegt ankommt; hinweis, wenn es nicht eins zu eins geht */
export interface Feldabbildung {
  typ: Feldtyp;
  optionen: string[];
  hinweis: string | null;
}

/** Optionen einer Auswahl in Belegt: 1 bis 100 Zeichen, ohne Groß- und Kleinschreibung eindeutig, höchstens 50 */
function optionenPassen(labels: string[]): boolean {
  const sauber = labels.map((l) => l.trim());
  return (
    sauber.length >= 1 &&
    sauber.length <= 50 &&
    sauber.every((l) => l.length >= 1 && l.length <= 100) &&
    new Set(sauber.map((l) => l.toLowerCase())).size === sauber.length
  );
}

/**
 * Feldtyp in Belegt: string und longtext → Text, integer → Zahl, monetary → Betrag, date → Datum, boolean → Ja/Nein,
 * select → Auswahl, url → Link. Kommazahlen, Verweise auf Dokumente und unbekannte Typen werden Text, mit Hinweis.
 */
export function feldAbbilden(f: PaperlessFeld): Feldabbildung {
  const text = (hinweis: string | null): Feldabbildung => ({ typ: "text", optionen: [], hinweis });
  switch (f.typ) {
    case "string":
    case "longtext":
      return text(null);
    case "integer":
      return { typ: "zahl", optionen: [], hinweis: null };
    case "monetary":
      return { typ: "betrag", optionen: [], hinweis: null };
    case "date":
      return { typ: "datum", optionen: [], hinweis: null };
    case "boolean":
      return { typ: "ja_nein", optionen: [], hinweis: null };
    case "url":
      return { typ: "link", optionen: [], hinweis: null };
    case "select": {
      const labels = f.optionen.map((o) => o.label.trim());
      return optionenPassen(labels)
        ? { typ: "auswahl", optionen: labels, hinweis: null }
        : text(
            `Feld „${f.name}“: Die Optionen passen nicht in eine Auswahl (1 bis 50, je bis 100 Zeichen), als Text übernommen`,
          );
    }
    case "float":
      return text(`Feld „${f.name}“ (Kommazahl) als Text übernommen`);
    case "documentlink":
      return text(`Feld „${f.name}“ (Verweis auf Dokumente) als Text mit den Paperless-IDs übernommen`);
    default:
      return text(`Feld „${f.name}“ hat einen unbekannten Typ (${f.typ}), als Text übernommen`);
  }
}

/**
 * Betrag aus Paperless-ngx als ganze Cent in Euro: „EUR12.50“, „EUR-3.10“ oder ohne Währung („12.5“, dann gilt die
 * Vorgabe des Feldes, sonst Euro). Nur aus den Ziffern gerechnet, nie mit einer Fließkommazahl. Andere Währungen gehen
 * nicht in einen Betrag; dann ein Grund.
 */
export function centAusPaperless(wert: unknown, standardWaehrung: string | null): { cent: number } | { grund: string } {
  const t = typeof wert === "number" ? String(wert) : typeof wert === "string" ? wert.trim() : "";
  const treffer = /^([A-Z]{3})?(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!treffer) return { grund: `kein Betrag: ${t || String(wert)}` };
  const [, waehrung, minus, euro, cent = ""] = treffer;
  const w = waehrung ?? (standardWaehrung || "EUR");
  if (w !== "EUR") return { grund: `andere Währung als Euro: ${t}` };
  const ziffern = `${euro}${cent.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  if (ziffern.length > String(GRENZE).length || Number(ziffern) > GRENZE) return { grund: `Betrag zu groß: ${t}` };
  const n = Number(ziffern);
  return { cent: minus && n !== 0 ? -n : n };
}

/** Ein Wert für ein Feld in Belegt, oder Text für die Notiz, wenn er dort nicht hineinpasst; null bei leerem Wert */
export type Abgebildet = { wert: string | number | boolean } | { notiz: string } | null;

/** Der Wert eines Paperless-Feldes für das Feld in Belegt mit dem Typ ziel */
export function wertAbbilden(f: PaperlessFeld, ziel: Feldtyp, wert: unknown): Abgebildet {
  if (wert === null || wert === undefined || wert === "" || (Array.isArray(wert) && wert.length === 0)) return null;
  const notiz = (grund?: string) => ({ notiz: `${f.name}: ${anzeige(wert)}${grund ? ` (${grund})` : ""}` });
  if (f.typ === "select") {
    // Neu: die ID der Option; ältere Versionen speicherten den Index in einer Liste von Texten
    const label = f.optionen.find((o) => o.id === String(wert))?.label.trim();
    if (!label) return notiz("unbekannte Option");
    return { wert: label };
  }
  if (f.typ === "monetary" && ziel === "betrag") {
    const r = centAusPaperless(wert, f.waehrung);
    return "cent" in r ? { wert: r.cent } : notiz(r.grund);
  }
  if (f.typ === "documentlink") return { wert: `Paperless-ngx: ${(wert as unknown[]).join(", ")}` };
  if (ziel === "zahl") return typeof wert === "number" && Number.isInteger(wert) ? { wert } : notiz("keine ganze Zahl");
  if (ziel === "ja_nein") return typeof wert === "boolean" ? { wert } : notiz("weder ja noch nein");
  if (ziel === "datum") {
    const tag = tagAus(String(wert));
    return tag ? { wert: tag } : notiz("kein Datum");
  }
  const t = anzeige(wert);
  // Text in Belegt hat höchstens 1000 Zeichen; Längeres geht vollständig in die Notiz
  if (ziel === "text" && t.length > 1000) return notiz("länger als 1000 Zeichen");
  return { wert: t };
}

const anzeige = (wert: unknown) => (typeof wert === "string" ? wert : JSON.stringify(wert));

/**
 * Tag der Entstehung aus created: neuere Versionen liefern ein Datum („2026-03-01“, models.Document.created ist ein
 * DateField), ältere einen Zeitpunkt; der wird in deutscher Zeit genommen
 */
export function tagAus(created: string | null | undefined): string | null {
  if (!created) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(created)) return echterTag(created);
  const d = new Date(created);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

function echterTag(t: string): string | null {
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null;
}

/**
 * Prüfsumme aus Paperless-ngx gegen die geladenen Bytes: Seit der Migration 0016_sha256_checksums ist es der SHA-256
 * (src/documents/utils.py, compute_checksum), davor der MD5; die Länge sagt, welcher.
 */
export function pruefsummePasst(bytes: Uint8Array, pruefsumme: string): boolean {
  const p = pruefsumme.trim().toLowerCase();
  const verfahren = p.length === 32 ? "md5" : p.length === 64 ? "sha256" : null;
  if (!verfahren) return false;
  return createHash(verfahren).update(bytes).digest("hex") === p;
}

/** Eine Notiz aus Paperless-ngx: der Text, darunter Autor und Zeitpunkt von dort; höchstens 5000 Zeichen */
export function notizText(text: string, autor: string | null, erstellt: string | null): string {
  const fuss = `\n\n(Paperless-ngx: ${autor || "unbekannt"}${erstellt ? `, ${erstellt}` : ""})`;
  const inhalt = text.trim();
  const platz = 5000 - fuss.length;
  return `${inhalt.length > platz ? `${inhalt.slice(0, platz - 1)}…` : inhalt}${fuss}`;
}

/** Werte, die in kein Feld passten, als eine Notiz; höchstens 5000 Zeichen */
export function restNotiz(zeilen: string[]): string | null {
  if (!zeilen.length) return null;
  const t = `Aus Paperless-ngx, ohne passendes Feld:\n${zeilen.join("\n")}`;
  return t.length > 5000 ? `${t.slice(0, 4999)}…` : t;
}
