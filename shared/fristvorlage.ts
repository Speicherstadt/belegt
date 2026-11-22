/**
 * Fristende aus einer eigenen Vorlage: der Tag der Entstehung plus so viele Monate. Fehlt der Tag im Zielmonat (31. auf
 * Februar), gilt der letzte Tag des Monats; so endet die Frist nie früher als gemeint, nur nicht später als nötig.
 */
export function bisNachMonaten(entstanden: string, monate: number): string | null {
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entstanden);
  if (!t || !Number.isInteger(monate) || monate < 1) return null;
  const [jahr, monat, tag] = [Number(t[1]), Number(t[2]), Number(t[3])];
  const ziel = monat - 1 + monate;
  const zielJahr = jahr + Math.floor(ziel / 12);
  const zielMonat = ziel % 12;
  const letzter = new Date(Date.UTC(zielJahr, zielMonat + 1, 0)).getUTCDate();
  const zwei = (n: number) => String(n).padStart(2, "0");
  return `${zielJahr}-${zwei(zielMonat + 1)}-${zwei(Math.min(tag, letzter))}`;
}
