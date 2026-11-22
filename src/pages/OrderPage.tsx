import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { CorrespondentsAdmin } from "../components/CorrespondentsAdmin.tsx";
import { DoctypesAdmin } from "../components/DoctypesAdmin.tsx";
import { feldKlasse } from "../components/FieldInput.tsx";
import { FieldsAdmin } from "../components/FieldsAdmin.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { TagsAdmin } from "../components/TagsAdmin.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const BEREICHE = ["korrespondenten", "tags", "typen", "felder"] as const;
type Bereich = (typeof BEREICHE)[number];
const BEREICH_LABEL: Record<Bereich, () => string> = {
  korrespondenten: () => m.order_parties(),
  tags: () => m.order_tags(),
  typen: () => m.order_doctypes(),
  felder: () => m.order_fields(),
};

/**
 * Korrespondenten, Tags, Dokumenttypen und eigene Felder in Reitern (der Reiter steht in der Adresse, ?bereich=), mit
 * einem Filter nach Namen, damit auch lange Listen übersichtlich bleiben; anlegen und ändern nur der Inhaber
 */
export function OrderPage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const schreiben = darfSchreiben(ich.data?.role);
  const search = useSearch({ strict: false }) as { bereich?: string };
  const bereich: Bereich = BEREICHE.includes(search.bereich as Bereich)
    ? (search.bereich as Bereich)
    : "korrespondenten";
  const [filter, setFilter] = useState("");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.order_page_title()} intro={m.order_page_intro()} />
      <div className="flex flex-wrap items-end justify-between gap-3 border-border border-b">
        <div role="tablist" aria-label={m.order_tabs_label()} className="flex flex-wrap gap-1">
          {BEREICHE.map((b) => (
            <Link
              key={b}
              role="tab"
              aria-selected={bereich === b}
              to="/ordnung"
              search={b === "korrespondenten" ? {} : { bereich: b }}
              replace
              onClick={() => setFilter("")}
              className="-mb-px border-transparent border-b-2 px-3 py-2 font-medium text-muted text-sm hover:text-fg aria-selected:border-fg aria-selected:text-fg"
            >
              {BEREICH_LABEL[b]()}
            </Link>
          ))}
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={m.order_filter()}
          aria-label={m.order_filter()}
          className={`${feldKlasse} mb-2 w-full text-sm sm:w-64`}
        />
      </div>
      <div role="tabpanel" aria-label={BEREICH_LABEL[bereich]()}>
        {bereich === "korrespondenten" && <CorrespondentsAdmin schreiben={schreiben} filter={filter} />}
        {bereich === "tags" && <TagsAdmin schreiben={schreiben} filter={filter} />}
        {bereich === "typen" && <DoctypesAdmin schreiben={schreiben} filter={filter} />}
        {bereich === "felder" && <FieldsAdmin schreiben={schreiben} filter={filter} />}
      </div>
    </div>
  );
}
