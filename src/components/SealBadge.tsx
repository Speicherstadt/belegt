import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/** Nach so vielen Stunden ohne Lauf gilt die Prüfung als veraltet (der Worker prüft alle 24 Stunden) */
export const VERALTET_STUNDEN = 48;

export type SiegelZustand = "gut" | "offen" | "befund";

const FARBE: Record<SiegelZustand, string> = { gut: "text-ok", offen: "text-warn", befund: "text-danger" };

/** Schild mit Haken, Ausrufezeichen oder Kreuz; die Farbe kommt aus dem Token des Zustands */
function Schild({ zustand, klein }: { zustand: SiegelZustand; klein?: boolean }) {
  const groesse = klein ? "size-4" : "size-5";
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${groesse} shrink-0 ${FARBE[zustand]}`} fill="none">
      <path
        d="M12 2.5 4 5.5v6c0 5 3.4 8.9 8 10 4.6-1.1 8-5 8-10v-6l-8-3Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {zustand === "gut" && (
        <path
          d="m8.5 12 2.5 2.5 4.5-5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {zustand === "offen" && (
        <path d="M12 7.5v5M12 15.8v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
      {zustand === "befund" && (
        <path d="m9.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * Zustand der Siegel als Zeile: Schild in der Farbe des Zustands, Satz in Textfarbe, darunter ein Detail. Farbe nie
 * allein: Symbol und Satz sagen es auch (DESIGN.md). Für Startseite und Prüfung
 */
export function SealStatus({ zustand, satz, detail }: { zustand: SiegelZustand; satz: string; detail?: string }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-border bg-subtle px-3 py-2.5">
      <span className="mt-0.5">
        <Schild zustand={zustand} />
      </span>
      <span className="flex flex-col">
        <span className="font-medium text-sm">{satz}</span>
        {detail && <span className="text-muted text-xs">{detail}</span>}
      </span>
    </div>
  );
}

/** Zustand aus dem letzten gespeicherten Lauf: frisch und ohne Befund gut, keiner oder veraltet offen */
export function siegelZustand(lauf: { geprueftAm: string; ok: boolean } | null | undefined): SiegelZustand {
  const veraltet = !!lauf && Date.now() - new Date(lauf.geprueftAm).getTime() > VERALTET_STUNDEN * 3_600_000;
  return !lauf || veraltet ? "offen" : lauf.ok ? "gut" : "befund";
}

/**
 * Zustand von Hash-Kette und Siegeln aus dem letzten Lauf (/api/kette). Groß als Zeile für die Startseite, klein als
 * schlichtes Etikett im Kopf eines Dokuments; beide führen zur Prüfung
 */
export function SealBadge({ gross = false }: { gross?: boolean }) {
  const kette = useQuery({ queryKey: ["kette"], queryFn: api.kette });
  const lauf = kette.data?.lauf;
  if (!kette.data) return null;
  const zustand = siegelZustand(lauf);
  const satz =
    zustand === "gut"
      ? m.seal_ok()
      : zustand === "befund"
        ? m.seal_findings({ anzahl: String(lauf!.befunde) })
        : lauf
          ? m.seal_stale()
          : m.seal_never();
  if (gross) {
    return (
      <Link to="/pruefung" className="no-underline hover:opacity-90">
        <SealStatus
          zustand={zustand}
          satz={satz}
          detail={lauf ? m.seal_checked({ zeit: zeitpunkt(lauf.geprueftAm) }) : undefined}
        />
      </Link>
    );
  }
  return (
    <Link
      to="/pruefung"
      className="inline-flex h-7 items-center gap-1.5 self-start rounded-full border border-border px-2.5 font-medium text-xs hover:bg-subtle"
    >
      <Schild zustand={zustand} klein />
      {satz}
    </Link>
  );
}
