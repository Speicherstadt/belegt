import { type Aufbewahrungsart, gesetzlicheJahre } from "../../shared/fristen.ts";
import { Holds } from "../components/Holds.tsx";
import { Overview } from "../components/Overview.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { m } from "../paraglide/messages.js";

const ARTEN: { art: Aufbewahrungsart; label: () => string; grundlage: (() => string) | null }[] = [
  { art: "buecher", label: () => m.kind_books(), grundlage: () => m.basis_books() },
  { art: "zoll", label: () => m.kind_customs(), grundlage: () => m.basis_customs() },
  { art: "beleg", label: () => m.kind_receipt(), grundlage: () => m.basis_receipt() },
  { art: "geschaeftsbrief", label: () => m.kind_letter(), grundlage: () => m.basis_letter() },
  { art: "sonstige", label: () => m.kind_other(), grundlage: () => m.basis_other() },
  { art: "freiwillig", label: () => m.kind_voluntary(), grundlage: null },
  { art: "frei", label: () => m.kind_free(), grundlage: null },
];

function frist(art: Aufbewahrungsart): string {
  const jahre = gesetzlicheJahre(art);
  if (jahre !== null) return m.period_years({ years: String(jahre) });
  return art === "freiwillig" ? m.period_chosen() : m.period_none();
}

export function RetentionPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={m.retention_title()} intro={m.retention_intro()} />
      <Overview />
      {/* Auf schmalen Bildschirmen scrollt die Tabelle seitlich: per Tastatur erreichbar und benannt (WCAG 2.1.1) */}
      <section
        aria-label={m.retention_title()}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: ein scrollbarer Bereich muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-primary"
      >
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-border border-b text-left text-muted">
              <th className="px-3 py-2.5 font-medium">{m.retention_col_kind()}</th>
              <th className="px-3 py-2.5 font-medium">{m.retention_col_period()}</th>
              <th className="px-3 py-2.5 font-medium">{m.retention_col_basis()}</th>
            </tr>
          </thead>
          <tbody>
            {ARTEN.map((a) => (
              <tr key={a.art} className="border-border border-b last:border-b-0">
                <td className="px-3 py-3 font-medium">{a.label()}</td>
                <td className="px-3 py-3">{frist(a.art)}</td>
                <td className="px-3 py-3 text-muted">{a.grundlage?.() ?? m.basis_none()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="m-0 text-muted text-sm">{m.retention_start()}</p>
      <p className="m-0 rounded-md border border-border bg-subtle px-3 py-2.5 text-sm">{m.retention_hold()}</p>
      <Holds />
    </div>
  );
}
