import { useMutation } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Meldung, meldungKnopf } from "../components/Meldung.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-10 rounded-md border border-border bg-bg px-3 font-normal text-base sm:text-sm";
const PASSWORT_MIN = 12;
const PASSWORT_MAX = 128;

export function PasswordResetKarte({
  zustand,
  absenden,
  pending,
  details,
}: {
  zustand: "formular" | "fehler" | "erfolg";
  absenden: (passwort: string) => void;
  pending: boolean;
  details?: string;
}) {
  const id = useId();
  const karte = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLInputElement>(null);
  const [zuKurz, setZuKurz] = useState(false);

  // Nach dem Wechsel in Fehler oder Erfolg liest der Screenreader die neue Überschrift, nicht den Anfang der Seite
  useEffect(() => {
    if (zustand === "formular") return;
    const h1 = karte.current?.querySelector("h1");
    if (!h1) return;
    h1.tabIndex = -1;
    h1.focus();
  }, [zustand]);

  function pruefen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const passwort = String(new FormData(e.currentTarget).get("passwort") ?? "");
    const ok = passwort.length >= PASSWORT_MIN && passwort.length <= PASSWORT_MAX;
    setZuKurz(!ok);
    if (ok) absenden(passwort);
    else eingabe.current?.focus();
  }

  return (
    <div ref={karte} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border p-6">
      {zustand === "fehler" ? (
        <div role="alert">
          <Meldung was={m.pwreset_failed_title()} verloren={m.pwreset_failed_text()} details={details}>
            <Link to="/anmelden" className={meldungKnopf}>
              {m.pwreset_to_login()}
            </Link>
          </Meldung>
        </div>
      ) : zustand === "erfolg" ? (
        <div className="flex flex-col items-start gap-3">
          <h1 className="m-0 font-semibold text-2xl tracking-tight">{m.pwreset_done_title()}</h1>
          <p role="status" className="m-0 text-sm">
            {m.pwreset_done()}
          </p>
          <Link to="/anmelden" className={meldungKnopf}>
            {m.pwreset_to_login()}
          </Link>
        </div>
      ) : (
        <form onSubmit={pruefen} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-muted text-sm">{m.app_name()}</span>
            <h1 className="m-0 font-semibold text-2xl tracking-tight">{m.pwreset_title()}</h1>
          </div>
          <p className="m-0 text-muted text-sm">{m.pwreset_intro()}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-passwort`} className="font-medium text-sm">
              {m.login_password()}
            </label>
            <input
              ref={eingabe}
              id={`${id}-passwort`}
              name="passwort"
              type="password"
              autoComplete="new-password"
              aria-invalid={zuKurz}
              aria-describedby={zuKurz ? `${id}-hinweis ${id}-fehler` : `${id}-hinweis`}
              className={feld}
            />
            <p id={`${id}-hinweis`} className="m-0 text-muted text-sm">
              {m.login_password_hint()}
            </p>
            {zuKurz && (
              <p id={`${id}-fehler`} role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
                {m.pwreset_password_invalid()}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="h-10 rounded-md bg-primary font-medium text-base text-onprimary disabled:opacity-60 sm:text-sm"
          >
            {m.pwreset_submit()}
          </button>
        </form>
      )}
    </div>
  );
}

/** Neues Passwort mit dem Link des Inhabers setzen (öffentlich; der Link ist die Berechtigung) */
export function PasswordResetPage() {
  const { token } = useParams({ from: "/passwort/$token" });
  const setzen = useMutation({ mutationFn: (passwort: string) => api.passwortSetzen(token, passwort) });

  useEffect(() => {
    document.title = `${m.pwreset_title()} · ${m.app_name()}`;
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg">
      <PasswordResetKarte
        zustand={setzen.isError ? "fehler" : setzen.isSuccess ? "erfolg" : "formular"}
        details={setzen.error?.message}
        pending={setzen.isPending}
        absenden={(passwort) => setzen.mutate(passwort)}
      />
    </main>
  );
}
