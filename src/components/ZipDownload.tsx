import { type Eintrag, zipUrl } from "../lib/api.ts";
import { groesse } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/** Grenze des Servers für die Summe der Originale (ZIP_MAX_BYTES in server/export/auswahl.ts) */
const MAX_BYTES = 2 * 1024 ** 3;

/**
 * Die gewählten Dokumente als ZIP herunterladen, für jede Rolle. Ein Link statt eines Abrufs: Der Browser schreibt das
 * ZIP selbst auf die Platte, so liegt es nie ganz im Speicher der Seite.
 */
export function ZipDownload({ gewaehlt }: { gewaehlt: Eintrag[] }) {
  const summe = gewaehlt.reduce((s, d) => s + d.groesse, 0);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {summe > MAX_BYTES ? (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {m.zip_too_large({ groesse: groesse(summe) })}
        </p>
      ) : (
        <a
          href={zipUrl(gewaehlt.map((d) => d.id))}
          download
          className="inline-flex h-9 items-center rounded-md border border-border px-4 font-medium hover:bg-subtle"
        >
          {m.zip_download({ anzahl: String(gewaehlt.length), groesse: groesse(summe) })}
        </a>
      )}
    </div>
  );
}
