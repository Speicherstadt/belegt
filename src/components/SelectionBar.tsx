import type { Eintrag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { BulkEdit } from "./BulkEdit.tsx";
import { ZipDownload } from "./ZipDownload.tsx";

/**
 * Die Auswahl als Leiste, die beim Scrollen oben stehen bleibt: wie viele gewählt sind, „Auswahl aufheben“, ZIP und, für
 * wer bearbeiten darf (eintraege gesetzt), die Massenbearbeitung
 */
export function SelectionBar({
  gewaehlt,
  gewaehlteEintraege,
  eintraege,
  aufheben,
  fertig,
}: {
  gewaehlt: string[];
  gewaehlteEintraege: Eintrag[];
  eintraege?: Eintrag[];
  aufheben: () => void;
  fertig: (meldung: string) => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 rounded-lg border border-primary/40 bg-bg p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{m.bulk_selected({ anzahl: String(gewaehlt.length) })}</span>
        <button
          type="button"
          onClick={aufheben}
          className="h-9 rounded-md px-3 font-medium text-muted hover:bg-subtle hover:text-fg"
        >
          {m.bulk_clear()}
        </button>
        <ZipDownload gewaehlt={gewaehlteEintraege} />
      </div>
      {eintraege && <BulkEdit gewaehlt={gewaehlt} eintraege={eintraege} fertig={fertig} />}
    </div>
  );
}
