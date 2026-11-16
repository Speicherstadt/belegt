import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { type AktionenProtokoll, api, type PostfachAktion, type Quelle } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Die eingestellte Aktion in einem Satz, etwa „löschen, frühestens 24 Stunden nach der Archivierung“ */
export function aktionText(q: Quelle): string {
  if (q.aktion === "gelesen") return m.mailbox_action_read();
  if (q.aktion === "markieren") return m.mailbox_action_flag();
  if (q.aktion === "verschieben") return m.mailbox_action_move_to({ ordner: q.aktionZielPfad ?? q.aktionZiel ?? "" });
  if (q.aktion === "loeschen")
    return q.loeschenNachSperre
      ? m.mailbox_action_delete_after_lock({ stunden: String(q.loeschenWarteStunden) })
      : m.mailbox_action_delete_after({ stunden: String(q.loeschenWarteStunden) });
  return m.mailbox_action_none();
}

const ERGEBNIS: Record<AktionenProtokoll["eintraege"][number]["ergebnis"], () => string> = {
  ausgefuehrt: m.mailbox_log_done,
  entfallen: m.mailbox_log_skipped,
  fehler: m.mailbox_log_error,
};

/** Protokoll der Aktionen eines Postfachs, geladen erst beim Aufklappen */
function Protokoll({ quelle }: { quelle: Quelle }) {
  const [auf, setAuf] = useState(false);
  const p = useQuery({
    queryKey: ["quelle-aktionen", quelle.id],
    queryFn: () => api.quelleAktionen(quelle.id),
    enabled: auf,
  });
  return (
    <details onToggle={(e) => setAuf(e.currentTarget.open)} className="text-sm">
      <summary className="cursor-pointer font-medium">{m.mailbox_log_title()}</summary>
      {p.data && (
        <div className="mt-1 flex flex-col gap-1">
          <p className="m-0 text-muted">
            {m.mailbox_log_counts({
              offen: String(p.data.stand.offen),
              erledigt: String(p.data.stand.erledigt),
              entfallen: String(p.data.stand.entfallen),
              fehlgeschlagen: String(p.data.stand.fehlgeschlagen),
            })}
          </p>
          {p.data.eintraege.length === 0 ? (
            <p className="m-0">{m.mailbox_log_empty()}</p>
          ) : (
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
              {p.data.eintraege.map((e) => (
                <li key={e.id}>
                  {zeitpunkt(e.zeit)} · {e.uid !== null ? `UID ${e.uid}` : e.jmapId} · {ERGEBNIS[e.ergebnis]()}
                  {e.meldung ? ` · ${e.meldung}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

/** Formular für die Aktion; Löschen verlangt eine eigene Bestätigung mit Hinweis */
function Formular({ quelle, fertig }: { quelle: Quelle; fertig: () => void }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [aktion, setAktion] = useState<PostfachAktion>(quelle.aktion);
  const [ziel, setZiel] = useState(quelle.aktionZiel ?? "");
  const ordner = useQuery({
    queryKey: ["quelle-ordner", quelle.id],
    queryFn: () => api.quelleOrdner(quelle.id),
    enabled: aktion === "verschieben",
    retry: false,
  });
  const protokoll = useQuery({
    queryKey: ["quelle-aktionen", quelle.id],
    queryFn: () => api.quelleAktionen(quelle.id),
    enabled: aktion === "loeschen",
  });
  const speichern = useMutation({
    mutationFn: api.quelleAktion,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quellen"] });
      fertig();
    },
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    speichern.mutate({
      id: quelle.id,
      aktion,
      ziel: aktion === "verschieben" ? ziel : null,
      warteStunden: aktion === "loeschen" ? Number(f.get("warten")) : quelle.loeschenWarteStunden,
      nachSperre: f.get("sperre") === "on",
      loeschenBestaetigt: f.get("bestaetigt") === "on",
    });
  }

  return (
    <form onSubmit={absenden} className="flex w-full flex-col gap-3 rounded-md border border-border p-3">
      <label className="flex flex-col gap-1.5 font-medium">
        {m.mailbox_action_label()}
        <select value={aktion} onChange={(e) => setAktion(e.target.value as PostfachAktion)} className={feld}>
          <option value="keine">{m.mailbox_action_none()}</option>
          <option value="gelesen">{m.mailbox_action_read()}</option>
          <option value="markieren">{m.mailbox_action_flag()}</option>
          <option value="verschieben">{m.mailbox_action_move()}</option>
          <option value="loeschen">{m.mailbox_action_delete()}</option>
        </select>
      </label>
      {aktion === "verschieben" && (
        <label className="flex flex-col gap-1.5 font-medium">
          {m.mailbox_action_target()}
          {/* Über die ID gewählt: bei JMAP gibt es denselben Namen unter verschiedenen Eltern */}
          <select
            name="ziel"
            required
            value={ziel}
            onChange={(e) => setZiel(e.target.value)}
            aria-describedby={ordner.error ? `${id}-ordner-fehler` : undefined}
            className={feld}
          >
            <option value="">{ordner.isPending ? m.mailbox_action_target_loading() : ""}</option>
            {ordner.data?.ordner.map((o) => (
              <option key={o.id} value={o.id}>
                {o.pfad}
              </option>
            ))}
          </select>
          {ordner.error && (
            <span id={`${id}-ordner-fehler`} className="font-normal text-red-700 dark:text-red-400">
              {ordner.error.message}
            </span>
          )}
        </label>
      )}
      {aktion === "loeschen" && (
        <>
          <p role="note" className="m-0 rounded-md border border-border bg-subtle p-3">
            {m.mailbox_delete_hint()}
          </p>
          <label className="flex flex-col gap-1.5 font-medium">
            {m.mailbox_delete_wait()}
            <input
              name="warten"
              type="number"
              required
              min={1}
              max={2160}
              defaultValue={quelle.loeschenWarteStunden}
              className={feld}
            />
          </label>
          {protokoll.data?.objektsperre && (
            <label className="flex items-center gap-2 font-medium">
              <input name="sperre" type="checkbox" defaultChecked={quelle.loeschenNachSperre} className="size-4" />
              {m.mailbox_delete_after_lock()}
            </label>
          )}
          <label className="flex items-start gap-2 font-medium">
            <input name="bestaetigt" type="checkbox" required className="mt-0.5 size-4 shrink-0" />
            {m.mailbox_delete_confirm()}
          </label>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={speichern.isPending}
          className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
        >
          {m.mailbox_action_save()}
        </button>
        <button type="button" onClick={fertig} className="h-9 rounded-md border border-border px-3 font-medium">
          {m.mailbox_action_cancel()}
        </button>
      </div>
      {speichern.error && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {speichern.error.message}
        </p>
      )}
    </form>
  );
}

/** Aktion nach dem Abholen eines Postfachs: Anzeige, Ändern (nur der Inhaber) und Protokoll */
export function MailboxAction({ quelle, inhaber }: { quelle: Quelle; inhaber: boolean }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  return (
    <div className="flex w-full flex-col gap-2 text-sm">
      <span className="flex flex-wrap items-center gap-2">
        <span>{m.mailbox_action_current({ aktion: aktionText(quelle) })}</span>
        {quelle.aktion === "loeschen" && quelle.loeschenBestaetigtAm && (
          <span className="text-muted">
            {m.mailbox_delete_confirmed({
              wer: quelle.loeschenBestaetigtVon ?? "",
              wann: zeitpunkt(quelle.loeschenBestaetigtAm),
            })}
          </span>
        )}
        {inhaber && !bearbeiten && (
          <button
            type="button"
            onClick={() => setBearbeiten(true)}
            className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
          >
            {m.mailbox_action_change()}
          </button>
        )}
      </span>
      {bearbeiten && <Formular quelle={quelle} fertig={() => setBearbeiten(false)} />}
      {quelle.aktion !== "keine" && <Protokoll quelle={quelle} />}
    </div>
  );
}
