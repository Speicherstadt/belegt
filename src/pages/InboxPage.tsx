import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LEERE_ANSICHT } from "../../shared/archivansicht.ts";
import { DocumentList } from "../components/DocumentList.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { listeLesen } from "../lib/blaettern.ts";
import { m } from "../paraglide/messages.js";

/**
 * Der Eingang: was noch nicht eingeordnet ist. „Schnell einordnen“ öffnet das erste Dokument im Schnellmodus (Tasten 1
 * bis 7 für die Art, Enter ordnet ein und geht weiter), bis der Eingang leer ist
 */
export function InboxPage() {
  const [ansicht, setAnsicht] = useState(LEERE_ANSICHT);
  const navigate = useNavigate();
  const schnellStarten = () => {
    const erstes = listeLesen()?.ids[0];
    if (erstes) void navigate({ to: "/dokumente/$id", params: { id: erstes }, search: { schnell: "1" } });
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={m.inbox_title()} intro={m.inbox_intro()} />
        <button
          type="button"
          onClick={schnellStarten}
          className="h-10 rounded-md bg-primary px-4 font-medium text-onprimary text-sm"
        >
          {m.quick_mode_start()}
        </button>
      </div>
      <DocumentList
        suchbar={false}
        feste="offen"
        kamera
        ansicht={ansicht}
        setAnsicht={setAnsicht}
        leer={{ title: m.inbox_empty_title(), text: m.inbox_empty_text() }}
      />
    </div>
  );
}
