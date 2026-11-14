import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { type Art, api, type Einordnung } from "../lib/api.ts";
import { ARTEN, artLabel } from "../lib/arten.ts";
import { tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Einordnung eines Dokuments: aktueller Stand und, für den Inhaber, das Formular für eine neue Version */
export function Classification({
  dokumentId,
  einordnung,
  eingang,
}: {
  dokumentId: string;
  einordnung: Einordnung | null;
  eingang: string;
}) {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState(!einordnung);
  const [art, setArt] = useState<Art>(einordnung?.art ?? "beleg");
  const vorschlag = useQuery({
    queryKey: ["vorschlag", dokumentId],
    queryFn: () => api.vorschlag(dokumentId),
    enabled: !einordnung,
  });
  const speichern = useMutation({
    mutationFn: (eingabe: Parameters<typeof api.einordnen>[1]) => api.einordnen(dokumentId, eingabe),
    onSuccess: async () => {
      setOffen(false);
      await queryClient.invalidateQueries();
    },
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    speichern.mutate({
      art,
      entstanden: String(f.get("entstanden")),
      freiwilligBis: text("freiwilligBis"),
      titel: text("titel"),
      korrespondent: text("korrespondent"),
    });
  }

  return (
    <section aria-labelledby="einordnung" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="einordnung" className="m-0 font-semibold text-base">
        {m.classify_title()}
      </h2>
      {einordnung ? (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{m.classify_kind()}</dt>
          <dd className="m-0 font-medium">{artLabel(einordnung.art)}</dd>
          <dt className="text-muted">{m.classify_created()}</dt>
          <dd className="m-0">{tag(einordnung.entstanden)}</dd>
          <dt className="text-muted">{m.classify_period()}</dt>
          <dd className="m-0">
            {einordnung.fristBis ? m.retention_until({ datum: tag(einordnung.fristBis) }) : m.classify_until_free()}
          </dd>
        </dl>
      ) : (
        <p className="m-0 text-muted text-sm">{m.classify_none()}</p>
      )}
      {darfSchreiben(ich.data?.role) && !offen && (
        <button
          type="button"
          onClick={() => setOffen(true)}
          className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
        >
          {m.classify_change()}
        </button>
      )}
      {darfSchreiben(ich.data?.role) && offen && vorschlag.data?.vorschlag && (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle p-2 text-sm">
          {m.suggest_label({ art: artLabel(vorschlag.data.vorschlag.art), regel: vorschlag.data.vorschlag.regel.name })}
          <button
            type="button"
            onClick={() => setArt(vorschlag.data!.vorschlag!.art)}
            className="h-8 rounded-md border border-border bg-bg px-3 font-medium"
          >
            {m.suggest_apply()}
          </button>
        </p>
      )}
      {darfSchreiben(ich.data?.role) && offen && (
        <form onSubmit={absenden} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_kind()}
            <select value={art} onChange={(e) => setArt(e.target.value as Art)} className={feld}>
              {ARTEN.map((a) => (
                <option key={a.art} value={a.art}>
                  {a.label()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_created()}
            <input
              name="entstanden"
              type="date"
              required
              defaultValue={einordnung?.entstanden ?? eingang.slice(0, 10)}
              className={feld}
            />
          </label>
          {art === "freiwillig" && (
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.classify_voluntary_until()}
              <input
                name="freiwilligBis"
                type="date"
                required
                defaultValue={einordnung?.art === "freiwillig" ? (einordnung.fristBis ?? "") : ""}
                className={feld}
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_label()}
            <input name="titel" defaultValue={einordnung?.titel ?? ""} className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_party()}
            <input name="korrespondent" defaultValue={einordnung?.korrespondent ?? ""} className={feld} />
          </label>
          {einordnung && <p className="m-0 text-muted text-xs">{m.classify_hint()}</p>}
          {speichern.error && (
            <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
              {m.classify_failed({ meldung: speichern.error.message })}
            </p>
          )}
          <button
            type="submit"
            disabled={speichern.isPending}
            className="h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
          >
            {m.classify_submit()}
          </button>
        </form>
      )}
    </section>
  );
}
