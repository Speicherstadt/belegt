/** „1 Dokument“, „2 Dokumente“: eine Zahl mit dem Wort in der passenden Form, für Texte des Servers auf Deutsch */
export const anzahl = (n: number, einzahl: string, mehrzahl: string): string => `${n} ${n === 1 ? einzahl : mehrzahl}`;
