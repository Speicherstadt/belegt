import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { ApiFehler, api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import {
  Erweitert,
  Grunddaten,
  Knopfzeile,
  type OAUTH,
  OauthBlock,
  POSTFACH_DOKU,
  satz,
  ueberschrift,
} from "./MailboxAnlegenTeile.tsx";
import { artVon, feldVon, PruefMeldung } from "./MailboxPruefMeldung.tsx";

export type PostfachEingabe = Parameters<typeof api.quelleAnlegen>[0];

/** Die Eingaben aus dem Formular, synchron gelesen: gleich danach sind die Felder gesperrt */
function eingabeAus(form: HTMLFormElement, art: PostfachEingabe["art"]): PostfachEingabe {
  const f = new FormData(form);
  return {
    name: String(f.get("name")),
    host: String(f.get("host")),
    port: Number(f.get("port")),
    tls: f.get("tls") === "on",
    benutzer: String(f.get("benutzer")),
    passwort: String(f.get("passwort")),
    ordner: String(f.get("ordner")),
    art,
  };
}

function zumFeld(form: HTMLFormElement | null, name: string, markieren: boolean) {
  const el = form?.elements.namedItem(name);
  if (!(el instanceof HTMLInputElement)) return;
  el.focus();
  if (markieren) el.select();
}

/**
 * Postfach hinzufügen: ersetzt in der Karte „Postfächer“ den Inhalt (DESIGN.md „Anlegen in einer Karte“). Die Karte
 * prüft beim Absenden die Verbindung und speichert nur bei Erfolg; bei Fehler steht hier die Meldung, und alle Eingaben
 * bleiben stehen (die Felder sind nicht gesteuert und werden nie ersetzt).
 */
export function MailboxAnlegen({
  anbieter,
  laeuft,
  fehler,
  onAbsenden,
  onAbbrechen,
}: {
  anbieter: (keyof typeof OAUTH)[];
  laeuft: boolean;
  fehler: ApiFehler | null;
  onAbsenden: (eingabe: PostfachEingabe) => void;
  onAbbrechen: () => void;
}) {
  const prefix = useId();
  const meldungId = `${prefix}-meldung`;
  const titel = useRef<HTMLHeadingElement>(null);
  const meldung = useRef<HTMLDivElement>(null);
  const formular = useRef<HTMLFormElement>(null);
  const [art, setArt] = useState<PostfachEingabe["art"]>("imap");
  const [erweitert, setErweitert] = useState(false);
  // Der Fehler, dessen Feld der Nutzer schon geändert hat: dann fällt `aria-invalid`
  const [bereinigt, setBereinigt] = useState<ApiFehler | null>(null);

  const fall = fehler ? artVon(fehler) : null;
  const ungueltig = fehler && fehler !== bereinigt ? feldVon(fehler) : null;
  const feldProps = { prefix, ungueltig, meldungId, geaendert: () => setBereinigt(fehler) };

  useEffect(() => titel.current?.focus(), []);
  useEffect(() => {
    if (fehler) meldung.current?.focus();
  }, [fehler]);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!laeuft) onAbsenden(eingabeAus(e.currentTarget, art));
  }

  function beheben() {
    if (fall === "server" || ungueltig === "port") setErweitert(true);
    if (ungueltig) zumFeld(formular.current, ungueltig, fall !== "server");
    else formular.current?.requestSubmit();
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 ref={titel} tabIndex={-1} className={ueberschrift}>
        {m.mailboxes_add_title()}
      </h3>
      <p className={satz}>
        {m.mailboxes_lede()}{" "}
        <a href={POSTFACH_DOKU} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center underline">
          {m.mailboxes_docs()}
        </a>
      </p>
      {anbieter.length > 0 && <OauthBlock anbieter={anbieter} prefix={prefix} />}
      <div className={anbieter.length > 0 ? "mt-2 flex flex-col gap-4 border-border border-t pt-6" : "contents"}>
        {anbieter.length > 0 && <h3 className={ueberschrift}>{m.mailboxes_creds_title()}</h3>}
        <form ref={formular} onSubmit={absenden} className="grid max-w-xl gap-4 md:grid-cols-2">
          {fehler && <PruefMeldung fehler={fehler} meldungId={meldungId} huelle={meldung} beheben={beheben} />}
          <fieldset disabled={laeuft} className="m-0 grid min-w-0 gap-4 border-0 p-0 md:col-span-2 md:grid-cols-2">
            <Grunddaten feldProps={feldProps} />
            <Erweitert
              feldProps={feldProps}
              prefix={prefix}
              art={art}
              setArt={setArt}
              offen={erweitert}
              setOffen={setErweitert}
            />
          </fieldset>
          <Knopfzeile laeuft={laeuft} statusId={`${prefix}-status`} onAbbrechen={onAbbrechen} />
        </form>
      </div>
    </div>
  );
}
