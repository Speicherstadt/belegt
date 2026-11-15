import type { Rolle } from "../../shared/rollen.ts";
import { m } from "../paraglide/messages.js";
import type { Zugaenge } from "./api-zugang.ts";

export function rolleLabel(rolle: Rolle): string {
  return {
    inhaber: m.role_inhaber,
    steuerberatung: m.role_steuerberatung,
    pruefer: m.role_pruefer,
    mitarbeiter: m.role_mitarbeiter,
  }[rolle]();
}

/**
 * Wie viele Mitarbeiter (nicht entzogen) und offene Einladungen den Tag in ihrem Sichtbereich ausschließen: Wird er
 * gelöscht, sehen sie seine Dokumente (docs/zugaenge.md)
 */
export function ausgeschlossenBei(tagId: string, z: Zugaenge, jetzt = new Date()): number {
  const schliesstAus = (s: { ohneTags?: string[] } | null) => !!s?.ohneTags?.includes(tagId);
  return (
    z.zugaenge.filter((a) => !a.entzogenAm && schliesstAus(a.sichtbereich)).length +
    z.einladungen.filter(
      (e) => !e.eingeloestAm && !e.zurueckgezogenAm && new Date(e.gueltigBis) > jetzt && schliesstAus(e.sichtbereich),
    ).length
  );
}
