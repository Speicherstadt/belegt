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
    return `${e.befunde.length} Befunde: ${e.befunde
      .slice(0, 3)
      .map((b) => `${b.tabelle} ${b.zeile ?? b.seq ?? ""}: ${b.befund}`)
      .join("; ")}`;
  return `${e.dokumente} Dokumente, ${e.siegel} Siegel und ${e.protokoll} Einträge der Kette geprüft, ${e.dateienGeprueft} Originale gegen ihren Hash geprüft`;
}
