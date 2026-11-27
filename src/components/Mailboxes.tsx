import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleX } from "lucide-react";
import { type Ref, type RefObject, useEffect, useRef, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { type ApiFehler, api, type Quelle } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { verwaltungsKarte } from "./Ausklappbar.tsx";
import { MailboxAction } from "./MailboxAction.tsx";
import { MailboxAnlegen, type PostfachEingabe } from "./MailboxAnlegen.tsx";
import { OAUTH } from "./MailboxAnlegenTeile.tsx";
import { MailboxEdit } from "./MailboxEdit.tsx";

/** So lange fragt die Liste nach dem Anlegen alle 2 s nach, ob der erste Abruf gelaufen ist */
const ERSTER_ABRUF_MS = 60_000;

/** Rückmeldung über der Liste: Postfach angelegt, über OAuth verbunden oder die Rückkehr schlug fehl */
export type Rueckmeldung = { art: "angelegt"; name: string } | { art: "verbunden" } | { art: "fehler" };

/** Eine Zeile, kein Kasten: bleibt stehen (kein Toast, WCAG 2.2.1) und bekommt nach dem Anlegen den Fokus */
export function RueckmeldungZeile({
  rueckmeldung,
  zeile,
}: {
  rueckmeldung: Rueckmeldung;
  zeile?: Ref<HTMLParagraphElement>;
}) {
  const fehler = rueckmeldung.art === "fehler";
  return (
    <p ref={zeile} role={fehler ? "alert" : "status"} tabIndex={-1} className="m-0 flex items-start gap-2 text-sm">
      <span className={`flex h-5 items-center ${fehler ? "text-danger" : "text-ok"}`}>
        {fehler ? (
          <CircleX className="size-4" aria-hidden="true" />
        ) : (
          <CircleCheck className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {fehler
          ? m.oauth_failed()
          : rueckmeldung.art === "verbunden"
            ? m.oauth_connected()
            : m.mailboxes_created({ name: rueckmeldung.name })}{" "}
        {!fehler && (
          <Link to="/eingang" className="inline-flex min-h-6 items-center font-medium underline">
            {m.mailboxes_to_inbox()}
          </Link>
        )}
      </span>
    </p>
  );
}

/** Rückkehr vom Anbieter: /quellen?oauth=verbunden|abgelehnt|abgelaufen|fehler */
function ausDerAdresse(): Rueckmeldung | null {
  const ergebnis = new URLSearchParams(window.location.search).get("oauth");
  return ergebnis === "verbunden" ? { art: "verbunden" } : ergebnis ? { art: "fehler" } : null;
}

/** Alles, was die Karte „Postfächer“ weiß: Ansicht, Rückmeldung, Anlegen mit Prüfung, Nachfragen nach dem ersten Abruf */
function usePostfaecher() {
  const queryClient = useQueryClient();
  const einstieg = useRef<HTMLButtonElement>(null);
  const erfolg = useRef<HTMLParagraphElement>(null);
  const nachListe = useRef<"erfolg" | "knopf" | null>(null);
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const [ansicht, setAnsicht] = useState<"liste" | "anlegen">("liste");
  const [rueckmeldung, setRueckmeldung] = useState(ausDerAdresse);
  const [pollenBis, setPollenBis] = useState(() =>
    rueckmeldung?.art === "verbunden" ? Date.now() + ERSTER_ABRUF_MS : 0,
  );
  const liste = useQuery({
    queryKey: ["quellen"],
    queryFn: api.quellen,
    // Nach dem Anlegen läuft der erste Abruf von selbst: die Liste fragt nach, bis er gemeldet ist (höchstens eine Minute)
    refetchInterval: (q) =>
      Date.now() < pollenBis && q.state.data?.some((x) => !x.letzterAbruf && !x.letzterFehler) ? 2000 : false,
  });
  const anlegen = useMutation({ mutationFn: api.quelleAnlegen });
  const anbieter = useQuery({ queryKey: ["oauth"], queryFn: api.oauthAnbieter, enabled: ich.data?.role === "inhaber" });

  useEffect(() => {
    if (ansicht !== "liste" || !nachListe.current) return;
    (nachListe.current === "erfolg" ? erfolg : einstieg).current?.focus();
    nachListe.current = null;
  }, [ansicht]);

  function oeffnen() {
    anlegen.reset();
    setRueckmeldung(null);
    // Die Rückmeldung der Rückkehr käme sonst nach dem Neuladen wieder
    if (window.location.search.includes("oauth=")) window.history.replaceState(null, "", window.location.pathname);
    setAnsicht("anlegen");
  }

  function abbrechen() {
    anlegen.reset();
    nachListe.current = "knopf";
    setAnsicht("liste");
  }

  function absenden(eingabe: PostfachEingabe) {
    if (anlegen.isPending) return;
    anlegen.mutate(eingabe, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setRueckmeldung({ art: "angelegt", name: eingabe.name });
        setPollenBis(Date.now() + ERSTER_ABRUF_MS);
        nachListe.current = "erfolg";
        setAnsicht("liste");
      },
    });
  }

  return {
    einstieg,
    erfolg,
    ich,
    ansicht,
    rueckmeldung,
    setRueckmeldung,
    liste,
    anlegen,
    anbieter,
    oeffnen,
    abbrechen,
    absenden,
  };
}

/** Ein Postfach in der Liste: Name, Stand, „Jetzt abrufen“, Ändern, Entfernen, Aktion */
export function QuelleEintrag({
  q,
  schreiben,
  inhaber,
  abrufenGesperrt,
  onAbrufen,
  nachEntfernen,
}: {
  q: Quelle;
  schreiben: boolean;
  inhaber: boolean;
  abrufenGesperrt: boolean;
  onAbrufen: () => void;
  nachEntfernen: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <span className="flex flex-col">
        <span className="font-medium [overflow-wrap:anywhere]">
          {q.name} · {q.art === "jmap" ? "JMAP" : q.oauth ? `IMAP (${OAUTH[q.oauth]})` : "IMAP"} · {q.benutzer}@{q.host}
          :{q.port}/{q.ordner}
        </span>
        <span className="text-muted">
          {q.letzterAbruf ? m.mailboxes_last({ wann: zeitpunkt(q.letzterAbruf) }) : m.mailboxes_never()}
        </span>
        {q.letzterFehler && <span className="text-danger">{m.mailboxes_error({ meldung: q.letzterFehler })}</span>}
      </span>
      {schreiben && (
        <button
          type="button"
          onClick={onAbrufen}
          disabled={abrufenGesperrt}
          className="h-10 pointer-coarse:h-11 rounded-md border border-border px-3 font-medium hover:bg-subtle disabled:opacity-60"
        >
          {m.mailboxes_fetch()}
        </button>
      )}
      <MailboxEdit quelle={q} inhaber={inhaber} nachEntfernen={nachEntfernen} />
      <MailboxAction quelle={q} inhaber={inhaber} />
    </li>
  );
}

/** Die Liste mit dem Ergebnis des letzten „Jetzt abrufen“ darunter */
function Postfachliste({
  quellen,
  schreiben,
  inhaber,
  neuerAbruf,
  titel,
}: {
  quellen: Quelle[] | undefined;
  schreiben: boolean;
  inhaber: boolean;
  neuerAbruf: () => void;
  titel: RefObject<HTMLHeadingElement | null>;
}) {
  const queryClient = useQueryClient();
  const abrufen = useMutation({ mutationFn: api.quelleAbrufen, onSettled: () => queryClient.invalidateQueries() });
  return (
    <>
      {quellen?.length === 0 && <p className="m-0 text-sm">{m.mailboxes_none()}</p>}
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {quellen?.map((q) => (
          <QuelleEintrag
            key={q.id}
            q={q}
            schreiben={schreiben}
            inhaber={inhaber}
            abrufenGesperrt={abrufen.isPending}
            onAbrufen={() => {
              neuerAbruf();
              abrufen.mutate(q.id);
            }}
            nachEntfernen={() => {
              neuerAbruf();
              titel.current?.focus();
            }}
          />
        ))}
      </ul>
      {abrufen.data && !abrufen.data.fehler && (
        <p role="status" className="m-0 text-sm">
          {abrufen.data.laeuft
            ? m.mailboxes_running()
            : m.mailboxes_result({ neu: String(abrufen.data.neu), doppelt: String(abrufen.data.doppelt) })}
        </p>
      )}
      {abrufen.error && (
        <p role="alert" className="m-0 text-danger text-sm">
          {m.mailboxes_failed({ meldung: abrufen.error.message })}
        </p>
      )}
    </>
  );
}

/** Postfächer für den IMAP-Abruf: Liste mit Stand, hinzufügen (prüft die Verbindung), jetzt abrufen */
export function Mailboxes() {
  const titel = useRef<HTMLHeadingElement>(null);
  const p = usePostfaecher();
  const inhaber = p.ich.data?.role === "inhaber";
  const schreiben = darfSchreiben(p.ich.data?.role);

  return (
    <section aria-labelledby="postfaecher" className={verwaltungsKarte}>
      <h2 id="postfaecher" ref={titel} tabIndex={-1} className="m-0 font-semibold text-base">
        {m.mailboxes_title()}
      </h2>
      {schreiben && p.ansicht === "anlegen" ? (
        <MailboxAnlegen
          anbieter={p.anbieter.data?.anbieter ?? []}
          laeuft={p.anlegen.isPending}
          fehler={p.anlegen.error as ApiFehler | null}
          onAbsenden={p.absenden}
          onAbbrechen={p.abbrechen}
        />
      ) : (
        <>
          <p className="m-0 text-muted text-sm">{m.mailboxes_intro()}</p>
          {p.rueckmeldung && <RueckmeldungZeile rueckmeldung={p.rueckmeldung} zeile={p.erfolg} />}
          <Postfachliste
            quellen={p.liste.data}
            schreiben={schreiben}
            inhaber={inhaber}
            neuerAbruf={() => p.setRueckmeldung(null)}
            titel={titel}
          />
          {schreiben && (
            <button
              ref={p.einstieg}
              type="button"
              onClick={p.oeffnen}
              className="h-10 pointer-coarse:h-11 self-start rounded-md border border-border px-4 font-medium text-sm pointer-coarse:text-base hover:bg-subtle"
            >
              {m.mailboxes_create()}
            </button>
          )}
        </>
      )}
    </section>
  );
}
