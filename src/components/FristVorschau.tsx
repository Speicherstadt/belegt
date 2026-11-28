import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlert, Info, Lock } from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";
import { ApiFehler, type Art, api } from "../lib/api.ts";
import { ARTEN, artHilfe } from "../lib/arten.ts";
import { tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/** Wert, der sich erst 300 ms nach der letzten Änderung ändert */
function useVerzoegert<T>(wert: T): T {
  const [spaeter, setSpaeter] = useState(wert);
  useEffect(() => {
    const t = setTimeout(() => setSpaeter(wert), 300);
    return () => clearTimeout(t);
  }, [wert]);
  return spaeter;
}

type Datumsfelder = { entstanden: string; freiwilligBis: string };

/**
 * Die Datumsfelder des Formulars sind unkontrolliert; für die Vorschau merkt sich der State, was die Person geändert
 * hat, und gilt nur für das Formular mit diesem `key`. `freiwilligBis` vergisst er beim Wechsel der Art, weil das Feld
 * dann neu entsteht und wieder die Vorgabe zeigt.
 */
export function useFristEingabe(formKey: string, art: Art, vorgabe: Datumsfelder) {
  const [geaendert, setGeaendert] = useState<Partial<Record<keyof Datumsfelder, { formKey: string; wert: string }>>>(
    {},
  );
  const [vorherArt, setVorherArt] = useState(art);
  if (vorherArt !== art) {
    // Zustand beim Rendern anpassen statt im Effect: sonst zeigt ein Render lang noch der alte Wert
    setVorherArt(art);
    setGeaendert(({ freiwilligBis: _, ...rest }) => rest);
  }
  const merke = (feld: keyof Datumsfelder, wert: string) => setGeaendert((g) => ({ ...g, [feld]: { formKey, wert } }));
  const wert = (feld: keyof Datumsfelder) =>
    geaendert[feld]?.formKey === formKey ? geaendert[feld].wert : vorgabe[feld];
  // onChange des Formulars (Ereignisse blubbern): liest nur die beiden Datumsfelder
  const aenderung = (e: ChangeEvent<HTMLFormElement>) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && (t.name === "entstanden" || t.name === "freiwilligBis"))
      merke(t.name, t.value);
  };
  return { eingabe: { entstanden: wert("entstanden"), freiwilligBis: wert("freiwilligBis") }, merke, aenderung };
}

/** Frist des Dokuments vor dem Speichern: Der Server rechnet, die Oberfläche zeigt nur (Live-Region, immer im DOM) */
export function FristVorschau({
  art,
  entstanden,
  freiwilligBis,
}: {
  art: Art;
  entstanden: string;
  freiwilligBis: string;
}) {
  const [a, e, bis] = [useVerzoegert(art), useVerzoegert(entstanden), useVerzoegert(freiwilligBis)];
  // Beim Tippen des Jahres meldet das Feld Zwischenwerte wie 0002-03-12: Die Eingabe ist noch nicht fertig
  const fehlt = (datum: string) => !datum || Number(datum.slice(0, 4)) < 1000;
  const ohneDatum = fehlt(e) || (a === "freiwillig" && fehlt(bis));
  const frage = useQuery({
    queryKey: ["fristvorschau", a, e, a === "freiwillig" ? bis : ""],
    // Das Eingabedatum bleibt am Ergebnis, damit Titel, Jahreszeile und Sperre immer aus derselben Antwort stammen
    queryFn: async () => ({
      ...(await api.fristVorschau({ art: a, entstanden: e, freiwilligBis: a === "freiwillig" ? bis : undefined })),
      entstanden: e,
    }),
    enabled: !ohneDatum,
    placeholderData: keepPreviousData,
  });

  const d = frage.data;
  let Zeichen = Info;
  let titel: string = m.classify_frist_laedt();
  let zeile: string | null = null;
  let danger = false;
  if (ohneDatum) {
    titel = m.classify_frist_ohne_datum();
  } else if (frage.error) {
    // 400: Der Satz des Servers ist für Menschen geschrieben; Netz- und Serverfehler bekommen den eigenen Text
    if (frage.error instanceof ApiFehler && frage.error.status === 400 && !frage.error.ohneHinweis) {
      Zeichen = CircleAlert;
      danger = true;
      titel = frage.error.message;
    } else titel = m.classify_frist_netz();
  } else if (d) {
    if (d.grund === "keine" || !d.bis) {
      titel = m.classify_frist_frei();
      // Mit Sperre würde „jederzeit löschen“ der Sperrzeile widersprechen
      if (!d.gesperrt) zeile = m.classify_frist_frei_detail();
    } else {
      Zeichen = Lock;
      const datum = tag(d.bis);
      if (d.grund === "gesetz") {
        titel = m.classify_frist_gesetz({ datum });
        zeile = m.classify_frist_gesetz_detail({
          jahre: d.jahre ?? 0,
          jahr: d.entstanden.slice(0, 4),
        });
      } else {
        titel = m.classify_frist_freiwillig({ datum });
        zeile = m.classify_frist_freiwillig_detail();
      }
    }
  }
  const gesperrt = !ohneDatum && !frage.error && d?.gesperrt === true;

  return (
    <div aria-live="polite" aria-atomic="true" className="flex gap-2 rounded-lg bg-subtle p-4 text-sm">
      <span className={`flex h-5 shrink-0 items-center ${danger ? "text-danger" : "text-muted"}`}>
        <Zeichen size={16} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
        <p className={`m-0 text-pretty font-medium ${danger ? "text-danger" : "text-fg"}`}>{titel}</p>
        {zeile && <p className="m-0 text-pretty text-muted">{zeile}</p>}
        {gesperrt && <p className="m-0 text-pretty text-muted">{m.classify_frist_gesperrt()}</p>}
      </div>
    </div>
  );
}

/** Auswahl der Art mit dem Satz darunter; der Satz hängt per `aria-describedby` am Select, nicht im Label */
export function ArtFeld({ art, onArt, className }: { art: Art; onArt: (a: Art) => void; className: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5 font-medium text-sm">
        {m.classify_kind()}
        <select
          value={art}
          onChange={(e) => onArt(e.target.value as Art)}
          aria-describedby="classify-art-hilfe"
          className={className}
        >
          {ARTEN.map((a) => (
            <option key={a.art} value={a.art}>
              {a.label()}
            </option>
          ))}
        </select>
      </label>
      <p id="classify-art-hilfe" className="m-0 text-muted text-sm">
        {artHilfe[art]()}
      </p>
    </div>
  );
}
