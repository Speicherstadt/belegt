import { m } from "../paraglide/messages.js";

export function Inbox() {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">{m.inbox_title()}</h1>
        <p className="m-0 text-sm text-muted">{m.inbox_intro()}</p>
      </header>
      <section className="flex flex-col items-center gap-2 rounded-lg border border-border px-6 py-12 text-center">
        <h2 className="m-0 text-base font-medium">{m.inbox_empty_title()}</h2>
        <p className="m-0 text-sm text-muted">{m.inbox_empty_text()}</p>
      </section>
    </div>
  );
}
