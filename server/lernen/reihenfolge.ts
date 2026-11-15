import type { AufgeloesterVorschlag } from "../ordnung/vorschlag.ts";
import type { GelernterVorschlag } from "./lernen.ts";

/*
 * Reihenfolge der Vorschläge (docs/eingang.md#vorschläge): Regel vor Zuordnungsregel vor gelerntem Vorschlag vor
 * Sprachmodell. Regeln und Zuordnungsregeln hat der Inhaber selbst festgelegt; was sie schon vorschlagen, zeigt der
 * gelernte Vorschlag nicht noch einmal, auch nicht abweichend. Das Sprachmodell bleibt ein eigener Vorschlag mit Titel
 * und Datum und steht zuletzt.
 */

export function gelerntOhneDoppelte(
  gelernt: GelernterVorschlag | null,
  vorher: { art?: string | null; ordnung?: AufgeloesterVorschlag | null }[],
): GelernterVorschlag | null {
  if (!gelernt) return null;
  const art = vorher.some((v) => v.art);
  const korrespondent = vorher.some((v) => v.ordnung?.korrespondent);
  const dokumenttyp = vorher.some((v) => v.ordnung?.dokumenttyp);
  const schonTags = new Set(vorher.flatMap((v) => v.ordnung?.tags.map((t) => t.id) ?? []));
  const rest: GelernterVorschlag = {
    art: art ? null : gelernt.art,
    korrespondent: korrespondent ? null : gelernt.korrespondent,
    dokumenttyp: dokumenttyp ? null : gelernt.dokumenttyp,
    tags: gelernt.tags.filter((t) => !schonTags.has(t.id)),
  };
  return rest.art || rest.korrespondent || rest.dokumenttyp || rest.tags.length ? rest : null;
}
