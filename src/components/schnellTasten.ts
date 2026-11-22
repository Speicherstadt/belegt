import { type RefObject, useEffect } from "react";
import type { Art } from "../lib/api.ts";
import { ARTEN } from "../lib/arten.ts";

/**
 * Tasten im Schnellmodus des Eingangs: 1 bis 7 wählen die Art in der Reihenfolge der Auswahl, Enter ordnet ein und
 * öffnet das nächste Dokument (der Knopf „Einordnen & weiter“, sonst „Einordnen“). In einem mehrzeiligen Feld und mit
 * Strg, Alt oder Cmd gelten sie nicht; in einem Textfeld nur Enter, damit Titel und Korrespondent tippbar bleiben
 */
export function useSchnellTasten(aktiv: boolean, form: RefObject<HTMLFormElement | null>, setArt: (a: Art) => void) {
  useEffect(() => {
    if (!aktiv) return;
    const taste = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || !form.current) return;
      const ziel = e.target instanceof HTMLElement ? e.target : null;
      if (ziel?.closest("textarea")) return;
      const tippt = !!ziel?.closest("input, select, [contenteditable]");
      const nummer = Number(e.key);
      if (!tippt && Number.isInteger(nummer) && nummer >= 1 && nummer <= ARTEN.length) {
        e.preventDefault();
        setArt(ARTEN[nummer - 1]!.art);
        return;
      }
      if (e.key === "Enter" && !ziel?.closest("button")) {
        e.preventDefault();
        const weiter = form.current.querySelector<HTMLButtonElement>('button[value="weiter"]');
        form.current.requestSubmit(weiter ?? undefined);
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [aktiv, form, setArt]);
}
