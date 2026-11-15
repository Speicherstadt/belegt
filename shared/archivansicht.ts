/*
 * Der Zustand der Archivliste als URL-Suchparameter: Suche, Gruppe, Tags mit Modus, Dokumenttyp, Korrespondent, ein
 * Feldfilter,
 * Sortierung, Darstellung und Einträge je Seite. Dieselbe Form steht in einer gespeicherten Ansicht
 * (server/archivansichten/), damit eine Ansicht nur ein Link ist und sich teilen lässt. Alles sind einfache Texte, mehrere
 * Tags mit Komma getrennt; Unbekanntes oder Ungültiges fällt auf die Vorgabe zurück, statt die Seite zu brechen.
 */

export const GRUPPEN = ["alle", "offen", "pflicht", "freiwillig", "frei", "loeschbar", "geloescht"] as const;
export type ListenGruppe = (typeof GRUPPEN)[number];

/** neu: zuletzt eingegangen zuerst (Vorgabe); alt: zuerst eingegangen; titel: nach Titel oder Dateiname; entstanden:
 * Tag der Entstehung, neueste zuerst; frist: Fristende, das nächste zuerst */
export const SORTIERUNGEN = ["neu", "alt", "titel", "entstanden", "frist"] as const;
export type Sortierung = (typeof SORTIERUNGEN)[number];

export const PRO_SEITE_WAHL = [25, 50, 100] as const;
export const PRO_SEITE_VORGABE = 50;

export interface FeldFilterZustand {
  feldId: string;
  art: "gesetzt" | "enthaelt" | "bereich";
  text: string;
  von: string;
  bis: string;
}

export interface ArchivAnsicht {
  suche: string;
  gruppe: ListenGruppe;
  tags: string[];
  tagModus: "alle" | "einer";
  /** ID eines Dokumenttyps, „ohne“ oder leer für alle */
  dokumenttyp: string;
  /** ID eines Korrespondenten, „ohne“ oder leer für alle */
  korrespondent: string;
  feld: FeldFilterZustand | null;
  sortierung: Sortierung;
  /** null: was der Browser sich gemerkt hat */
  darstellung: "liste" | "kacheln" | null;
  proSeite: number;
}

export const LEERE_ANSICHT: ArchivAnsicht = {
  suche: "",
  gruppe: "alle",
  tags: [],
  tagModus: "alle",
  dokumenttyp: "",
  korrespondent: "",
  feld: null,
  sortierung: "neu",
  darstellung: null,
  proSeite: PRO_SEITE_VORGABE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const aus = <T extends string>(liste: readonly T[], wert: string | undefined, vorgabe: T): T =>
  liste.includes(wert as T) ? (wert as T) : vorgabe;
const kurz = (wert: string | undefined, laenge: number) => (wert ?? "").slice(0, laenge);

/** Liest die Ansicht aus Suchparametern; was fehlt oder nicht passt, ist die Vorgabe */
export function ansichtAus(p: Record<string, string | undefined>): ArchivAnsicht {
  const tags = [
    ...new Set(
      (p.tags ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => UUID.test(t)),
    ),
  ].slice(0, 50);
  const typ = p.dokumenttyp ?? "";
  const korrespondent = p.korrespondent ?? "";
  const feldId = (p.feld ?? "").toLowerCase();
  const proSeite = Number(p.proSeite);
  return {
    suche: kurz(p.suche, 500),
    gruppe: aus(GRUPPEN, p.gruppe, "alle"),
    tags,
    tagModus: tags.length > 1 ? aus(["alle", "einer"] as const, p.tagModus, "alle") : "alle",
    dokumenttyp: typ === "ohne" || UUID.test(typ) ? typ.toLowerCase() : "",
    korrespondent: korrespondent === "ohne" || UUID.test(korrespondent) ? korrespondent.toLowerCase() : "",
    feld: UUID.test(feldId)
      ? {
          feldId,
          art: aus(["gesetzt", "enthaelt", "bereich"] as const, p.feldArt, "gesetzt"),
          text: kurz(p.feldText, 200),
          von: kurz(p.feldVon, 40),
          bis: kurz(p.feldBis, 40),
        }
      : null,
    sortierung: aus(SORTIERUNGEN, p.sortierung, "neu"),
    darstellung: p.darstellung === "liste" || p.darstellung === "kacheln" ? p.darstellung : null,
    proSeite: PRO_SEITE_WAHL.includes(proSeite as 25) ? proSeite : PRO_SEITE_VORGABE,
  };
}

/** Die Suchparameter einer Ansicht, nur was von der Vorgabe abweicht, in fester Reihenfolge */
export function ansichtZuParametern(a: ArchivAnsicht): Record<string, string> {
  const p: Record<string, string> = {};
  if (a.suche.trim()) p.suche = a.suche.trim();
  if (a.gruppe !== "alle") p.gruppe = a.gruppe;
  if (a.tags.length) p.tags = a.tags.join(",");
  if (a.tags.length > 1 && a.tagModus === "einer") p.tagModus = "einer";
  if (a.dokumenttyp) p.dokumenttyp = a.dokumenttyp;
  if (a.korrespondent) p.korrespondent = a.korrespondent;
  if (a.feld) {
    p.feld = a.feld.feldId;
    if (a.feld.art !== "gesetzt") p.feldArt = a.feld.art;
    if (a.feld.art === "enthaelt" && a.feld.text.trim()) p.feldText = a.feld.text.trim();
    if (a.feld.art === "bereich") {
      if (a.feld.von.trim()) p.feldVon = a.feld.von.trim();
      if (a.feld.bis.trim()) p.feldBis = a.feld.bis.trim();
    }
  }
  if (a.sortierung !== "neu") p.sortierung = a.sortierung;
  if (a.darstellung) p.darstellung = a.darstellung;
  if (a.proSeite !== PRO_SEITE_VORGABE) p.proSeite = String(a.proSeite);
  return p;
}

/** Bringt beliebige Parameter in die feste Form (für das Speichern einer Ansicht) */
export const parameterNormalisieren = (p: Record<string, string | undefined>) => ansichtZuParametern(ansichtAus(p));

/** Suchteil einer Adresse (?…) zur Ansicht, leer ohne Abweichung von der Vorgabe */
export function ansichtSuche(a: ArchivAnsicht): string {
  const text = new URLSearchParams(ansichtZuParametern(a)).toString();
  return text ? `?${text}` : "";
}
