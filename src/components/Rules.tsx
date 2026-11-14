import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { type Art, api } from "../lib/api.ts";
import { ARTEN, artLabel } from "../lib/arten.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Regeln für Vorschläge: Liste, anlegen, ein- und ausschalten */
export function Rules() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["regeln"], queryFn: api.regeln });
  const [art, setArt] = useState<Art>("beleg");
  const neu = () => queryClient.invalidateQueries({ queryKey: ["regeln"] });
  const anlegen = useMutation({ mutationFn: api.regelAnlegen, onSuccess: neu });
  const schalten = useMutation({
    mutationFn: ({ id, aktiv }: { id: string; aktiv: boolean }) => api.regelSchalten(id, aktiv),
    onSuccess: neu,
  });
  const schreiben = darfSchreiben(ich.data?.role);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    anlegen.mutate(
      {
        name: String(f.get("name")),
        wenn: {
          absender: text("absender"),
          domain: text("domain"),
          betreffEnthaelt: text("betreff"),
          anhangTyp: text("anhang"),
        },
        dann: art,
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section aria-labelledby="regeln" className="flex flex-col gap-3">
      <h2 id="regeln" className="m-0 font-semibold text-base">
        {m.rules_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.rules_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.rules_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
          >
            <span className="flex flex-col">
              <span className="font-medium">
                {r.name} → {artLabel(r.art)}
              </span>
              <span className="text-muted">
                {Object.entries(r.bedingung)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}{" "}
                · {r.aktiv ? m.rules_active() : m.rules_inactive()}
              </span>
            </span>
            {schreiben && (
              <button
                type="button"
                onClick={() => schalten.mutate({ id: r.id, aktiv: !r.aktiv })}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
              >
                {r.aktiv ? m.rules_disable() : m.rules_enable()}
              </button>
            )}
          </li>
        ))}
      </ul>
      {schreiben && (
        <form
          onSubmit={absenden}
          className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3 rounded-lg border border-border p-3"
        >
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.rules_name()}
            <input name="name" required className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.rules_sender()}
            <input name="absender" type="email" className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.rules_domain()}
            <input name="domain" className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.rules_subject()}
            <input name="betreff" className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.rules_attachment()}
            <input name="anhang" placeholder="application/pdf" className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.rules_then()}
            <select value={art} onChange={(e) => setArt(e.target.value as Art)} className={feld}>
              {ARTEN.map((a) => (
                <option key={a.art} value={a.art}>
                  {a.label()}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm">
            {m.rules_create()}
          </button>
        </form>
      )}
      {(anlegen.error ?? schalten.error) && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.rules_failed({ meldung: (anlegen.error ?? schalten.error)!.message })}
        </p>
      )}
    </section>
  );
}
