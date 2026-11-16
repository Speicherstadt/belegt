import { anzahl } from "../../shared/zahl.ts";

/** Eine Zeile für Menschen: was geprüft ist, oder die ersten Befunde */
export function alsText(e: {
  ok: boolean;
  befunde: { tabelle: string; zeile: string | null; seq: number | null; befund: string }[];
  dokumente: number;
  siegel: number;
  protokoll: number;
  dateienGeprueft: number;
}): string {
  if (!e.ok)
    return `${anzahl(e.befunde.length, "Befund", "Befunde")}: ${e.befunde
      .slice(0, 3)
      .map((b) => `${b.tabelle} ${b.zeile ?? b.seq ?? ""}: ${b.befund}`)
      .join("; ")}`;
  return `${anzahl(e.dokumente, "Dokument", "Dokumente")}, ${e.siegel} Siegel und ${anzahl(e.protokoll, "Eintrag", "Einträge")} der Kette geprüft, ${e.dateienGeprueft === 1 ? "1 Original gegen seinen" : `${e.dateienGeprueft} Originale gegen ihren`} Hash geprüft`;
}
