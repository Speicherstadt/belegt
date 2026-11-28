import { ChevronRight, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";

export const POSTFACH_DOKU = "https://belegt.store/eingang.html#postfaecher";
export const OAUTH = { microsoft: "Microsoft 365", google: "Google" } as const;

/** Start der Anmeldung beim Anbieter; ein leerer Ordner entfällt, der Server nimmt dann INBOX */
export function oauthStart(anbieter: keyof typeof OAUTH, ordner: string): string {
  const o = ordner.trim();
  return `/api/oauth/${anbieter}/start?name=${encodeURIComponent(OAUTH[anbieter])}${o ? `&ordner=${encodeURIComponent(o)}` : ""}`;
}

export const feldKlasse =
  "h-10 pointer-coarse:h-11 w-full min-w-0 rounded-md border border-border bg-bg px-3 font-normal text-sm pointer-coarse:text-base placeholder:text-muted aria-invalid:border-danger disabled:opacity-50";
export const knopf =
  "inline-flex h-10 pointer-coarse:h-11 items-center justify-center rounded-md border border-border px-4 font-medium text-sm pointer-coarse:text-base hover:bg-subtle disabled:opacity-50";
export const ueberschrift = "m-0 font-semibold text-base";
export const satz = "m-0 max-w-xl text-muted text-sm";

export type FeldEigenschaften = {
  id: string;
  name: string;
  "aria-describedby": string;
  "aria-invalid"?: true;
  onChange: () => void;
};

/** Beschriftung oben, Feld, Hilfetext darunter; ist es das Feld des Fehlers, nennt es auch den Titel der Meldung */
export function Feld({
  name,
  label,
  hilfe,
  prefix,
  ungueltig,
  meldungId,
  geaendert,
  klasse,
  children,
}: {
  name: string;
  label: string;
  hilfe: string;
  prefix: string;
  ungueltig: string | null;
  meldungId: string;
  geaendert: () => void;
  klasse?: string;
  children: (p: FeldEigenschaften) => ReactNode;
}) {
  const id = `${prefix}-${name}`;
  const istUngueltig = ungueltig === name;
  return (
    <div className={`flex flex-col gap-2 ${klasse ?? ""}`}>
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      {children({
        id,
        name,
        "aria-describedby": istUngueltig ? `${id}-hilfe ${meldungId}` : `${id}-hilfe`,
        ...(istUngueltig ? { "aria-invalid": true as const } : {}),
        onChange: () => istUngueltig && geaendert(),
      })}
      <p id={`${id}-hilfe`} className="m-0 text-muted text-sm">
        {hilfe}
      </p>
    </div>
  );
}

export type FeldProps = {
  prefix: string;
  ungueltig: string | null;
  meldungId: string;
  geaendert: () => void;
};

/** Anmeldung beim Anbieter (OAuth): Knöpfe und der Ordner, der beim Verbinden gilt */
export function OauthBlock({ anbieter, prefix }: { anbieter: (keyof typeof OAUTH)[]; prefix: string }) {
  const feld = useRef<HTMLInputElement>(null);
  const [ordner, setOrdner] = useState("INBOX");
  const [aendern, setAendern] = useState(false);
  useEffect(() => {
    if (aendern) feld.current?.focus();
  }, [aendern]);
  return (
    <div className="flex flex-col gap-4">
      <h3 className={ueberschrift}>{m.mailboxes_oauth_title()}</h3>
      <p className={satz}>{m.mailboxes_oauth_hint()}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {anbieter.map((a) => (
          <a key={a} href={oauthStart(a, ordner)} className={`${knopf} w-full sm:w-auto`}>
            {m.oauth_connect({ anbieter: OAUTH[a] })}
          </a>
        ))}
      </div>
      {aendern ? (
        <div className="flex max-w-xl flex-col gap-2">
          <label htmlFor={`${prefix}-oauth-ordner`} className="font-medium text-sm">
            {m.mailboxes_folder()}
          </label>
          <input
            ref={feld}
            id={`${prefix}-oauth-ordner`}
            value={ordner}
            onChange={(e) => setOrdner(e.target.value)}
            aria-describedby={`${prefix}-oauth-ordner-hilfe`}
            className={feldKlasse}
          />
          <p id={`${prefix}-oauth-ordner-hilfe`} className="m-0 text-muted text-sm">
            {m.mailboxes_oauth_folder_help()}
          </p>
        </div>
      ) : (
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
          <span id={`${prefix}-oauth-ordner-wert`}>{m.mailboxes_oauth_folder({ ordner })}</span>
          <button
            type="button"
            onClick={() => setAendern(true)}
            aria-describedby={`${prefix}-oauth-ordner-wert`}
            className="inline-flex h-10 pointer-coarse:h-11 items-center rounded-sm px-1 font-medium text-sm underline hover:bg-subtle"
          >
            {m.mailboxes_edit()}
          </button>
        </p>
      )}
    </div>
  );
}

/** Die fünf Pflichtfelder */
export function Grunddaten({ feldProps }: { feldProps: FeldProps }) {
  return (
    <>
      <Feld {...feldProps} name="name" label={m.mailboxes_name()} hilfe={m.mailboxes_name_help()}>
        {(p) => (
          <input
            {...p}
            required
            maxLength={200}
            autoComplete="off"
            placeholder={m.mailboxes_name_ph()}
            className={feldKlasse}
          />
        )}
      </Feld>
      <Feld {...feldProps} name="host" label={m.mailboxes_host()} hilfe={m.mailboxes_host_help()}>
        {(p) => (
          <input
            {...p}
            required
            maxLength={253}
            autoComplete="off"
            inputMode="url"
            placeholder={m.mailboxes_host_ph()}
            className={feldKlasse}
          />
        )}
      </Feld>
      <Feld {...feldProps} name="benutzer" label={m.mailboxes_user()} hilfe={m.mailboxes_user_help()}>
        {(p) => (
          <input
            {...p}
            required
            maxLength={320}
            autoComplete="off"
            placeholder={m.mailboxes_user_ph()}
            className={feldKlasse}
          />
        )}
      </Feld>
      <Feld {...feldProps} name="passwort" label={m.mailboxes_password()} hilfe={m.mailboxes_password_help()}>
        {(p) => (
          <input {...p} type="password" required maxLength={1000} autoComplete="new-password" className={feldKlasse} />
        )}
      </Feld>
      <Feld {...feldProps} name="ordner" label={m.mailboxes_folder()} hilfe={m.mailboxes_folder_help()}>
        {(p) => <input {...p} required maxLength={200} defaultValue="INBOX" className={feldKlasse} />}
      </Feld>
    </>
  );
}

/** „Erweitert“: Art, Port, TLS */
export function Erweitert({
  feldProps,
  prefix,
  art,
  setArt,
  offen,
  setOffen,
}: {
  feldProps: FeldProps;
  prefix: string;
  art: "imap" | "jmap";
  setArt: (a: "imap" | "jmap") => void;
  offen: boolean;
  setOffen: (o: boolean) => void;
}) {
  return (
    <details open={offen} onToggle={(e) => setOffen(e.currentTarget.open)} className="group md:col-span-2">
      <summary className="inline-flex h-10 pointer-coarse:h-11 cursor-pointer items-center gap-2 font-medium text-sm">
        <ChevronRight className="size-4 group-open:rotate-90" aria-hidden="true" />
        {m.mailboxes_advanced()}
      </summary>
      <div className="mt-2 grid gap-4 border-border border-t pt-4 md:grid-cols-2">
        <Feld {...feldProps} name="art" label={m.mailboxes_kind()} hilfe={m.mailboxes_kind_help()}>
          {(p) => (
            <select
              {...p}
              value={art}
              onChange={(e) => {
                p.onChange();
                setArt(e.target.value as typeof art);
              }}
              className={feldKlasse}
            >
              {/* i18n-ignore: Protokollnamen */}
              <option value="imap">IMAP</option>
              {/* i18n-ignore: Protokollnamen */}
              <option value="jmap">JMAP</option>
            </select>
          )}
        </Feld>
        <Feld {...feldProps} name="port" label={m.mailboxes_port()} hilfe={m.mailboxes_port_help()}>
          {(p) => (
            <input
              {...p}
              key={art}
              type="number"
              inputMode="numeric"
              required
              min={1}
              max={65535}
              defaultValue={art === "jmap" ? 443 : 993}
              className={feldKlasse}
            />
          )}
        </Feld>
        <div className="flex flex-col gap-2 md:col-span-2">
          <label className="flex h-10 pointer-coarse:h-11 items-center gap-2 font-medium text-sm">
            <input
              name="tls"
              type="checkbox"
              defaultChecked
              aria-describedby={`${prefix}-tls-hilfe`}
              className="size-5"
            />
            {m.mailboxes_tls()}
          </label>
          <p id={`${prefix}-tls-hilfe`} className="m-0 text-muted text-sm">
            {m.mailboxes_tls_help()}
          </p>
        </div>
      </div>
    </details>
  );
}

/** Statuszeile, „Abbrechen“ und „Postfach anlegen“ */
export function Knopfzeile({
  laeuft,
  statusId,
  onAbbrechen,
}: {
  laeuft: boolean;
  statusId: string;
  onAbbrechen: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-end">
      {laeuft && (
        <p id={statusId} role="status" className="m-0 text-muted text-sm md:mr-auto">
          {m.mailboxes_checking()}
        </p>
      )}
      <button
        type="button"
        onClick={onAbbrechen}
        disabled={laeuft}
        aria-describedby={laeuft ? statusId : undefined}
        className={`${knopf} w-full md:w-auto`}
      >
        {m.form_cancel()}
      </button>
      <button
        type="submit"
        aria-busy={laeuft}
        className="inline-flex h-10 pointer-coarse:h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 font-medium text-onprimary text-sm pointer-coarse:text-base md:w-auto"
      >
        {laeuft ? (
          <>
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {m.mailboxes_busy()}
          </>
        ) : (
          m.mailboxes_submit()
        )}
      </button>
    </div>
  );
}
