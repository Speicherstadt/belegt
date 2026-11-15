import { useState } from "react";
import { LEERE_ANSICHT } from "../../shared/archivansicht.ts";
import { DocumentList } from "../components/DocumentList.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { m } from "../paraglide/messages.js";

export function InboxPage() {
  const [ansicht, setAnsicht] = useState(LEERE_ANSICHT);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.inbox_title()} intro={m.inbox_intro()} />
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
