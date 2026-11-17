import { type ErrorComponentProps, Link } from "@tanstack/react-router";
import { ApiFehler } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { ErneutVersuchen, Meldung, meldungKnopf } from "./Meldung.tsx";

/** Unbekannte Adresse; läuft innerhalb der Shell, die Seitenleiste bleibt */
export function NichtGefunden() {
  return (
    <Meldung was={m.notfound_title()} verloren={m.notfound_text()}>
      <Link to="/archiv" className={meldungKnopf}>
        {m.notfound_action()}
      </Link>
    </Meldung>
  );
}

/** Renderfehler in einer Seite */
export function SeitenFehler({ error, reset }: ErrorComponentProps) {
  return (
    <Meldung
      was={m.error_title()}
      verloren={m.error_text()}
      details={error instanceof Error ? error.message : String(error)}
    >
      <ErneutVersuchen onClick={reset} />
    </Meldung>
  );
}

/** Die Sitzungsabfrage der Shell scheiterte, aber nicht mit 401 (Netz, 5xx) */
export function ServerAntwortetNicht({ error, erneut }: { error: Error; erneut: () => void }) {
  // Nur ein 403 mit Hinweis (etwa „Sichtbereich ungültig“) kommt vom Server selbst; 404, 429 oder leere Antworten
  // stammen oft von einem Proxy und bleiben „antwortet nicht“
  const verweigert =
    error instanceof ApiFehler && error.status === 403 && !error.ohneHinweis && error.message.trim() !== "";
  return (
    <main className="p-8">
      <Meldung
        was={verweigert ? m.denied_title() : m.server_down_title()}
        verloren={verweigert ? error.message : m.server_down_text()}
        details={verweigert ? undefined : error.message}
      >
        <ErneutVersuchen onClick={erneut} />
      </Meldung>
    </main>
  );
}
