import { trennblattUrl } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Scannen: Trennblatt zum Ausdrucken, an dem Belegt einen gescannten Stapel teilt */
export function Scanning() {
  return (
    <section aria-labelledby="scannen" className="flex flex-col gap-3">
      <h2 id="scannen" className="m-0 font-semibold text-base">
        {m.scan_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.scan_intro()}</p>
      <a
        href={trennblattUrl}
        download="trennblatt.pdf"
        className="h-9 self-start rounded-md border border-border px-3 py-2 font-medium text-sm hover:bg-subtle"
      >
        {m.scan_separator_download()}
      </a>
    </section>
  );
}
