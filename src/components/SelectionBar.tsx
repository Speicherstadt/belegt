import { Check, Combine, Download, FileType, FolderCheck, Tag, TextCursorInput, UserRound, X } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Eintrag } from "../lib/api.ts";
import { zipUrl } from "../lib/api.ts";
import { groesse } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { AuswahlListe, type ListenArt } from "./AuswahlListe.tsx";
import { type Aktion, BulkEdit } from "./BulkEdit.tsx";
import { leistenKnopf } from "./leiste.ts";
import { MergePdfs } from "./MergePdfs.tsx";

/** Grenze des Servers für die Summe der Originale (ZIP_MAX_BYTES in server/export/auswahl.ts) */
const ZIP_MAX_BYTES = 2 * 1024 ** 3;

const symbol = "size-4 shrink-0 text-muted";
const wort = "hidden lg:inline";

/**
 * Was über der Leiste aufgeht: Tags, Korrespondent und Typ als Liste direkt über ihrem Knopf (AuswahlListe), Feld,
 * Einordnen und Zusammenfügen als Panel so breit wie die Leiste
 */
type Panel = ListenArt | Aktion | "zusammenfuegen";
const LISTEN: Panel[] = ["tags", "korrespondent", "dokumenttyp"];
const istListe = (p: Panel): p is ListenArt => LISTEN.includes(p);
/** Breite der Liste über dem Knopf (w-72) */
const LISTE_BREITE = 288;
type Knopf = { aktion: Panel; kurz: () => string; titel: () => string; Bild: typeof Tag };

const AKTIONEN: Knopf[] = [
  { aktion: "tags", kurz: () => m.bulk_short_tags(), titel: () => m.bulk_short_tags(), Bild: Tag },
  { aktion: "korrespondent", kurz: () => m.bulk_short_party(), titel: () => m.bulk_party(), Bild: UserRound },
  { aktion: "dokumenttyp", kurz: () => m.bulk_short_doctype(), titel: () => m.bulk_doctype(), Bild: FileType },
  { aktion: "feld", kurz: () => m.bulk_short_field(), titel: () => m.bulk_field(), Bild: TextCursorInput },
  { aktion: "einordnen", kurz: () => m.bulk_classify(), titel: () => m.bulk_classify(), Bild: FolderCheck },
];
const ZUSAMMENFUEGEN: Knopf = {
  aktion: "zusammenfuegen",
  kurz: () => m.merge_short(),
  titel: () => m.merge_title(),
  Bild: Combine,
};

/** Schwebt mittig über dem Inhalt (rechts der Seitenleiste), damit nichts in der Seite verrutscht; die Leiste gibt die
 * Breite vor, ein Panel darüber streckt sich auf sie */
function Schwebend({ children, leiste }: { children: ReactNode; leiste?: React.Ref<HTMLDivElement> }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-4 md:left-64 print:hidden">
      <div ref={leiste} className="pointer-events-auto relative flex max-w-full flex-col items-center">
        {children}
      </div>
    </div>
  );
}

const zeile = "flex min-h-12 max-w-full items-center gap-1 rounded-xl border border-border bg-bg px-2 py-2 shadow-lg";

/**
 * Die Auswahl als eine Zeile, die unten über der Liste schwebt (DESIGN.md, Auswahl und Kacheln): links wie viele und ×,
 * rechts die Aktionen als Symbol mit Wort. Jede Aktion öffnet ihr Formular im selben Panel über der Leiste, auch
 * das Zusammenfügen von PDFs (nur der Inhaber, in Reihenfolge der Klicks). Nichts davon steht in der
 * Seite, darum springt beim Anhaken nichts.
 */
