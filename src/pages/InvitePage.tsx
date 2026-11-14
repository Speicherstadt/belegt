import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { rolleLabel } from "../lib/rollen.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Einladung annehmen: legt das Konto mit der Rolle der Einladung an */
export function InvitePage() {
  const { token } = useParams({ from: "/einladung/$token" });
  const einladung = useQuery({ queryKey: ["einladung", token], queryFn: () => api.einladung(token) });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${m.invite_title()} · ${m.app_name()}`;
  }, []);

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setFehler(null);
    try {
      await api.einladungAnnehmen(token, String(f.get("email")), String(f.get("passwort")));
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    } catch (err) {
      setFehler(m.login_failed({ meldung: err instanceof Error ? err.message : String(err) }));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border p-6">
        <div className="flex flex-col gap-1">
          <span className="text-muted text-sm">{m.app_name()}</span>
          <h1 className="m-0 font-semibold text-2xl tracking-tight">{m.invite_title()}</h1>
        </div>
        {einladung.isError && <p className="m-0 text-sm">{m.invite_invalid()}</p>}
        {einladung.data && (
          <form onSubmit={absenden} className="flex flex-col gap-4">
            <p className="m-0 text-muted text-sm">{m.invite_intro({ rolle: rolleLabel(einladung.data.rolle) })}</p>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.login_email()}
              <input name="email" type="email" required autoComplete="email" className={feld} />
            </label>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.login_password()}
              <input
                name="passwort"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                aria-describedby="hinweis"
                className={feld}
              />
              <span id="hinweis" className="font-normal text-muted text-xs">
                {m.login_password_hint()}
              </span>
            </label>
            {fehler && (
              <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
                {fehler}
              </p>
            )}
            <button type="submit" className="h-9 rounded-md bg-primary font-medium text-onprimary text-sm">
              {m.invite_submit()}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
