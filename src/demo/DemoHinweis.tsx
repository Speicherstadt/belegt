import { m } from "../paraglide/messages.js";

/** Zeile über der Kopfleiste, nur in der Demo: was sie ist und wohin es zur echten App geht */
export function DemoHinweis() {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 border-border border-b bg-subtle px-4 py-2 text-sm sm:px-8 print:hidden">
      <span className="font-medium">{m.demo_title()}</span>
      <span className="text-muted">{m.demo_text()}</span>
      <a href="https://belegt.store/" className="ml-auto underline">
        {m.demo_install()}
      </a>
    </p>
  );
}
