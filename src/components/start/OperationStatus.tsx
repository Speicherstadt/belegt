import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../lib/api.ts";
import { m } from "../../paraglide/messages.js";
import { BackupStatus } from "../BackupStatus.tsx";

const kachel = "flex flex-col gap-2 rounded-lg border border-border p-4";
const fehler = "m-0 text-red-700 text-sm dark:text-red-400";

/** Betrieb auf der Startseite (GET /api/betrieb): Rechte der Datenbankanmeldung und Stand der Sicherung */
export function OperationStatus({ inhaber = false }: { inhaber?: boolean }) {
  const stand = useQuery({ queryKey: ["betrieb"], queryFn: api.betrieb });
  // Ohne MAIL_SMTP_URL keine Benachrichtigungen; das sieht nur der Inhaber, der sie einstellt
  const mail = useQuery({ queryKey: ["benachrichtigungen"], queryFn: api.benachrichtigungen, enabled: inhaber });
  const db = stand.data?.datenbank;
  return (
    <section aria-labelledby="start-betrieb" className={kachel}>
      <h2 id="start-betrieb" className="m-0 font-semibold text-base">
        {m.start_operation()}
      </h2>
      {stand.error && <p className={fehler}>{stand.error.message}</p>}
      {db && (
        <p className={db.eingeschraenkt ? "m-0 text-sm" : `${fehler} font-medium`}>
          {db.eingeschraenkt ? m.start_db_ok() : m.start_db_warning()}
        </p>
      )}
      <BackupStatus knapp />
      {mail.data && !mail.data.eingerichtet && (
        <p className="m-0 text-sm">
          {m.start_mail_off()}{" "}
          <Link to="/benachrichtigungen" className="underline underline-offset-2">
            {m.start_mail_link()}
          </Link>
        </p>
      )}
      <Link to="/pruefung" className="text-sm underline underline-offset-2">
        {m.start_operation_link()}
      </Link>
    </section>
  );
}
