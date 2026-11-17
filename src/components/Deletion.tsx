import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, type Einordnung, type Ich, type Loeschung } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { alleinInhaber } from "../lib/rollen.ts";
import { m } from "../paraglide/messages.js";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

/** Darf ich als zweite Person bestätigen? Nicht, wer beantragt hat; nur Inhaber und Steuerberatung */
export function kannBestaetigen(l: Loeschung, ich: Ich | undefined): boolean {
  return !!ich && (ich.role === "inhaber" || ich.role === "steuerberatung") && l.beantragtVon !== `nutzer:${ich.email}`;
}

/** Löschung auf der Dokumentseite: Nachweis, offener Antrag oder Antrag stellen */
export function Deletion({
  dokumentId,
  einordnung,
  vormalsAnders,
  loeschung,
}: {
  dokumentId: string;
  einordnung: Einordnung | null;
  vormalsAnders: boolean;
  loeschung: Loeschung | null;
}) {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const zugaenge = useQuery({ queryKey: ["zugaenge"], queryFn: api.zugaenge, enabled: ich.data?.role === "inhaber" });
  const [fragenBestaetigen, setFragenBestaetigen] = useState(false);
  const [fragenJetzt, setFragenJetzt] = useState(false);
  const neu = () => queryClient.invalidateQueries();
  const beantragen = useMutation({ mutationFn: () => api.loeschungBeantragen(dokumentId), onSuccess: neu });
  const bestaetigen = useMutation({ mutationFn: (id: string) => api.loeschungBestaetigen(id), onSuccess: neu });
  const zurueckziehen = useMutation({ mutationFn: (id: string) => api.loeschungZurueckziehen(id), onSuccess: neu });
  const fehler = beantragen.error ?? bestaetigen.error ?? zurueckziehen.error;
  const abgelaufen =
    einordnung && (einordnung.art === "frei" || (einordnung.fristBis !== null && einordnung.fristBis < heute()));
  if (!loeschung && !abgelaufen) return null;
  // Der Server löscht sofort nur, wenn alle Einordnungen frei waren (server/loeschung/loeschung.ts)
  const sofort = einordnung?.art === "frei" && !vormalsAnders;

  return (
    <section aria-labelledby="loeschung" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="loeschung" className="m-0 font-semibold text-base">
        {m.delete_title()}
      </h2>
      {loeschung?.bestaetigtAm && (
        <p className="m-0 text-sm">
          {m.delete_done({
            wann: zeitpunkt(loeschung.bestaetigtAm),
            antrag: loeschung.beantragtVon,
            bestaetigt: loeschung.bestaetigtVon ?? "",
          })}
        </p>
      )}
      {loeschung && !loeschung.bestaetigtAm && (
        <>
          <p className="m-0 text-sm">
            {m.delete_requested({ wer: loeschung.beantragtVon, wann: zeitpunkt(loeschung.beantragtAm) })}
          </p>
          {alleinInhaber(zugaenge.data, ich.data) && (
            <p className="m-0 text-sm">
              {m.delete_alone_before()}{" "}
              <Link to="/zugaenge" className="underline">
                {m.nav_access()}
              </Link>{" "}
              {m.delete_alone_after()}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {kannBestaetigen(loeschung, ich.data) && (
              <>
                <button
                  type="button"
                  onClick={() => setFragenBestaetigen(true)}
                  className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm"
                >
                  {m.delete_confirm()}
                </button>
                <ConfirmDialog
                  open={fragenBestaetigen}
                  titel={m.delete_confirm_title()}
                  folge={m.delete_confirm_follow()}
                  verb={m.delete_final()}
                  haken={m.delete_confirm_check()}
                  pending={bestaetigen.isPending}
                  fehler={bestaetigen.error ? m.delete_failed({ meldung: bestaetigen.error.message }) : undefined}
                  onConfirm={() => bestaetigen.mutate(loeschung.id, { onSuccess: () => setFragenBestaetigen(false) })}
                  onCancel={() => {
                    setFragenBestaetigen(false);
                    bestaetigen.reset();
                  }}
                />
              </>
            )}
            {ich.data?.role === "inhaber" && (
              <button
                type="button"
                onClick={() => zurueckziehen.mutate(loeschung.id)}
                className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
              >
                {m.delete_withdraw()}
              </button>
            )}
          </div>
        </>
      )}
      {!loeschung && ich.data?.role === "inhaber" && (
        <>
          <p className="m-0 text-muted text-sm">{sofort ? m.delete_hint_free() : m.delete_hint()}</p>
          {sofort ? (
            <>
              <button
                type="button"
                onClick={() => setFragenJetzt(true)}
                className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
              >
                {m.delete_now()}
              </button>
              <ConfirmDialog
                open={fragenJetzt}
                titel={m.delete_now_title()}
                folge={m.delete_now_follow()}
                verb={m.delete_now()}
                pending={beantragen.isPending}
                fehler={beantragen.error ? m.delete_failed({ meldung: beantragen.error.message }) : undefined}
                onConfirm={() => beantragen.mutate(undefined, { onSuccess: () => setFragenJetzt(false) })}
                onCancel={() => {
                  setFragenJetzt(false);
                  beantragen.reset();
                }}
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => beantragen.mutate()}
              className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
            >
              {m.delete_request()}
            </button>
          )}
        </>
      )}
      {fehler && !fragenJetzt && !fragenBestaetigen && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.delete_failed({ meldung: fehler.message })}
        </p>
      )}
    </section>
  );
}
