/*
 * Zeitraum für den Datumsfilter des Archivs. Die Schnellwahl steht relativ in der Ansicht („letzte 30 Tage“), damit
 * eine gespeicherte Ansicht morgen noch dasselbe meint; erst die Abfrage macht daraus feste Tage.
 */

export const DATUMSARTEN = ["entstanden", "eingegangen"] as const;
export type Datumsart = (typeof DATUMSARTEN)[number];

export const ZEITRAEUME = ["", "7t", "30t", "jahr", "vorjahr", "eigen"] as const;
export type Zeitraum = (typeof ZEITRAEUME)[number];

const tag = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Erster und letzter Tag eines Zeitraums, beide eingeschlossen; leer, wo keine Grenze gilt */
export function zeitraumGrenzen(
  zeitraum: Zeitraum,
  eigen: { von: string; bis: string },
  heute = new Date(),
): { von: string; bis: string } {
  const jahr = heute.getFullYear();
  const vorTagen = (n: number) => tag(new Date(jahr, heute.getMonth(), heute.getDate() - n));
  switch (zeitraum) {
    case "7t":
      return { von: vorTagen(6), bis: tag(heute) };
    case "30t":
      return { von: vorTagen(29), bis: tag(heute) };
    case "jahr":
      return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
    case "vorjahr":
      return { von: `${jahr - 1}-01-01`, bis: `${jahr - 1}-12-31` };
    case "eigen":
      return eigen;
    default:
      return { von: "", bis: "" };
  }
}
