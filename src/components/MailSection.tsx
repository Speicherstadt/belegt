import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/** Kopf, Text, Anhänge und Unterhaltung einer Mail; bei einem Anhang der Verweis auf seine Mail */
export function MailSection({ dokumentId }: { dokumentId: string }) {
  const mail = useQuery({ queryKey: ["mail", dokumentId], queryFn: () => api.mail(dokumentId) });
  const d = mail.data;
  if (!d) return null;
  if (d.ausMail) {
    return (
      <p className="m-0 text-sm">
        {m.mail_from_mail()}:{" "}
        <Link to="/dokumente/$id" params={{ id: d.ausMail }} className="font-medium underline underline-offset-2">
          {d.betreff || m.mail_no_subject()}
        </Link>
      </p>
    );
  }
  return (
    <section aria-labelledby="mail" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="mail" className="m-0 font-semibold text-base">
        {m.mail_title()}
      </h2>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">{m.mail_from()}</dt>
        <dd className="m-0 break-all">{d.von ?? "–"}</dd>
        <dt className="text-muted">{m.mail_to()}</dt>
        <dd className="m-0 break-all">{d.an.join(", ") || "–"}</dd>
        <dt className="text-muted">{m.mail_subject()}</dt>
        <dd className="m-0">{d.betreff || m.mail_no_subject()}</dd>
        <dt className="text-muted">{m.mail_sent()}</dt>
        <dd className="m-0">{d.gesendetAm ? zeitpunkt(d.gesendetAm) : "–"}</dd>
      </dl>
      {d.text && (
        <p className="m-0 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-subtle p-3 text-sm">{d.text}</p>
      )}
      {d.anhaenge.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-medium text-sm">{m.mail_attachments()}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {d.anhaenge.map((a) => (
              <li key={a.dokumentId}>
                <Link to="/dokumente/$id" params={{ id: a.dokumentId }} className="underline underline-offset-2">
                  {a.dateiname ?? m.unnamed()}
                </Link>{" "}
                <span className="text-muted">{a.mimeType}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.unterhaltung.length > 1 && (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-medium text-sm">{m.mail_thread()}</h3>
          <ol className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {d.unterhaltung.map((u) => (
              <li key={u.dokumentId}>
                {u.dokumentId === dokumentId ? (
                  <span className="font-medium">{u.betreff || m.mail_no_subject()}</span>
                ) : (
                  <Link to="/dokumente/$id" params={{ id: u.dokumentId }} className="underline underline-offset-2">
                    {u.betreff || m.mail_no_subject()}
                  </Link>
                )}{" "}
                <span className="text-muted">
                  {u.von ?? "–"}
                  {u.gesendetAm ? ` · ${zeitpunkt(u.gesendetAm)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
