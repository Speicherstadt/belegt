import { Link } from "@tanstack/react-router";
import type { Start } from "../../lib/api.ts";
import { tag } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";
import { BereichSymbol } from "../Symbole.tsx";

const kachel = "flex flex-col gap-1 rounded-lg border border-border p-3.5";

/** Fristen, die in den nächsten 90 Tagen enden: Zahl und die nächsten fünf mit dem Tag, ab dem sie löschbar sind */
export function UpcomingRetention({ fristen }: { fristen: NonNullable<Start["fristen"]> }) {
  const tagDanach = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  return (
    <section aria-labelledby="start-fristen" className={kachel}>
      <h2 id="start-fristen" className="m-0 flex items-center gap-2 font-semibold text-base">
        <BereichSymbol bereich="/fristen" className="size-4 text-muted" />
        {m.start_retention_title()}
      </h2>
      <p className="m-0 text-sm">
        <span className="font-semibold text-2xl tabular-nums">{fristen.anzahl}</span>{" "}
        <span className="text-muted">{m.start_retention_count()}</span>
      </p>
      {fristen.naechste.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {fristen.naechste.map((f) => (
            <li key={f.id} className="flex flex-wrap justify-between gap-2">
              <Link to="/dokumente/$id" params={{ id: f.id }} className="underline underline-offset-2">
                {f.titel || f.dateiname || m.start_asn({ asn: String(f.asn) })}
              </Link>
              <span className="text-muted">{m.start_deletable_from({ tag: tag(tagDanach(f.fristBis)) })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
