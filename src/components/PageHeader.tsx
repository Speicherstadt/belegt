import { type ReactNode, useEffect } from "react";
import { m } from "../paraglide/messages.js";
import { InKopfzeile } from "./Kopfzeile.tsx";
import { LeerSymbol } from "./Symbole.tsx";

export function PageHeader({
  title,
  intro,
  versteckt = false,
}: {
  title: string;
  intro?: string;
  /** Nur für Screenreader und den Titel im Tab, etwa auf der Startseite, deren Inhalt für sich spricht */
  versteckt?: boolean;
}) {
  // WCAG 2.4.2: Der Titel im Tab nennt die Seite, nicht nur die App
  useEffect(() => {
    document.title = `${title} · ${m.app_name()}`;
  }, [title]);
  if (versteckt) return <h1 className="sr-only">{title}</h1>;
  // Der Titel steht oben in der Kopfleiste, auf einer Linie mit Logo, Suche und Glocke (DESIGN.md, Kopfleiste); die
  // Erklärung klein am Anfang des Inhalts
  return (
    <>
      <InKopfzeile>
        <h1 className="m-0 truncate font-semibold text-lg tracking-tight">{title}</h1>
      </InKopfzeile>
      {intro && <p className="m-0 text-muted text-sm">{intro}</p>}
    </>
  );
}

export function EmptyState({
  title,
  text,
  children,
  bereich,
}: {
  title: string;
  text: string;
  children?: ReactNode;
  /** Bereich der App (Pfad), dessen Symbol über dem Titel steht */
  bereich?: string;
}) {
  return (
    <section className="flex flex-col items-center gap-2 rounded-lg border border-border px-6 py-12 text-center">
      {bereich && <LeerSymbol bereich={bereich} />}
      <h2 className="m-0 font-medium text-base [overflow-wrap:anywhere]">{title}</h2>
      <p className="m-0 text-muted text-sm">{text}</p>
      {children}
    </section>
  );
}
