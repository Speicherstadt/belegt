import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { type ApiToken, api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { Einmalwert } from "./Einmalwert.tsx";

/** API-Tokens für Programme: anlegen (Klartext einmal), Liste, widerrufen; nur für den Inhaber */
export function ApiTokens() {
  const id = useId();
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: api.tokens });
  const [neuesToken, setNeuesToken] = useState<{ id: string; klartext: string } | null>(null);
  const neu = () => queryClient.invalidateQueries({ queryKey: ["tokens"] });
  const anlegen = useMutation({
    mutationFn: ({ name, recht }: { name: string; recht: ApiToken["recht"] }) => api.tokenAnlegen(name, recht),
    onSuccess: async (t) => {
      setNeuesToken({ id: t.id, klartext: t.klartext });
      await neu();
    },
  });
  const widerrufen = useMutation({
    mutationFn: api.tokenWiderrufen,
    onSuccess: (_, id) => {
      // Ein widerrufenes Token soll nicht weiter auf der Seite stehen
      if (neuesToken?.id === id) setNeuesToken(null);
      return neu();
    },
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    anlegen.mutate({ name: String(f.get("name") ?? ""), recht: f.get("recht") as ApiToken["recht"] });
    e.currentTarget.reset();
  }

  return (
    <section aria-labelledby={`${id}-titel`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id={`${id}-titel`} className="m-0 font-semibold text-base">
        {m.tokens_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.tokens_intro()}</p>
      <p className="m-0 text-muted text-sm">
        {m.tokens_mcp()} <code className="break-all">{`${window.location.origin}/api/mcp`}</code>
      </p>
      <form onSubmit={absenden} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.tokens_name()}
          <input name="name" required maxLength={200} className="h-9 rounded-md border border-border bg-bg px-3" />
        </label>
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.tokens_right()}
          <select name="recht" className="h-9 rounded-md border border-border bg-bg px-3 font-normal">
            <option value="lesen">{m.tokens_read()}</option>
            <option value="schreiben">{m.tokens_write()}</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm">
          {m.tokens_create()}
        </button>
      </form>
      {neuesToken && <Einmalwert label={m.tokens_once()} wert={neuesToken.klartext} />}
      {anlegen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {anlegen.error.message}
        </p>
      )}
      {tokens.data?.length === 0 && <p className="m-0 text-muted text-sm">{m.tokens_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {tokens.data?.map((t) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
          >
            <span>
              <span className="font-medium">{t.name}</span> ·{" "}
              <span className="text-muted">
                {t.recht === "schreiben" ? m.tokens_write() : m.tokens_read()} ·{" "}
                {t.widerrufenAm
                  ? m.tokens_revoked({ datum: zeitpunkt(t.widerrufenAm) })
                  : m.tokens_created({ datum: zeitpunkt(t.erstelltAm) })}
              </span>
            </span>
            {!t.widerrufenAm && (
              <button
                type="button"
                onClick={() => widerrufen.mutate(t.id)}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
              >
                {m.tokens_revoke()}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
