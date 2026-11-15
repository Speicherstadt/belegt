/**
 * Rollen eines Zugangs: Inhaber darf alles, Steuerberatung und Prüfer nur lesen; Mitarbeiter sehen nur ihren
 * Sichtbereich und bearbeiten darin, wenn ihr Recht es erlaubt (docs/zugaenge.md)
 */
export const ROLLEN = ["inhaber", "steuerberatung", "pruefer", "mitarbeiter"] as const;
export type Rolle = (typeof ROLLEN)[number];

/** Recht eines Mitarbeiters innerhalb seines Sichtbereichs */
export const RECHTE = ["lesen", "bearbeiten"] as const;
export type Recht = (typeof RECHTE)[number];

/**
 * Welche Dokumente ein Mitarbeiter sieht: IDs von Tags, Dokumenttypen und Korrespondenten. Innerhalb einer Art reicht
 * einer (ODER), zwischen den Arten müssen alle passen (UND); eine leere Liste schränkt nicht ein. Ein Tag aus
 * ohneTags schließt ein Dokument immer aus. ohneOrdnung: auch Dokumente ganz ohne Tag, Typ und Korrespondent.
 */
export interface Sichtbereich {
  tags: string[];
  dokumenttypen: string[];
  korrespondenten: string[];
  ohneTags: string[];
  ohneOrdnung: boolean;
}

export const darfSchreiben = (rolle: Rolle | null | undefined): boolean => rolle === "inhaber";

/** Wer Dokumente aufnehmen, einordnen und ordnen darf: der Inhaber und Mitarbeiter mit dem Recht bearbeiten */
export const darfBearbeiten = (n: { role: Rolle; recht?: Recht | null } | null | undefined): boolean =>
  !!n && (n.role === "inhaber" || (n.role === "mitarbeiter" && n.recht === "bearbeiten"));
