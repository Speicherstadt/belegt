import type { PaperlessFeld } from "./abbildung.ts";
import type { PaperlessDokument } from "./kern.ts";

/*
 * manifest.json aus dem document_exporter von Paperless-ngx (src/documents/management/commands/document_exporter.py):
 * eine Liste von Datensätzen im Format der Django-Serialisierung ({model, pk, fields}). Belegt liest nur Dokumente,
 * Korrespondenten, Dokumenttypen, Tags, eigene Felder mit ihren Werten, Notizen und die Namen der Benutzer; alles andere
 * (Passwörter, Postfächer, Tokens) ignoriert es. Mit --split-manifest stehen Dokument, Notizen und Feldwerte je
 * Dokument in einer eigenen Datei „…-manifest.json“; dann kommen mehrere Listen. Das Original eines Dokuments steht
 * unter __exported_file_name__ (documents/settings.py, EXPORTER_FILE_NAME), seine Prüfsumme in fields.checksum.
 */

export const DATEINAME = "__exported_file_name__";

export type ExportDokument = PaperlessDokument & { datei: string | null };

export interface Export {
  felder: PaperlessFeld[];
  dokumente: ExportDokument[];
  /** Dokumente im Papierkorb von Paperless-ngx, nicht übernommen */
  papierkorb: number;
}

type Satz = { model: string; pk: number; fields: Record<string, unknown>; [DATEINAME]?: unknown };

const text = (x: unknown): string | null => (typeof x === "string" ? x : null);
const zahl = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) ? x : null);

function istSatz(x: unknown): x is Satz {
  const s = x as Satz;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.model === "string" &&
    zahl(s.pk) !== null &&
    typeof s.fields === "object" &&
    s.fields !== null
  );
}

/** Optionen einer Auswahl: neu [{id, label}], älter eine Liste von Texten, deren Index der Wert ist */
export function optionenAus(extra: unknown): { id: string; label: string }[] {
  const liste = (extra as { select_options?: unknown } | null)?.select_options;
  if (!Array.isArray(liste)) return [];
  return liste.flatMap((o, i) => {
    if (typeof o === "string") return [{ id: String(i), label: o }];
    const id = (o as { id?: unknown })?.id;
    const label = text((o as { label?: unknown })?.label);
    return label !== null && (typeof id === "string" || typeof id === "number") ? [{ id: String(id), label }] : [];
  });
}

export const waehrungAus = (extra: unknown) => text((extra as { default_currency?: unknown } | null)?.default_currency);

/** Spalte des Wertes je Typ, wie CustomFieldInstance.TYPE_TO_DATA_STORE_NAME_MAP (src/documents/models.py) */
const WERTSPALTE: Record<string, string> = {
  string: "value_text",
  url: "value_url",
  date: "value_date",
  boolean: "value_bool",
  integer: "value_int",
  float: "value_float",
  monetary: "value_monetary",
  documentlink: "value_document_ids",
  select: "value_select",
  longtext: "value_long_text",
};

/** Die Datensätze aus einer oder mehreren Manifest-Dateien als Dokumente mit Namen statt IDs */
export function manifestLesen(teile: unknown[]): Export {
  const saetze = teile.flatMap((t) => {
    if (!Array.isArray(t)) throw new Error("manifest.json ist keine Liste");
    return t.filter(istSatz);
  });
  const namen = (model: string, feld: string) =>
    new Map(saetze.filter((s) => s.model === model).map((s) => [s.pk, text(s.fields[feld]) ?? ""]));
  const korrespondenten = namen("documents.correspondent", "name");
  const typen = namen("documents.documenttype", "name");
  const tags = namen("documents.tag", "name");
  const nutzer = namen("auth.user", "username");
  const felder: PaperlessFeld[] = saetze
    .filter((s) => s.model === "documents.customfield")
    .map((s) => ({
      id: s.pk,
      name: text(s.fields.name) ?? `Feld ${s.pk}`,
      typ: text(s.fields.data_type) ?? "string",
      optionen: optionenAus(s.fields.extra_data),
      waehrung: waehrungAus(s.fields.extra_data),
    }));
  const typJeFeld = new Map(felder.map((f) => [f.id, f.typ]));

  const jeDokument = <T>(model: string, abbilden: (s: Satz) => T | null) => {
    const m = new Map<number, T[]>();
    for (const s of saetze) {
      const d = zahl(s.fields.document);
      if (s.model !== model || d === null || s.fields.deleted_at) continue;
      const wert = abbilden(s);
      if (wert !== null) m.set(d, [...(m.get(d) ?? []), wert]);
    }
    return m;
  };
  const notizen = jeDokument("documents.note", (s) => {
    const t = text(s.fields.note);
    const u = zahl(s.fields.user);
    return t ? { text: t, autor: u === null ? null : (nutzer.get(u) ?? null), erstellt: text(s.fields.created) } : null;
  });
  const werte = jeDokument("documents.customfieldinstance", (s) => {
    const feldId = zahl(s.fields.field);
    if (feldId === null) return null;
    const spalte = WERTSPALTE[typJeFeld.get(feldId) ?? ""];
    return { feldId, wert: spalte ? s.fields[spalte] : null };
  });

  const alle = saetze.filter((s) => s.model === "documents.document");
  const lebend = alle.filter((s) => !s.fields.deleted_at);
  // Versionen (root_document) gehören zu ihrem Stamm; übernommen wird die neueste, wie Paperless-ngx sie zeigt
  // (src/documents/versioning.py, sort_versions_newest_first)
  const versionen = new Map<number, Satz[]>();
  for (const s of lebend) {
    const stamm = zahl(s.fields.root_document);
    if (stamm !== null) versionen.set(stamm, [...(versionen.get(stamm) ?? []), s]);
  }
  const staemme = lebend.filter((s) => zahl(s.fields.root_document) === null);
  const dokumente = staemme.map((s): ExportDokument => {
    const neueste = [s, ...(versionen.get(s.pk) ?? [])].sort(
      (a, b) => (zahl(b.fields.version_index) ?? 0) - (zahl(a.fields.version_index) ?? 0) || b.pk - a.pk,
    )[0]!;
    const f = s.fields;
    const datei = text(neueste[DATEINAME]);
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is number => zahl(i) !== null) : []);
    const name = (m: Map<number, string>, id: unknown) => (zahl(id) === null ? null : (m.get(id as number) ?? null));
    return {
      id: s.pk,
      titel: text(f.title),
      korrespondent: name(korrespondenten, f.correspondent),
      dokumenttyp: name(typen, f.document_type),
      tags: ids(f.tags).flatMap((t) => (tags.get(t) ? [tags.get(t)!] : [])),
      created: text(f.created),
      asn: zahl(f.archive_serial_number),
      dateiname: text(neueste.fields.original_filename) ?? (datei ? (datei.split("/").pop() ?? null) : null),
      pruefsumme: text(neueste.fields.checksum),
      notizen: notizen.get(s.pk) ?? [],
      felder: werte.get(s.pk) ?? [],
      datei,
    };
  });
  return { felder, dokumente, papierkorb: alle.filter((s) => s.fields.deleted_at && !s.fields.root_document).length };
}

/** Namen der Manifest-Dateien in einem Export: manifest.json und mit --split-manifest die „…-manifest.json“ */
export const istManifest = (name: string) => name === "manifest.json" || name.endsWith("-manifest.json");
