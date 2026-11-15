import { Link } from "@tanstack/react-router";
import { ansichtZuParametern, LEERE_ANSICHT } from "../../shared/archivansicht.ts";
import { m } from "../paraglide/messages.js";

/** Archiv, gefiltert auf einen Korrespondenten */
export const archivSuche = (id: string) => ansichtZuParametern({ ...LEERE_ANSICHT, korrespondent: id });

/** Korrespondent als Chip; ein Klick zeigt alle seine Dokumente im Archiv */
export function PartyChip({ korrespondent }: { korrespondent: { id: string; name: string } }) {
  return (
    <Link
      to="/archiv"
      search={archivSuche(korrespondent.id)}
      aria-label={m.party_show_all({ name: korrespondent.name })}
      className="inline-flex h-6 max-w-full items-center rounded-full border border-border px-2 font-medium text-xs underline-offset-2 hover:underline"
    >
      <span className="truncate">{korrespondent.name}</span>
    </Link>
  );
}
