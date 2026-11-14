import { EmptyState, PageHeader } from "../components/PageHeader.tsx";
import { m } from "../paraglide/messages.js";

/** Seite, deren Funktion noch folgt: sagt ehrlich, was kommt */
export function PlannedPage({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} intro={intro} />
      <EmptyState title={title} text={m.not_yet()} />
    </div>
  );
}
