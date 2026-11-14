import { DocumentList } from "../components/DocumentList.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { m } from "../paraglide/messages.js";

export function ArchivePage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={m.archive_title()} intro={m.archive_intro()} />
      <DocumentList suchbar leer={{ title: m.archive_empty_title(), text: m.archive_empty_text() }} />
    </div>
  );
}
