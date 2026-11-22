/**
 * Teilt einen Text an den Wörtern einer Suche auf, damit die Liste Treffer markieren kann. Groß- und Kleinschreibung
 * egal; Anführungszeichen und Wörter unter zwei Zeichen zählen nicht. Ohne Suche ein einziges Stück ohne Treffer.
 */
export function trefferTeile(text: string, suche: string): { text: string; treffer: boolean }[] {
  const woerter = [
    ...new Set(
      suche
        .replace(/["„“]/g, " ")
        .split(/\s+/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 2),
    ),
  ];
  if (!woerter.length || !text) return [{ text, treffer: false }];
  const muster = new RegExp(`(${woerter.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text
    .split(muster)
    .filter((teil) => teil !== "")
    .map((teil) => ({ text: teil, treffer: woerter.includes(teil.toLowerCase()) }));
}
