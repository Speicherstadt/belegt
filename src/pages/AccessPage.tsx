import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AccessUsers } from "../components/AccessUsers.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import {
  LEERER_SICHTBEREICH,
  type MitarbeiterWahl,
  ScopeEditor,
  sichtbereichText,
  useNamen,
} from "../components/ScopeEditor.tsx";
import { api } from "../lib/api.ts";
import { tag, zeitpunkt } from "../lib/format.ts";
import { rolleLabel } from "../lib/rollen.ts";
import { m } from "../paraglide/messages.js";

const zeitraumText = (von: string, bis: string) => m.access_period({ von: tag(von), bis: tag(bis) });

/** Zugänge: Konten (Mitarbeiter ändern, entziehen), Einladungen anlegen und zurückziehen; nur für den Inhaber */
export function AccessPage() {
  const queryClient = useQueryClient();
  const daten = useQuery({ queryKey: ["zugaenge"], queryFn: api.zugaenge });
  const [rolle, setRolle] = useState<"steuerberatung" | "pruefer" | "mitarbeiter">("steuerberatung");
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterWahl>({
    recht: "lesen",
    sichtbereich: LEERER_SICHTBEREICH,
  });
  const { name } = useNamen();
  const jahr = String(new Date().getFullYear() - 1);
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(`${jahr}-12-31`);
  const [link, setLink] = useState<string | null>(null);
  const zeitraumOk = rolle !== "pruefer" || (!!von && !!bis && von <= bis);
  const einladen = useMutation({
    mutationFn: () =>
      api.einladen(
        rolle === "pruefer"
          ? { rolle, zeitraum: { von, bis } }
          : rolle === "mitarbeiter"
            ? { rolle, ...mitarbeiter }
            : { rolle },
      ),
    onSuccess: async (e) => {
      setLink(`${window.location.origin}${e.pfad}`);
      await queryClient.invalidateQueries({ queryKey: ["zugaenge"] });
    },
  });
  const zurueckziehen = useMutation({
    mutationFn: api.zurueckziehen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["zugaenge"] }),
  });

  function zustand(e: NonNullable<typeof daten.data>["einladungen"][number]): string {
    if (e.eingeloestAm) return m.access_state_used({ email: e.eingeloestVon ?? "" });
    if (e.zurueckgezogenAm) return m.access_state_revoked();
    if (new Date(e.gueltigBis) < new Date()) return m.access_state_expired();
    return m.access_state_open({ datum: zeitpunkt(e.gueltigBis) });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.access_title()} intro={m.access_intro()} />
      <section aria-labelledby="konten" className="flex flex-col gap-2">
        <h2 id="konten" className="m-0 font-semibold text-base">
          {m.access_users()}
        </h2>
        {daten.data && <AccessUsers zugaenge={daten.data.zugaenge} />}
      </section>
      <section aria-labelledby="einladungen" className="flex flex-col gap-3">
        <h2 id="einladungen" className="m-0 font-semibold text-base">
          {m.access_invites()}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.access_role()}
            <select
              value={rolle}
              onChange={(e) => setRolle(e.target.value as typeof rolle)}
              className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
            >
              <option value="steuerberatung">{m.role_steuerberatung()}</option>
              <option value="pruefer">{m.role_pruefer()}</option>
              <option value="mitarbeiter">{m.role_mitarbeiter()}</option>
            </select>
          </label>
          {rolle === "pruefer" && (
            <>
              <label className="flex flex-col gap-1.5 font-medium text-sm">
                {m.export_from()}
                <input
                  type="date"
                  value={von}
                  onChange={(e) => setVon(e.target.value)}
                  className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
                />
              </label>
              <label className="flex flex-col gap-1.5 font-medium text-sm">
                {m.export_to()}
                <input
                  type="date"
                  value={bis}
                  onChange={(e) => setBis(e.target.value)}
                  className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
                />
              </label>
            </>
          )}
          {rolle === "mitarbeiter" && (
            <div className="basis-full">
              <ScopeEditor wert={mitarbeiter} aendern={setMitarbeiter} />
            </div>
          )}
          <button
            type="button"
            disabled={!zeitraumOk}
            onClick={() => einladen.mutate()}
            className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
          >
            {m.access_invite()}
          </button>
        </div>
        {link && (
          <p role="status" className="m-0 flex flex-col gap-1 rounded-md border border-border bg-subtle p-3 text-sm">
            {m.access_link()}
            <code className="break-all">{link}</code>
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {daten.data?.einladungen.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <span>
                <span className="font-medium">{rolleLabel(e.rolle)}</span>
                {e.zeitraumVon && e.zeitraumBis && ` (${zeitraumText(e.zeitraumVon, e.zeitraumBis)})`}
                {e.sichtbereich && ` (${sichtbereichText(e.sichtbereich, name)})`} ·{" "}
                <span className="text-muted">{zustand(e)}</span>
              </span>
              {!e.eingeloestAm && !e.zurueckgezogenAm && new Date(e.gueltigBis) > new Date() && (
                <button
                  type="button"
                  onClick={() => zurueckziehen.mutate(e.id)}
                  className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
                >
                  {m.access_revoke()}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
