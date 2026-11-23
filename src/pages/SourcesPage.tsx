import { useQuery } from "@tanstack/react-query";
import { ApiTokens } from "../components/ApiTokens.tsx";
import { Mailboxes } from "../components/Mailboxes.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { PaperlessImport } from "../components/PaperlessImport.tsx";
import { Reiterleiste, useBereich } from "../components/Reiter.tsx";
import { Rules } from "../components/Rules.tsx";
import { Scanning } from "../components/Scanning.tsx";
import { Webhooks } from "../components/Webhooks.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const ALLE = ["postfaecher", "scannen", "umzug", "schnittstelle"] as const;
type Bereich = (typeof ALLE)[number];
const NAMEN: Record<Bereich, () => string> = {
  postfaecher: () => m.sources_tab_mail(),
  scannen: () => m.sources_tab_scan(),
  umzug: () => m.sources_tab_move(),
  schnittstelle: () => m.sources_tab_api(),
};

/**
 * Wie Dokumente hereinkommen, in Reitern (der Reiter steht in der Adresse, ?bereich=): Postfächer mit ihren Regeln,
 * Scannen, der Umzug aus Paperless-ngx und die Schnittstelle; die letzten beiden nur für den Inhaber
 */
export function SourcesPage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const inhaber = ich.data?.role === "inhaber";
  const bereiche = ALLE.filter((b) => inhaber || (b !== "umzug" && b !== "schnittstelle"));
  const bereich = useBereich(bereiche, "postfaecher");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.sources_title()} intro={m.sources_intro()} />
      <Reiterleiste
        pfad="/quellen"
        bereiche={bereiche}
        aktiv={bereich}
        vorgabe="postfaecher"
        namen={NAMEN}
        label={m.sources_tabs_label()}
      />
      <div role="tabpanel" aria-label={NAMEN[bereich]()} className="flex flex-col gap-5">
        {bereich === "postfaecher" && (
          <>
            <Mailboxes />
            <Rules />
          </>
        )}
        {bereich === "scannen" && <Scanning />}
        {bereich === "umzug" && <PaperlessImport />}
        {bereich === "schnittstelle" && (
          <>
            <ApiTokens />
            <Webhooks />
          </>
        )}
      </div>
    </div>
  );
}
