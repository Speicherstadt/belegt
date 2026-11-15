import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type ArchivAnsicht, ansichtAus, ansichtSuche, ansichtZuParametern } from "../../shared/archivansicht.ts";
import { DocumentList } from "../components/DocumentList.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { m } from "../paraglide/messages.js";

/**
 * Das Archiv. Suche, Filter und Sortierung stehen in der Adresse (shared/archivansicht.ts): So lässt sich jede Ansicht
 * als Link teilen, und eine gespeicherte Ansicht ist nur dieser Link. Die Eingabe hält einen eigenen Zustand, damit
 * das Tippen in der Suche nicht auf den Router wartet; ändert sich die Adresse von außen (Seitenleiste), folgt sie.
 */
export function ArchivePage() {
  const search = useSearch({ strict: false }) as Record<string, string>;
  const ausAdresse = ansichtAus(search);
  const adresse = ansichtSuche(ausAdresse);
  const [ansicht, setLokal] = useState<ArchivAnsicht>(ausAdresse);
  const navigate = useNavigate();
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur wenn sich die Adresse ändert
  useEffect(() => {
    if (ansichtSuche(ansicht) !== adresse) setLokal(ausAdresse);
  }, [adresse]);
  const setAnsicht = (neu: ArchivAnsicht) => {
    setLokal(neu);
    void navigate({ to: "/archiv", search: ansichtZuParametern(neu), replace: true });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={m.archive_title()} intro={m.archive_intro()} />
      <DocumentList
        suchbar
        ansicht={ansicht}
        setAnsicht={setAnsicht}
        leer={{ title: m.archive_empty_title(), text: m.archive_empty_text() }}
      />
    </div>
  );
}
