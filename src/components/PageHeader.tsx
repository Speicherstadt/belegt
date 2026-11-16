import { useEffect } from "react";
import { m } from "../paraglide/messages.js";

export function PageHeader({ title, intro }: { title: string; intro: string }) {
  // WCAG 2.4.2: Der Titel im Tab nennt die Seite, nicht nur die App
  useEffect(() => {
    document.title = `${title} · ${m.app_name()}`;
  }, [title]);
  return (
    <header className="flex flex-col gap-1">
      <h1 className="m-0 font-semibold text-2xl tracking-tight [overflow-wrap:anywhere]">{title}</h1>
      <p className="m-0 text-muted text-sm">{intro}</p>
    </header>
  );
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="flex flex-col items-center gap-2 rounded-lg border border-border px-6 py-12 text-center">
      <h2 className="m-0 font-medium text-base">{title}</h2>
      <p className="m-0 text-muted text-sm">{text}</p>
    </section>
  );
}
