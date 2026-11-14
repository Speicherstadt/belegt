import { getLocale } from "../paraglide/runtime.js";

/** Größe in B, KB oder MB nach der Sprache der Oberfläche */
export function groesse(bytes: number): string {
  const zahl = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${zahl.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${zahl.format(bytes / 1024)} KB`;
  return `${zahl.format(bytes / 1024 / 1024)} MB`;
}

/** Zeitpunkt mit Datum und Uhrzeit nach der Sprache der Oberfläche */
export function zeitpunkt(iso: string): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** Tag (JJJJ-MM-TT) nach der Sprache der Oberfläche, ohne Zeitzonenverschiebung */
export function tag(iso: string): string {
  const [j, mo, t] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(j!, mo! - 1, t!)),
  );
}
