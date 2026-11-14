import { betragAlsText, betragAusText, type Feldwert } from "../../shared/ordnung.ts";
import type { Feld } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

export const feldKlasse = "h-9 min-w-0 rounded-md border border-border bg-bg px-3 font-normal";

/** Wert eines Feldes als Text für ein Eingabefeld */
export function alsEingabe(feld: Feld, wert: Feldwert | null | undefined): string {
  if (wert === null || wert === undefined) return "";
  if (feld.typ === "betrag" && typeof wert === "number") return betragAlsText(wert);
  if (feld.typ === "ja_nein") return wert ? "ja" : "nein";
  return String(wert);
}

/**
 * Liest den Text aus dem Eingabefeld als Wert für die Schnittstelle: leer ist null (entfernen), ein Betrag in deutscher
 * Schreibweise wird zu Cent. undefined heißt: kein gültiger Wert.
 */
export function ausEingabe(feld: Feld, text: string): Feldwert | null | undefined {
  const t = text.trim();
  if (!t) return null;
  switch (feld.typ) {
    case "betrag":
      return betragAusText(t) ?? undefined;
    case "zahl":
      return /^-?\d{1,16}$/.test(t) ? Number(t) : undefined;
    case "ja_nein":
      return t === "ja";
    default:
      return t;
  }
}

/** Eingabefeld passend zum Typ; name trägt den Wert im Formular */
export function FieldInput({
  feld,
  name,
  wert,
  id,
}: {
  feld: Feld;
  name: string;
  wert?: Feldwert | null;
  id?: string;
}) {
  const vorgabe = alsEingabe(feld, wert);
  if (feld.typ === "auswahl" || feld.typ === "ja_nein")
    return (
      <select id={id} name={name} defaultValue={vorgabe} className={feldKlasse}>
        <option value="">{m.field_empty()}</option>
        {(feld.typ === "auswahl" ? feld.optionen : ["ja", "nein"]).map((o) => (
          <option key={o} value={o}>
            {feld.typ === "ja_nein" ? (o === "ja" ? m.yes() : m.no()) : o}
          </option>
        ))}
      </select>
    );
  return (
    <span className="flex min-w-0 items-center gap-2">
      <input
        id={id}
        name={name}
        defaultValue={vorgabe}
        type={feld.typ === "datum" ? "date" : feld.typ === "link" ? "url" : "text"}
        inputMode={feld.typ === "zahl" ? "numeric" : feld.typ === "betrag" ? "decimal" : undefined}
        placeholder={feld.typ === "betrag" ? "1.234,56" : undefined}
        className={`${feldKlasse} flex-1`}
      />
      {feld.typ === "betrag" && <span aria-hidden="true">€</span>}
    </span>
  );
}
