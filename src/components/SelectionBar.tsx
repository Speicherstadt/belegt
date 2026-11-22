import { useEffect, useRef } from "react";
import type { Eintrag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { BulkEdit } from "./BulkEdit.tsx";
import { ZipDownload } from "./ZipDownload.tsx";

/**
 * Die Auswahl als Leiste, die unten über der Liste schwebt (nichts verrutscht beim Anhaken): wie viele gewählt sind, „Auswahl aufheben“, ZIP und, für
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
  const leiste = useRef<HTMLDivElement>(null);
  // Was ins Bild gescrollt wird (Blättern, Fokus), soll nicht unter der Leiste landen
  useEffect(() => {
    const wurzel = document.documentElement;
    const hoehe = () => {
      const platz = `${(leiste.current?.offsetHeight ?? 0) + 24}px`;
      wurzel.style.scrollPaddingBottom = platz;
      wurzel.style.setProperty("--auswahl-platz", platz);
    };
    hoehe();
    const beobachter = new ResizeObserver(hoehe);
    if (leiste.current) beobachter.observe(leiste.current);
    return () => {
      beobachter.disconnect();
      wurzel.style.scrollPaddingBottom = "";
      wurzel.style.removeProperty("--auswahl-platz");
    };
  }, []);
  return (
    <div
      ref={leiste}
      className="fixed inset-x-4 bottom-4 z-20 mx-auto flex max-h-[60vh] max-w-3xl flex-col gap-3 overflow-y-auto rounded-lg border border-primary/40 bg-bg p-3 shadow-lg"
    >
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
