import { useId, useState } from "react";
import { exportUrl } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Datenträgerüberlassung (Z3): Zeitraum wählen, das ZIP lädt der Browser direkt vom Server */
export function Export() {
  const jahr = String(new Date().getFullYear() - 1);
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(`${jahr}-12-31`);
  const id = useId();
  const gueltig = !!von && !!bis && von <= bis;
  return (
    <section aria-labelledby={`${id}-titel`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id={`${id}-titel`} className="m-0 font-semibold text-base">
        {m.export_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.export_intro()}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {m.export_from()}
          <input
            type="date"
            value={von}
            onChange={(e) => setVon(e.target.value)}
            className="h-9 rounded-md border border-border bg-transparent px-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {m.export_to()}
          <input
            type="date"
            value={bis}
            onChange={(e) => setBis(e.target.value)}
            className="h-9 rounded-md border border-border bg-transparent px-2"
          />
        </label>
        {gueltig ? (
          <a
            href={exportUrl(von, bis)}
            className="h-9 rounded-md bg-primary px-3 py-2 font-medium text-onprimary text-sm hover:opacity-90"
          >
            {m.export_download()}
          </a>
        ) : (
          <p role="alert" className="m-0 text-red-700 dark:text-red-400 text-sm">
            {m.export_invalid()}
          </p>
        )}
      </div>
    </section>
  );
}
