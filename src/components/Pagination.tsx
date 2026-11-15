import { m } from "../paraglide/messages.js";

/** „1–50 von 312“ und die Knöpfe zum Blättern unter einer Liste */
export function Pagination({
  seite,
  seiten,
  gesamt,
  proSeite,
  blaettern,
}: {
  seite: number;
  seiten: number;
  gesamt: number;
  proSeite: number;
  blaettern: (seite: number) => void;
}) {
  if (gesamt === 0) return null;
  return (
    <nav aria-label={m.pages_label()} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="m-0 text-muted tabular-nums" aria-live="polite">
        {m.pages_range({
          von: String((seite - 1) * proSeite + 1),
          bis: String(Math.min(seite * proSeite, gesamt)),
          gesamt: String(gesamt),
        })}
      </p>
      {seiten > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => blaettern(seite - 1)}
            disabled={seite <= 1}
            className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle disabled:opacity-60"
          >
            {m.pages_previous()}
          </button>
          <span className="tabular-nums">{m.pages_of({ seite: String(seite), seiten: String(seiten) })}</span>
          <button
            type="button"
            onClick={() => blaettern(seite + 1)}
            disabled={seite >= seiten}
            className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle disabled:opacity-60"
          >
            {m.pages_next()}
          </button>
        </div>
      )}
    </nav>
  );
}
