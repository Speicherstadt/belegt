import { Link } from "@tanstack/react-router";
import type { Start } from "../../lib/api.ts";
import { groesse, tag } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";
import { BereichSymbol } from "../Symbole.tsx";

const kachel = "flex flex-col gap-1 rounded-lg border border-border p-4";

/** Zahlen der Startseite als Beschreibungsliste: jede Zahl mit ihrer Beschriftung, für Screenreader zusammen gelesen */
export function StartNumbers({ start }: { start: Start }) {
  const zahlen: {
    label: string;
    wert: string;
    link?: { to: string; text: string };
    hinweis?: string;
    bereich?: string;
  }[] = [
    {
      label: m.start_inbox(),
      bereich: "/eingang",
      wert: String(start.eingang),
      link: { to: "/eingang", text: m.start_inbox_link() },
    },
    {
      label: m.start_total(),
      bereich: "/archiv",
      wert: String(start.gesamt),
      link: { to: "/archiv", text: m.start_archive_link() },
    },
    { label: m.start_this_year(), wert: String(start.diesesJahr) },
  ];
  if (start.loeschantraege !== undefined)
    zahlen.push({
      label: m.start_deletion_requests(),
      bereich: "/fristen",
      wert: String(start.loeschantraege),
      link: { to: "/fristen", text: m.start_retention_link() },
    });
  if (start.sperren)
    zahlen.push({
      label: m.start_holds(),
      bereich: "/pruefung",
      wert: String(start.sperren.aktiv),
      hinweis: m.start_holds_hint({ anzahl: String(start.sperren.dokumente) }),
    });
  if (start.speicher)
    zahlen.push({
      label: m.start_storage(),
      wert: groesse(start.speicher.bytes),
      hinweis: m.start_storage_hint({ anzahl: String(start.speicher.dateien) }),
    });
  return (
    <section aria-labelledby="start-zahlen" className="flex flex-col gap-3">
      <h2 id="start-zahlen" className="m-0 font-semibold text-lg">
        {m.start_numbers()}
      </h2>
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        {zahlen.map((z) => (
          <div key={z.label} className={kachel}>
            <dt className="flex items-center gap-2 text-muted text-sm">
              {z.bereich && <BereichSymbol bereich={z.bereich} />}
              {z.label}
            </dt>
            <dd className="m-0 font-semibold text-2xl tabular-nums">{z.wert}</dd>
            {z.hinweis && <dd className="m-0 text-muted text-xs">{z.hinweis}</dd>}
            {z.link && (
              <dd className="m-0 text-sm">
                <Link to={z.link.to} className="underline underline-offset-2">
                  {z.link.text}
                </Link>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Fristen, die in den nächsten 90 Tagen enden: Zahl und die nächsten fünf mit dem Tag, ab dem sie löschbar sind */
export function UpcomingRetention({ fristen }: { fristen: NonNullable<Start["fristen"]> }) {
  const tagDanach = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  return (
    <section aria-labelledby="start-fristen" className={kachel}>
      <h2 id="start-fristen" className="m-0 flex items-center gap-2 font-semibold text-lg">
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
