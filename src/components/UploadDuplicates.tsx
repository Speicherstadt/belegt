import { Link } from "@tanstack/react-router";
import type { Doppelt } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/**
 * Dateien, die beim Hochladen schon im Archiv lagen: Der Server hat nichts Neues angelegt. Mit Link auf das vorhandene
 * Dokument; sieht der Zugang es nicht (Mitarbeiter), nur dass es vorliegt.
 */
export function UploadDuplicates({ doppelt }: { doppelt: Doppelt[] }) {
  if (!doppelt.length) return null;
  return (
    <div role="status" aria-label={m.upload_duplicates_label()}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {doppelt.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Namen können doppelt sein, die Liste ändert sich nicht
          <li key={i} className="break-words">
            {d.id ? (
              <>
                {m.upload_duplicate({ name: d.dateiname })}{" "}
                <Link to="/dokumente/$id" params={{ id: d.id }} className="font-medium underline underline-offset-2">
                  {m.upload_duplicate_link({ asn: String(d.asn) })}
                </Link>
              </>
            ) : (
              m.upload_duplicate_hidden({ name: d.dateiname })
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
