import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

export const BACKUP_DOKU = "https://belegt.net/betrieb.html#sichern";

const fehler = "m-0 text-red-700 text-sm dark:text-red-400";

const ART = { backup: () => m.backup_kind_backup(), restore_check: () => m.backup_kind_check() };

/**
 * Stand der Sicherung aus dem Backup-Container (GET /api/betrieb): letztes Backup, letzter bestandener Test-Restore,
 * Fehler. Unter „Prüfung“ ausführlich, auf der Startseite knapp.
 */
export function BackupStatus({ knapp = false }: { knapp?: boolean }) {
  const stand = useQuery({ queryKey: ["betrieb"], queryFn: api.betrieb });
  const b = stand.data?.backup;
  if (stand.error) return <p className={fehler}>{stand.error.message}</p>;
  if (!b) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {b.zustand === "keins" && (
        <p className="m-0 text-muted">
          {m.backup_none()}{" "}
          <a href={BACKUP_DOKU} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {m.backup_setup()}
          </a>
        </p>
      )}
      {b.ueberfaellig && (
        <p role="alert" className={`${fehler} font-medium`}>
          {b.letztesBackup ? m.backup_overdue({ zeit: zeitpunkt(b.letztesBackup.am) }) : m.backup_never_ok()}
        </p>
      )}
      {b.fehlgeschlagen.map(({ art, lauf: l }) => (
        <p key={art} role="alert" className={`${fehler} break-words`}>
          {m.backup_failed({ was: ART[art](), zeit: zeitpunkt(l.am), meldung: l.meldung || "–" })}
        </p>
      ))}
      {b.zustand !== "keins" && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="text-muted">{m.backup_last()}</dt>
          <dd className="m-0">{b.letztesBackup ? zeitpunkt(b.letztesBackup.am) : "–"}</dd>
          <dt className="text-muted">{m.backup_last_check()}</dt>
          <dd className="m-0 break-words">
            {b.letzterTest
              ? knapp
                ? zeitpunkt(b.letzterTest.am)
                : `${zeitpunkt(b.letzterTest.am)} · ${b.letzterTest.meldung}`
              : m.backup_no_check()}
          </dd>
          {!knapp && b.letztesBackup?.ziel && (
            <>
              <dt className="text-muted">{m.backup_target()}</dt>
              <dd className="m-0 break-all font-mono text-xs">{b.letztesBackup.ziel}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
