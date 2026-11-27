import type { Ref } from "react";
import type { ApiFehler } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { knopf } from "./MailboxAnlegenTeile.tsx";
import { Meldung } from "./Meldung.tsx";

/** Woran das Anlegen scheiterte: ein Grund der Prüfung (422), die Eingabe (400), der Server (sonstiger Status) */
export type Art = NonNullable<ApiFehler["grund"]> | "eingabe" | "gesperrt";

/** Ohne Status (Netz) gilt „unbekannt“: erneut versuchen hilft dort */
export function artVon(f: ApiFehler): Art {
  return f.grund ?? (f.status === 400 ? "eingabe" : f.status ? "gesperrt" : "unbekannt");
}

/** Das Feld, auf das der Fehler zeigt (`aria-invalid`); bei Zeit, unbekannt und gesperrt gibt es keins */
export function feldVon(f: ApiFehler): string | null {
  const art = artVon(f);
  return art === "eingabe"
    ? (f.feld ?? null)
    : (({ anmeldung: "passwort", server: "host", ordner: "ordner" } as Record<string, string>)[art] ?? null);
}

const FELDNAME: Record<string, () => string> = {
  name: m.mailboxes_name,
  host: m.mailboxes_host,
  port: m.mailboxes_port,
  benutzer: m.mailboxes_user,
  passwort: m.mailboxes_password,
  ordner: m.mailboxes_folder,
  art: m.mailboxes_kind,
  tls: m.mailboxes_tls,
};

const texte = (f: ApiFehler) => {
  const art = artVon(f);
  const feldname = FELDNAME[f.feld ?? ""];
  if (art === "eingabe")
    return {
      was: m.mailboxes_err_eingabe_title(),
      // Ein Feld, das die Oberfläche nicht kennt, bekommt keinen internen Schlüssel in den Satz
      warum: feldname ? m.mailboxes_err_eingabe_why({ feld: feldname() }) : m.mailboxes_err_eingabe_why_ohne_feld(),
      tun: m.mailboxes_err_eingabe_do(),
      knopf: m.mailboxes_err_eingabe_action(),
    };
  if (art === "gesperrt")
    return {
      was: m.mailboxes_err_gesperrt_title(),
      warum: m.mailboxes_err_gesperrt_why(),
      tun: m.mailboxes_err_gesperrt_do(),
      knopf: null,
    };
  return {
    anmeldung: {
      was: m.mailboxes_err_anmeldung_title(),
      warum: m.mailboxes_err_anmeldung_why(),
      tun: m.mailboxes_err_anmeldung_do(),
      knopf: m.mailboxes_err_anmeldung_action(),
    },
    server: {
      was: m.mailboxes_err_server_title(),
      warum: m.mailboxes_err_server_why(),
      tun: m.mailboxes_err_server_do(),
      knopf: m.mailboxes_err_server_action(),
    },
    ordner: {
      was: m.mailboxes_err_ordner_title(),
      warum: m.mailboxes_err_ordner_why(),
      tun: m.mailboxes_err_ordner_do(),
      knopf: m.mailboxes_err_ordner_action(),
    },
    zeit: {
      was: m.mailboxes_err_zeit_title(),
      warum: m.mailboxes_err_zeit_why(),
      tun: m.mailboxes_err_zeit_do(),
      knopf: m.offline_retry(),
    },
    unbekannt: {
      was: m.mailboxes_err_unbekannt_title(),
      warum: m.mailboxes_err_unbekannt_why(),
      tun: m.mailboxes_err_unbekannt_do(),
      knopf: m.offline_retry(),
    },
  }[art];
};

/** Die Meldung beim Anlegen in drei Teilen; der Knopf führt ins betroffene Feld, bei „gesperrt“ gibt es keinen */
export function PruefMeldung({
  fehler,
  meldungId,
  huelle,
  beheben,
}: {
  fehler: ApiFehler;
  meldungId: string;
  huelle: Ref<HTMLDivElement>;
  beheben: () => void;
}) {
  const t = texte(fehler);
  return (
    <Meldung
      eingebettet
      titelId={meldungId}
      huelle={huelle}
      was={t.was}
      verloren={`${t.warum} ${m.mailboxes_err_kept()}`}
      details={fehler.details ?? fehler.message}
    >
      <p className="m-0">{t.tun}</p>
      {t.knopf && (
        <button type="button" onClick={beheben} className={`${knopf} bg-bg`}>
          {t.knopf}
        </button>
      )}
    </Meldung>
  );
}
