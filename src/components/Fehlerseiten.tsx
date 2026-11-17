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
  // 403 (etwa „Sichtbereich ungültig“): der Server antwortet, sein Hinweis ist der Satz; sonst Netz oder 5xx
  const verweigert = error instanceof ApiFehler && error.status >= 400 && error.status < 500;
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
