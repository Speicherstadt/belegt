import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { PageHeader } from "../components/PageHeader.tsx";
import { BackupCodes, Passkeys } from "../components/SecondFactor.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";
const primaer = "h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60";
const knopf = "h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle";

/** QR-Code als SVG mit Ruhezone von vier Modulen; der Server liefert nur den Pfad der dunklen Module */
function QrCode({ groesse, pfad }: { groesse: number; pfad: string }) {
  return (
    <svg
      role="img"
      aria-label={m.account_totp_qr()}
      viewBox={`-4 -4 ${groesse + 8} ${groesse + 8}`}
      className="h-48 w-48 rounded-md bg-white"
      shapeRendering="crispEdges"
    >
      <path d={pfad} fill="#000" />
    </svg>
  );
}

/** TOTP einrichten: Passwort, QR-Code und Geheimnis, Bestätigung mit Code, danach die Backup-Codes */
function TotpEinrichten({ fertig }: { fertig: (codes: string[]) => void }) {
  const [angelegt, setAngelegt] = useState<{ uri: string; codes: string[]; qr: { groesse: number; pfad: string } }>();
  const anlegen = useMutation({
    mutationFn: async (passwort: string) => {
      const r = await api.totpAnlegen(passwort);
      return { uri: r.totpURI, codes: r.backupCodes, qr: await api.qr(r.totpURI) };
    },
    onSuccess: setAngelegt,
  });
  const bestaetigen = useMutation({
    mutationFn: (code: string) => api.totpPruefen(code),
    onSuccess: () => angelegt && fertig(angelegt.codes),
  });
  const fehler = anlegen.error ?? bestaetigen.error;
  const absenden = (e: FormEvent<HTMLFormElement>, wert: (f: FormData) => string, f: (w: string) => void) => {
    e.preventDefault();
    f(wert(new FormData(e.currentTarget)));
  };

  return (
    <div className="flex flex-col gap-3">
      {!angelegt ? (
        <form
          onSubmit={(e) => absenden(e, (f) => String(f.get("passwort")), anlegen.mutate)}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.account_password()}
            <input name="passwort" type="password" required autoComplete="current-password" className={feld} />
          </label>
          <button type="submit" disabled={anlegen.isPending} className={primaer}>
            {m.account_totp_start()}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => absenden(e, (f) => String(f.get("code")).replace(/\s/g, ""), bestaetigen.mutate)}
          className="flex flex-col gap-3"
        >
          <p className="m-0 text-sm">{m.account_totp_scan()}</p>
          <QrCode {...angelegt.qr} />
          <p className="m-0 text-muted text-sm">
            {m.account_totp_secret()}{" "}
            <code className="break-all" data-testid="totp-geheimnis">
              {new URL(angelegt.uri).searchParams.get("secret")}
            </code>
          </p>
          <label className="flex flex-col gap-1.5 self-start font-medium text-sm">
            {m.account_totp_code()}
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              className={feld}
            />
          </label>
          <button type="submit" disabled={bestaetigen.isPending} className={primaer}>
            {m.account_totp_confirm()}
          </button>
        </form>
      )}
      {fehler && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {fehler.message}
        </p>
      )}
    </div>
  );
}

/** Mit Passwort bestätigte Aktion an TOTP: neue Backup-Codes oder entfernen */
function TotpVerwalten({ neueCodes }: { neueCodes: (codes: string[]) => void }) {
  const queryClient = useQueryClient();
  const [aktion, setAktion] = useState<"codes" | "entfernen" | null>(null);
  const ausfuehren = useMutation({
    mutationFn: async (passwort: string) => {
      if (aktion === "codes") neueCodes((await api.backupCodesNeu(passwort)).backupCodes);
      else await api.totpEntfernen(passwort);
    },
    onSuccess: async () => {
      setAktion(null);
      await queryClient.invalidateQueries();
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm">{m.account_totp_active()}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setAktion("codes")} className={knopf} aria-expanded={aktion === "codes"}>
          {m.account_backup_new()}
        </button>
        <button
          type="button"
          onClick={() => setAktion("entfernen")}
          className={knopf}
          aria-expanded={aktion === "entfernen"}
        >
          {m.account_totp_remove()}
        </button>
      </div>
      {aktion && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ausfuehren.mutate(String(new FormData(e.currentTarget).get("passwort")));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.account_password()}
            <input name="passwort" type="password" required autoComplete="current-password" className={feld} />
          </label>
          <button type="submit" disabled={ausfuehren.isPending} className={primaer}>
            {aktion === "codes" ? m.account_backup_new() : m.account_totp_remove()}
          </button>
        </form>
      )}
      {ausfuehren.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {ausfuehren.error.message}
        </p>
      )}
    </div>
  );
}

/**
 * Konto: zweiter Faktor für die eigene Anmeldung, für jede Rolle. Gilt die Pflicht, landet hier jeder ohne zweiten
 * Faktor nach der Anmeldung (Shell), bis er eingerichtet ist.
 */
export function AccountPage() {
  const queryClient = useQueryClient();
  const konto = useQuery({ queryKey: ["konto"], queryFn: api.konto });
  const [codes, setCodes] = useState<string[] | null>(null);
  const k = konto.data;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title={m.account_title()} intro={m.account_intro()} />
      {k?.einrichten && (
        <p role="status" className="m-0 rounded-md border border-amber-600 bg-subtle p-3 text-sm">
          {m.account_required()}
        </p>
      )}
      <section aria-labelledby="konto-totp" className="flex flex-col gap-3">
        <h2 id="konto-totp" className="m-0 font-semibold text-base">
          {m.account_totp()}
        </h2>
        <p className="m-0 text-muted text-sm">{m.account_totp_intro()}</p>
        {k && !k.passwort && <p className="m-0 text-muted text-sm">{m.account_totp_no_password()}</p>}
        {codes && <BackupCodes codes={codes} schliessen={() => setCodes(null)} />}
        {k?.passwort && !codes && (k.totp ? <TotpVerwalten neueCodes={setCodes} /> : null)}
        {k?.passwort && !k.totp && !codes && (
          <TotpEinrichten
            fertig={async (neu) => {
              setCodes(neu);
              await queryClient.invalidateQueries();
            }}
          />
        )}
      </section>
      <section aria-labelledby="konto-passkeys" className="flex flex-col gap-3">
        <h2 id="konto-passkeys" className="m-0 font-semibold text-base">
          {m.account_passkeys()}
        </h2>
        <p className="m-0 text-muted text-sm">{m.account_passkeys_intro()}</p>
        {k && <Passkeys passkeys={k.passkeys} einrichten={k.einrichten} />}
      </section>
    </div>
  );
}