export function SelectionBar({
  gewaehlt,
  gewaehlteEintraege,
  eintraege,
  zusammenfuegen,
  aufheben,
  fertig,
}: {
  gewaehlt: string[];
  gewaehlteEintraege: Eintrag[];
  eintraege?: Eintrag[];
  zusammenfuegen?: Eintrag[];
  aufheben: () => void;
  fertig: (meldung: string) => void;
}) {
  const leiste = useRef<HTMLDivElement>(null);
  const [offen, setOffen] = useState<Panel | null>(null);
  // Wo der Knopf der offenen Liste in der Leiste steht, damit sie genau darüber aufgeht
  const [anker, setAnker] = useState(0);
  const umschalten = (aktion: Panel, e: MouseEvent<HTMLButtonElement>) => {
    const rahmen = leiste.current?.getBoundingClientRect();
    const breite = rahmen?.width ?? 0;
    const links = e.currentTarget.getBoundingClientRect().left - (rahmen?.left ?? 0);
    setAnker(Math.max(0, Math.min(links, breite - LISTE_BREITE)));
    setOffen(offen === aktion ? null : aktion);
  };
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
  // Escape oder ein Klick daneben schließt, was offen ist
  useEffect(() => {
    if (!offen) return;
    const taste = (e: KeyboardEvent) => e.key === "Escape" && setOffen(null);
    const klick = (e: PointerEvent) => {
      if (leiste.current && !leiste.current.contains(e.target as Node)) setOffen(null);
    };
    window.addEventListener("keydown", taste);
    document.addEventListener("pointerdown", klick);
    return () => {
      window.removeEventListener("keydown", taste);
      document.removeEventListener("pointerdown", klick);
    };
  }, [offen]);
  const summe = gewaehlteEintraege.reduce((s, d) => s + d.groesse, 0);
  const zip = m.zip_download({ anzahl: String(gewaehlt.length), groesse: groesse(summe) });
  // Sammelbearbeitung nur, wer bearbeiten darf; Zusammenfügen nur bei zwei oder mehr PDFs (zusammenfuegen gesetzt)
  const pdfs =
    !!zusammenfuegen && zusammenfuegen.length >= 2 && zusammenfuegen.every((d) => d.mimeType === "application/pdf");
  const knoepfe = [...(eintraege ? AKTIONEN : []), ...(pdfs ? [ZUSAMMENFUEGEN] : [])];
  const aktiv = knoepfe.find((a) => a.aktion === offen);

  return (
    <Schwebend leiste={leiste}>
      {aktiv && istListe(aktiv.aktion) && (
        <section
          aria-label={aktiv.titel()}
          style={{ left: anker }}
          className="absolute bottom-full mb-2 w-72 rounded-xl border border-border bg-bg p-2 shadow-lg"
        >
          <AuswahlListe
            key={aktiv.aktion}
            art={aktiv.aktion}
            gewaehlt={gewaehlteEintraege}
            schliessen={() => setOffen(null)}
          />
        </section>
      )}
      {aktiv && !istListe(aktiv.aktion) && (
        <section
          aria-label={aktiv.titel()}
          className="mb-2 flex w-0 min-w-full flex-col gap-3 rounded-xl border border-border bg-bg p-4 shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 font-semibold text-sm">{aktiv.titel()}</h2>
            <button
              type="button"
              onClick={() => setOffen(null)}
              aria-label={m.bulk_panel_close()}
              className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
          {aktiv.aktion === "zusammenfuegen"
            ? zusammenfuegen && <MergePdfs gewaehlt={zusammenfuegen} fertig={fertig} />
            : eintraege && (
                <BulkEdit
                  key={aktiv.aktion}
                  aktion={aktiv.aktion}
                  gewaehlt={gewaehlt}
                  eintraege={eintraege}
                  fertig={fertig}
                />
              )}
        </section>
      )}
      <div role="toolbar" aria-label={m.bulk_toolbar()} className={zeile}>
        {/* Am Handy nur die Zahl, damit die Aktionen in die Zeile passen */}
        <span className="whitespace-nowrap px-2 font-medium text-sm">
          <span aria-hidden="true" className="sm:hidden">
            {gewaehlt.length}
          </span>
          <span className="max-sm:sr-only">{m.bulk_selected({ anzahl: String(gewaehlt.length) })}</span>
        </span>
        <button
          type="button"
          onClick={aufheben}
          aria-label={m.bulk_clear()}
          title={m.bulk_clear()}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {knoepfe.map(({ aktion, kurz, titel, Bild }) => (
            <button
              key={aktion}
              type="button"
              aria-expanded={offen === aktion}
              aria-label={titel()}
              title={titel()}
              onClick={(e) => umschalten(aktion, e)}
              className={leistenKnopf}
            >
              <Bild aria-hidden="true" className={symbol} />
              <span className={wort}>{kurz()}</span>
            </button>
          ))}
          {summe > ZIP_MAX_BYTES ? (
            <span title={m.zip_too_large({ groesse: groesse(summe) })} className={`${leistenKnopf} text-muted`}>
              <Download aria-hidden="true" className={symbol} />
              <span className={wort}>{m.bulk_short_zip()}</span>
            </span>
          ) : (
            <a
              href={zipUrl(gewaehlteEintraege.map((d) => d.id))}
              download
              aria-label={zip}
              title={zip}
              className={leistenKnopf}
            >
              <Download aria-hidden="true" className={symbol} />
              <span className={wort}>{m.bulk_short_zip()}</span>
            </a>
          )}
        </div>
      </div>
    </Schwebend>
  );
}

/**
 * Das Ergebnis einer Aktion aus der Leiste an derselben Stelle und in derselben Form: schwebend, damit die Liste nicht
 * nach unten springt; bleibt, bis man es schließt oder wieder etwas anhakt
 */
export function AuswahlMeldung({ meldung, schliessen }: { meldung: string; schliessen: () => void }) {
  return (
    <Schwebend>
      <div className={zeile}>
        <Check aria-hidden="true" className="ml-1 size-4 shrink-0 text-muted" />
        <p role="status" className="m-0 px-1 text-sm">
          {meldung}
        </p>
        <button
          type="button"
          onClick={schliessen}
          aria-label={m.bulk_message_close()}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </Schwebend>
  );
}
