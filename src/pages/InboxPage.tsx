import { DocumentList } from "../components/DocumentList.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { m } from "../paraglide/messages.js";

export function InboxPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.inbox_title()} intro={m.inbox_intro()} />
      <DocumentList suchbar={false} leer={{ title: m.inbox_empty_title(), text: m.inbox_empty_text() }} />
    </div>
  );
}
