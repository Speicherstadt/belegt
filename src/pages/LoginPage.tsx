import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Anmelden; solange es keinen Zugang gibt, richtet dieselbe Seite den Inhaber ein */
export function LoginPage() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const einrichten = status.data?.eingerichtet === false;
  const titel = einrichten ? m.login_setup_title() : m.login_title();
  // Rückkehr vom OIDC-Anbieter mit Fehler: kein verbundenes Konto, abgelehnt, oder (still) keine Sitzung dort
  const anbieterFehler = new URLSearchParams(window.location.search).get("error");

  useEffect(() => {
    document.title = `${titel} · ${m.app_name()}`;
  }, [titel]);

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const passwort = String(form.get("passwort"));
    setFehler(null);
    setLaeuft(true);
    try {
      await (einrichten ? api.einrichten(email, passwort, String(form.get("code"))) : api.anmelden(email, passwort));
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    } catch (err) {
      setFehler(m.login_failed({ meldung: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLaeuft(false);
    }
  }

  if (!status.data) return <p className="p-8 text-muted text-sm">{m.loading()}</p>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg">
      <form onSubmit={absenden} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border p-6">
        <div className="flex flex-col gap-1">
          <span className="text-muted text-sm">{m.app_name()}</span>
          <h1 className="m-0 font-semibold text-2xl tracking-tight">{titel}</h1>
          {einrichten && <p className="m-0 text-muted text-sm">{m.login_setup_intro()}</p>}
        </div>
        {einrichten && (
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.login_setup_code()}
            <input
              name="code"
              required
              autoComplete="off"
              aria-describedby="code-hinweis"
              className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
            />
            <span id="code-hinweis" className="font-normal text-muted text-xs">
              {m.login_setup_code_hint()}
            </span>
          </label>
        )}
        {!einrichten && status.data.oidc && (
          <>
            <button
              type="button"
              onClick={() => void api.anmeldenMitAnbieter("/")}
              className="h-9 rounded-md border border-border font-medium text-sm hover:bg-subtle"
            >
              {m.oidc_sign_in({ name: status.data.oidc.name })}
            </button>
            <p className="m-0 flex items-center gap-3 text-muted text-xs">
              <span className="h-px flex-1 bg-border" />
              {m.oidc_or()}
              <span className="h-px flex-1 bg-border" />
            </p>
          </>
        )}
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.login_email()}
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.login_password()}
          <input
            name="passwort"
            type="password"
            required
            minLength={einrichten ? 12 : undefined}
            autoComplete={einrichten ? "new-password" : "current-password"}
            aria-describedby={einrichten ? "passwort-hinweis" : undefined}
            className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
          />
          {einrichten && (
            <span id="passwort-hinweis" className="font-normal text-muted text-xs">
              {m.login_password_hint()}
            </span>
          )}
        </label>
        {(fehler || (anbieterFehler && anbieterFehler !== "login_required")) && (
          <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
            {fehler ?? (anbieterFehler === "account_not_linked" ? m.oidc_not_linked() : m.oidc_failed())}
          </p>
        )}
        <button
          type="submit"
          disabled={laeuft}
          className="h-9 rounded-md bg-primary font-medium text-onprimary text-sm disabled:opacity-60"
        >
          {laeuft ? m.login_busy() : einrichten ? m.login_setup_submit() : m.login_submit()}
        </button>
      </form>
    </main>
  );
}
