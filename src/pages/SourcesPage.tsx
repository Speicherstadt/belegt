import { Mailboxes } from "../components/Mailboxes.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { Rules } from "../components/Rules.tsx";
import { m } from "../paraglide/messages.js";

export function SourcesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.sources_title()} intro={m.sources_intro()} />
      <Mailboxes />
      <Rules />
    </div>
  );
}
