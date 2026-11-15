import { type Bedingung, type Merkmale as RegelMerkmale, trifft } from "./regeln.ts";

/*
 * Workflows (docs/workflows.md): Auslöser → Bedingungen → Aktionen. Hier steht, wann ein Workflow auf ein Dokument
 * zutrifft, ohne Datenbank; ausgeführt wird im Worker (server/workflows/). Absender, Domain, Betreff und Anhangtyp
 * prüft dieselbe Logik wie bei den Regeln (shared/regeln.ts). Alle gesetzten Bedingungen müssen zutreffen; ein
 * Workflow ohne Bedingung trifft jedes Dokument seines Auslösers.
 */

export const AUSLOESER = ["eingang", "eingeordnet"] as const;
export type Ausloeser = (typeof AUSLOESER)[number];

export const WORKFLOW_QUELLEN = ["upload", "mail", "ordner", "api", "abgeleitet", "import"] as const;

export interface WorkflowBedingungen extends Bedingung {
  /** Eine der Quellen des Dokuments */
  quellen?: (typeof WORKFLOW_QUELLEN)[number][];
  dateinameEnthaelt?: string;
  /** Teil des gelesenen Texts (PDF, Office, Texterkennung) oder des Texts einer Mail; wartet, bis er gelesen ist */
  textEnthaelt?: string;
  /** Typ der Datei genau (application/pdf) oder mit Stern (image/*) */
  mimeTyp?: string;
  /** Das Dokument hat jeden dieser Tags (IDs) */
  tags?: string[];
  /** ID eines Dokumenttyps oder „ohne“ */
  dokumenttyp?: string;
  /** Name des Postfachs, aus dem eine Mail (oder die Mail eines Anhangs) kam */
  postfach?: string;
  /** Unterordner im Eingangsordner, auch tiefer liegende („Steuer“ trifft „Steuer/2026“) */
  unterordner?: string;
}

export interface DokumentMerkmale {
  quelle: string;
  dateiname: string | null;
  mimeType: string;
  /** Kopf der Mail, bei einem Anhang der seiner Mail; null ohne Mail */
  mail: { absender: string | null; betreff: string; anhangTypen: string[] } | null;
  /** Gelesener Text; null, wenn keine Bedingung ihn braucht */
  text: string | null;
  tags: string[];
  dokumenttyp: string | null;
  /** Akteur der Aufnahme im Audit-Log, etwa system:imap:Büro oder system:ordner:Steuer/2026 */
  herkunft: string | null;
}

const klein = (t: string | null | undefined) => (t ?? "").toLowerCase();
const enthaelt = (in_: string | null | undefined, teil: string) => klein(in_).includes(teil.toLowerCase());

/** Ob ein Workflow mit diesen Bedingungen den Text des Dokuments braucht (dann wartet er, bis er gelesen ist) */
export const brauchtText = (b: WorkflowBedingungen) => !!b.textEnthaelt?.trim();

function mimePasst(muster: string, typ: string): boolean {
  const m = muster.trim().toLowerCase();
  return m.endsWith("/*") ? typ.toLowerCase().startsWith(m.slice(0, -1)) : typ.toLowerCase() === m;
}

/** Postfach aus der Herkunft: system:imap:<Name> oder system:jmap:<Name> */
const postfachAus = (herkunft: string | null) => /^system:(?:imap|jmap):(.*)$/.exec(herkunft ?? "")?.[1] ?? null;
/** Unterordner aus der Herkunft: system:ordner:<Pfad>; im Eingangsordner selbst leer */
const unterordnerAus = (herkunft: string | null) =>
  herkunft === "system:ordner" ? "" : (/^system:ordner:(.*)$/.exec(herkunft ?? "")?.[1] ?? null);

/** Ob alle gesetzten Bedingungen auf das Dokument zutreffen */
export function bedingungenErfuellt(b: WorkflowBedingungen, m: DokumentMerkmale): boolean {
  if (b.quellen?.length && !b.quellen.includes(m.quelle as (typeof WORKFLOW_QUELLEN)[number])) return false;
  if (b.dateinameEnthaelt && !enthaelt(m.dateiname, b.dateinameEnthaelt)) return false;
  if (b.textEnthaelt && !enthaelt(m.text, b.textEnthaelt)) return false;
  if (b.mimeTyp && !mimePasst(b.mimeTyp, m.mimeType)) return false;
  if (b.tags?.length && !b.tags.every((t) => m.tags.includes(t))) return false;
  if (b.dokumenttyp === "ohne" ? m.dokumenttyp !== null : b.dokumenttyp && m.dokumenttyp !== b.dokumenttyp)
    return false;
  if (b.postfach && klein(postfachAus(m.herkunft)) !== klein(b.postfach.trim())) return false;
  if (b.unterordner) {
    const ziel = klein(b.unterordner.trim().replace(/^\/+|\/+$/g, ""));
    const pfad = unterordnerAus(m.herkunft);
    if (pfad === null || (klein(pfad) !== ziel && !klein(pfad).startsWith(`${ziel}/`))) return false;
  }
  // Absender, Domain, Betreff und Anhangtyp wie bei den Regeln: ohne Mail ist der Dateiname der Betreff
  const regel: Bedingung = {
    absender: b.absender,
    domain: b.domain,
    betreffEnthaelt: b.betreffEnthaelt,
    anhangTyp: b.anhangTyp,
  };
  if (Object.values(regel).some(Boolean)) {
    const merkmale: RegelMerkmale = {
      absender: m.mail?.absender ?? null,
      betreff: m.mail?.betreff ?? m.dateiname ?? "",
      anhangTypen: m.mail ? m.mail.anhangTypen : [m.mimeType],
    };
    if (!trifft(regel, merkmale)) return false;
  }
  return true;
}
