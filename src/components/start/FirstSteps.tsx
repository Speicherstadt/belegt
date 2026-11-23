import { m } from "../../paraglide/messages.js";

/**
 * Erste Schritte für ein leeres Archiv (nur der Inhaber): hochladen, Postfach verbinden, aus Paperless-ngx übernehmen und
 * als App installieren. Wer wechselt, findet den Umzug so gleich vorne. Einfache Links: die Seite gibt es nur einmal
 */
export function FirstSteps() {
  const schritte = [
    { titel: m.first_upload(), text: m.first_upload_text(), href: "/eingang" },
    { titel: m.first_mailbox(), text: m.first_mailbox_text(), href: "/quellen" },
    { titel: m.first_paperless(), text: m.first_paperless_text(), href: "/quellen?bereich=umzug" },
    { titel: m.first_app(), text: m.first_app_text(), href: "/eingang#unterwegs" },
  ];
  return (
    <section aria-labelledby="erste-schritte" className="flex flex-col gap-3 rounded-lg border border-primary/40 p-4">
      <h2 id="erste-schritte" className="m-0 font-semibold text-lg">
        {m.first_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.first_intro()}</p>
      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {schritte.map((s, i) => (
          <li key={s.titel}>
            <a href={s.href} className="flex h-full gap-3 rounded-md border border-border p-3 text-sm hover:bg-subtle">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-onprimary text-xs"
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-medium">{s.titel}</span>
                <span className="text-muted">{s.text}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
