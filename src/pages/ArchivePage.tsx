import { useState } from "react";
import { EmptyState, PageHeader } from "../components/PageHeader.tsx";
import { m } from "../paraglide/messages.js";

const FILTER = [
  { key: "alle", label: () => m.filter_all() },
  { key: "pflicht", label: () => m.filter_required() },
  { key: "freiwillig", label: () => m.filter_voluntary() },
  { key: "frei", label: () => m.filter_free() },
] as const;

export function ArchivePage() {
  const [filter, setFilter] = useState<(typeof FILTER)[number]["key"]>("alle");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={m.archive_title()} intro={m.archive_intro()} />
      <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm">
        <span className="sr-only">{m.archive_search()}</span>
        <input
          type="search"
          placeholder={m.archive_search()}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
      </label>
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">{m.archive_filter_label()}</legend>
        {FILTER.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className="h-8 rounded-full border border-border px-3 font-medium text-sm hover:bg-subtle aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-onprimary"
          >
            {f.label()}
          </button>
        ))}
      </fieldset>
      <EmptyState title={m.archive_empty_title()} text={m.archive_empty_text()} />
    </div>
  );
}
