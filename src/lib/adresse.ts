/*
 * Adressen auf /api, die der Browser selbst lädt (Bilder, Vorschau, Downloads), statt über fetch. Im Betrieb bleiben
 * sie, wie sie sind; die Demo lenkt sie auf ihre aufgenommenen Dateien um (src/demo/einbauen.ts).
 */

let umlenken = (pfad: string) => pfad;

export const apiAdresse = (pfad: string) => umlenken(pfad);

export function adressenUmlenken(neu: (pfad: string) => string) {
  umlenken = neu;
}
