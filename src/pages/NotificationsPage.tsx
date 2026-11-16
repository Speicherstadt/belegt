import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.tsx";
import { type Anlaesse, api, type BenachrichtigungsEinstellungen } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 w-20 rounded-md border border-border bg-bg px-2 font-normal";
const primaer = "h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60";

type Anlass = keyof Anlaesse;

const ANLASS: Record<Anlass, () => string> = {
  backup: () => m.notify_backup(),
  postfach: () => m.notify_mailbox(),
  kette: () => m.notify_chain(),
  loeschung: () => m.notify_deletion(),
  fristen: () => m.notify_retention(),
  eingang: () => m.notify_inbox(),
  workflow: () => m.notify_workflow(),
};

const ANLASS_PROTOKOLL: Record<string, () => string> = { ...ANLASS, test: () => m.notify_test_kind() };

/** Ein Anlass mit Schalter und, wo es eine gibt, seiner Schwelle (Tage oder Anzahl) */
function AnlassZeile({
  anlass,
  wert,
  aendern,
}: {
  anlass: Anlass;
  wert: Anlaesse[Anlass];
  aendern: (w: Anlaesse[Anlass]) => void;
}) {
  const schwelle = "tage" in wert ? "tage" : "anzahl" in wert ? "anzahl" : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={wert.an} onChange={(e) => aendern({ ...wert, an: e.target.checked })} />
        {ANLASS[anlass]()}
      </label>
      {schwelle && (
        <label className="flex items-center gap-2 text-muted">
          {schwelle === "tage" ? m.notify_days() : m.notify_count()}
          <input
            type="number"
            min={1}
            max={schwelle === "tage" ? 60 : 100_000}
            required
            value={(wert as Record<string, number | boolean>)[schwelle] as number}
            onChange={(e) => aendern({ ...wert, [schwelle]: Number(e.target.value) })}
            className={feld}
          />
        </label>
      )}
    </li>
  );
}

/**
 * Benachrichtigungen: je Anlass an oder aus mit Schwelle, Empfänger, Testmail und die letzten gesendeten. Verschickt
 * wird im Worker, nur mit MAIL_SMTP_URL; nur für den Inhaber.
 */
export function NotificationsPage() {
  const queryClient = useQueryClient();
  const daten = useQuery({ queryKey: ["benachrichtigungen"], queryFn: api.benachrichtigungen });
  const [wahl, setWahl] = useState<BenachrichtigungsEinstellungen | null>(null);
  const [weitere, setWeitere] = useState("");
  useEffect(() => {
    if (!daten.data || wahl) return;
    setWahl(daten.data.einstellungen);
    setWeitere(daten.data.einstellungen.weitereEmpfaenger.join("\n"));
  }, [daten.data, wahl]);
  const neu = () => queryClient.invalidateQueries({ queryKey: ["benachrichtigungen"] });
  const speichern = useMutation({ mutationFn: api.benachrichtigungenSpeichern, onSuccess: neu });
  const test = useMutation({ mutationFn: api.testmail, onSettled: neu });

  function absenden(e: FormEvent) {
    e.preventDefault();
    if (!wahl) return;
    const adressen = weitere
      .split(/[\s,;]+/)
      .map((a) => a.trim())
      .filter(Boolean);
    speichern.mutate({ ...wahl, weitereEmpfaenger: adressen });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={m.notify_title()} intro={m.notify_intro()} />
      {daten.data && !daten.data.eingerichtet && (
        <p role="status" className="m-0 rounded-md border border-amber-600 bg-subtle p-3 text-sm">
          {m.notify_off()}
        </p>
      )}
      {daten.data?.absender && (
        <p className="m-0 text-muted text-sm">{m.notify_sender({ absender: daten.data.absender })}</p>
      )}
      {wahl && (
        <form onSubmit={absenden} className="flex flex-col gap-4">
          <section aria-labelledby="anlaesse" className="flex flex-col gap-2">
            <h2 id="anlaesse" className="m-0 font-semibold text-base">
              {m.notify_kinds()}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {(Object.keys(ANLASS) as Anlass[]).map((a) => (
                <AnlassZeile
                  key={a}
                  anlass={a}
                  wert={wahl.anlaesse[a]}
                  aendern={(w) => setWahl({ ...wahl, anlaesse: { ...wahl.anlaesse, [a]: w } })}
                />
              ))}
            </ul>
          </section>
          <section aria-labelledby="empfaenger" className="flex flex-col gap-2">
            <h2 id="empfaenger" className="m-0 font-semibold text-base">
              {m.notify_recipients()}
            </h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wahl.anInhaber}
                onChange={(e) => setWahl({ ...wahl, anInhaber: e.target.checked })}
              />
              {m.notify_to_owner()}
            </label>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.notify_more()}
              <textarea
                value={weitere}
                onChange={(e) => setWeitere(e.target.value)}
                rows={3}
                aria-describedby="weitere-hinweis"
                className="rounded-md border border-border bg-bg px-3 py-2 font-normal"
              />
              <span id="weitere-hinweis" className="font-normal text-muted text-xs">
                {m.notify_more_hint()}
              </span>
            </label>
            <p className="m-0 text-muted text-xs">{m.notify_deletion_hint()}</p>
          </section>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={speichern.isPending} className={primaer}>
              {m.access_save()}
            </button>
            <button
              type="button"
              disabled={!daten.data?.eingerichtet || test.isPending}
              onClick={() => test.mutate()}
              className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60"
            >
              {m.notify_test()}
            </button>
          </div>
          {speichern.isSuccess && (
            <p role="status" className="m-0 text-sm">
              {m.access_2fa_policy_saved()}
            </p>
          )}
          {test.isSuccess && (
            <p role="status" className="m-0 text-sm">
              {m.notify_test_sent({ empfaenger: test.data.empfaenger.join(", ") })}
            </p>
          )}
          {(speichern.error ?? test.error) && (
            <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
              {(speichern.error ?? test.error)?.message}
            </p>
          )}
        </form>
      )}
      <section aria-labelledby="gesendet" className="flex flex-col gap-2">
        <h2 id="gesendet" className="m-0 font-semibold text-base">
          {m.notify_sent()}
        </h2>
        {daten.data && !daten.data.gesendet.length && <p className="m-0 text-muted text-sm">{m.notify_sent_none()}</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {daten.data?.gesendet.map((g) => (
            <li key={g.id} className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
              <span className="font-medium">{g.betreff}</span>
              <span className="text-muted">
                {zeitpunkt(g.gesendetAm)} · {ANLASS_PROTOKOLL[g.anlass]?.() ?? g.anlass} · {g.empfaenger.join(", ")}
              </span>
              {!g.ok && (
                <span className="text-red-700 dark:text-red-400">{m.notify_failed({ fehler: g.fehler ?? "" })}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
