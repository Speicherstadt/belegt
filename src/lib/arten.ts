import { m } from "../paraglide/messages.js";
import type { Art } from "./api.ts";

/** Die Arten in der Reihenfolge der Auswahl, mit Text in der Sprache der Oberfläche */
export const ARTEN: { art: Art; label: () => string }[] = [
  { art: "beleg", label: () => m.kind_receipt() },
  { art: "geschaeftsbrief", label: () => m.kind_letter() },
  { art: "buecher", label: () => m.kind_books() },
  { art: "zoll", label: () => m.kind_customs() },
  { art: "sonstige", label: () => m.kind_other() },
  { art: "freiwillig", label: () => m.kind_voluntary() },
  { art: "frei", label: () => m.kind_free() },
];

export const artLabel = (art: Art) => ARTEN.find((a) => a.art === art)?.label() ?? art;

/** Der Satz unter der Auswahl: was zu dieser Art gehört, mit Beispielen */
export const artHilfe: Record<Art, () => string> = {
  beleg: () => m.classify_help_beleg(),
  geschaeftsbrief: () => m.classify_help_geschaeftsbrief(),
  buecher: () => m.classify_help_buecher(),
  zoll: () => m.classify_help_zoll(),
  sonstige: () => m.classify_help_sonstige(),
  freiwillig: () => m.classify_help_freiwillig(),
  frei: () => m.classify_help_frei(),
};
