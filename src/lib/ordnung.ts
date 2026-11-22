import { betragAusText, type Feldtyp, type Feldwert } from "../../shared/ordnung.ts";
import { zeitraumGrenzen } from "../../shared/zeitraum.ts";
import { m } from "../paraglide/messages.js";
import type { Feld, ListenFilter } from "./api.ts";
import { betrag, tag } from "./format.ts";

export const FELDTYP_LABEL: Record<Feldtyp, () => string> = {
  text: () => m.field_type_text(),
  zahl: () => m.field_type_number(),
  betrag: () => m.field_type_amount(),
  datum: () => m.field_type_date(),
  ja_nein: () => m.field_type_bool(),
  auswahl: () => m.field_type_choice(),
  link: () => m.field_type_link(),
};

/** Ein Feldwert zum Lesen: Betrag mit Euro, Datum nach der Sprache, ja oder nein */
export function feldwertText(typ: Feldtyp, wert: Feldwert): string {
  if (typ === "betrag" && typeof wert === "number") return betrag(wert, "EUR");
  if (typ === "datum" && typeof wert === "string") return tag(wert);
  if (typ === "ja_nein") return wert ? m.yes() : m.no();
  return String(wert);
}

export const LEERER_FILTER: ListenFilter = {
  tags: [],
  tagModus: "alle",
  dokumenttyp: "",
  korrespondent: "",
  feld: null,
  datumArt: "entstanden",
  zeitraum: "",
  datumVon: "",
  datumBis: "",
};

/**
 * Grenze eines Bereichs, wie sie der Server liest: Beträge als Cent, denn nur Ziffern hieße dort Cent („100“ wären
 * 1,00 €). Was kein Betrag ist, geht unverändert hin; der Server lehnt es ab
 */
const grenze = (feld: Feld, text: string) => (feld.typ === "betrag" ? String(betragAusText(text) ?? text) : text);

/** Parameter für GET /api/dokumente aus dem Filter der Liste */
export function filterParameter(f: ListenFilter, felder: Feld[]): string {
  const p = new URLSearchParams();
  for (const t of f.tags) p.append("tag", t);
  if (f.tags.length > 1 && f.tagModus === "einer") p.set("tagModus", "einer");
  if (f.dokumenttyp) p.set("dokumenttyp", f.dokumenttyp);
  if (f.korrespondent) p.set("korrespondent", f.korrespondent);
  const feld = f.feld && felder.find((x) => x.id === f.feld!.feldId);
  if (f.feld && feld) {
    const name = `feld.${feld.id}`;
    if (f.feld.art === "gesetzt") p.set(name, "gesetzt");
    else if (f.feld.art === "enthaelt" && f.feld.text.trim()) p.set(`${name}.enthaelt`, f.feld.text.trim());
    else if (f.feld.art === "bereich") {
      if (f.feld.von.trim()) p.set(`${name}.von`, grenze(feld, f.feld.von.trim()));
      if (f.feld.bis.trim()) p.set(`${name}.bis`, grenze(feld, f.feld.bis.trim()));
    }
  }
  const { von, bis } = zeitraumGrenzen(f.zeitraum, { von: f.datumVon, bis: f.datumBis });
  if (von) p.set(`${f.datumArt}Von`, von);
  if (bis) p.set(`${f.datumArt}Bis`, bis);
  const text = p.toString();
  return text ? `&${text}` : "";
}

/** Welche Filter ein Feld kennt: Text enthält bei Text, Auswahl und Link, von–bis bei Betrag, Zahl und Datum */
export const feldFilterArten = (typ: Feldtyp): ("gesetzt" | "enthaelt" | "bereich")[] =>
  ["text", "auswahl", "link"].includes(typ)
    ? ["gesetzt", "enthaelt"]
    : ["betrag", "zahl", "datum"].includes(typ)
      ? ["gesetzt", "bereich"]
      : ["gesetzt"];
