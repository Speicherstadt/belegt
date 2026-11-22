import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/** Nach so vielen Stunden ohne Lauf gilt die Prüfung als veraltet (der Worker prüft alle 24 Stunden) */
export const VERALTET_STUNDEN = 48;

type Zustand = "gut" | "offen" | "befund";

const STIL: Record<Zustand, string> = {
  gut: "border-green-700/40 bg-green-50 text-green-900 dark:border-green-500/40 dark:bg-green-950 dark:text-green-200",
  offen:
    "border-amber-600/40 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-200",
  befund: "border-red-700/40 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-950 dark:text-red-200",
};
const SYMBOL: Record<Zustand, string> = { gut: "✓", offen: "!", befund: "✕" };

/**
 * Zustand von Hash-Kette und Siegeln auf einen Blick: grün mit Haken, wenn der letzte Lauf frisch und ohne Befund ist,
 * gelb, wenn noch keiner lief oder er veraltet ist, rot bei einem Befund. Farbe nie allein: Symbol und Satz sagen es
 * auch (DESIGN.md). Klein für den Kopf eines Dokuments, groß für die Startseite
 */
export function SealBadge({ gross = false }: { gross?: boolean }) {
  const kette = useQuery({ queryKey: ["kette"], queryFn: api.kette });
  const lauf = kette.data?.lauf;
  if (!kette.data) return null;
  const veraltet = !!lauf && Date.now() - new Date(lauf.geprueftAm).getTime() > VERALTET_STUNDEN * 3_600_000;
  const zustand: Zustand = !lauf || veraltet ? "offen" : lauf.ok ? "gut" : "befund";
  const satz =
    zustand === "gut"
      ? m.seal_ok()
      : zustand === "befund"
        ? m.seal_findings({ anzahl: String(lauf!.befunde) })
        : lauf
          ? m.seal_stale()
          : m.seal_never();
  return (
    <Link
      to="/pruefung"
      className={`inline-flex items-center gap-2 self-start rounded-full border font-medium ${STIL[zustand]} ${
        gross ? "px-4 py-2 text-base" : "px-3 py-1 text-sm"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex items-center justify-center rounded-full bg-current ${gross ? "size-6" : "size-5"}`}
      >
        <span className="text-white text-xs dark:text-black">{SYMBOL[zustand]}</span>
      </span>
      <span>
        {satz}
        {lauf && gross && (
          <span className="block font-normal text-xs opacity-80">
            {m.seal_checked({ zeit: zeitpunkt(lauf.geprueftAm) })}
          </span>
        )}
      </span>
    </Link>
  );
}
