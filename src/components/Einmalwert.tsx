import { useState } from "react";
import { m } from "../paraglide/messages.js";

/**
 * Wert, der nur einmal erscheint (Token, Webhook-Geheimnis, Link; DESIGN.md „Einmalwert“). Die Live-Region steht neben
 * dem Wert, nicht um ihn: Sonst läse ein Screenreader das Geheimnis vor.
 */
export function Einmalwert({ label, wert }: { label: string; wert: string }) {
  // Merkt sich, welcher Wert kopiert wurde; ein neuer Wert beginnt wieder ohne Rückmeldung
  const [ergebnis, setErgebnis] = useState<{ wert: string; ok: boolean } | null>(null);
  const meldung = ergebnis?.wert !== wert ? "" : ergebnis.ok ? m.share_link_copied() : m.einmalwert_copy_failed();

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(wert);
      setErgebnis({ wert, ok: true });
    } catch {
      // Ohne Zwischenablage oder Erlaubnis bleibt der Wert markierbar
      setErgebnis({ wert, ok: false });
    }
  }

  return (
    <div
      data-testid="einmalwert"
      className="flex min-w-0 flex-col items-start gap-2 rounded-md border border-border bg-subtle p-3 text-base sm:text-sm"
    >
      <p className="m-0 font-medium">{label}</p>
      <code className="w-full select-all [overflow-wrap:anywhere] font-mono">{wert}</code>
      <button
        type="button"
        onClick={() => void kopieren()}
        className="h-10 pointer-coarse:h-11 rounded-md border border-border bg-bg px-4 font-medium text-base hover:bg-subtle focus-visible:outline-2 focus-visible:outline-fg focus-visible:outline-offset-2 sm:text-sm"
      >
        {m.share_link_copy()}
      </button>
      <p role="status" className="m-0 min-h-5 text-muted">
        {meldung}
      </p>
      <p className="m-0">{m.einmalwert_once()}</p>
    </div>
  );
}
