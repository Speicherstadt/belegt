import { type ReactNode, useId, useState } from "react";
import { m } from "../paraglide/messages.js";

/** Glossar in der Dokumentation (docs/glossar.md); wie BACKUP_DOKU: die App liefert die Doku nicht selbst aus */
export const GLOSSARY = "https://belegt.net/glossar.html";

/** Fachbegriffe mit Name, Satz in einfacher Sprache und Anker im Glossar */
export const TERMS = {
  asn: { name: m.explain_term_asn, text: m.explain_asn, anchor: "asn" },
  seal: { name: m.explain_term_seal, text: m.explain_seal, anchor: "siegel" },
  chain: { name: m.explain_term_chain, text: m.explain_chain, anchor: "hash-kette" },
  hold: { name: m.explain_term_hold, text: m.explain_hold, anchor: "sperre" },
  kind: { name: m.explain_term_kind, text: m.explain_kind, anchor: "art" },
};

/**
 * Der Kreis um das „?“ nutzt `--muted` (hell 5,4:1, dunkel 7,7:1 gegen den Grund; `--border` hätte nur 1,3:1, WCAG 1.4.11).
 * „Was ist das?“ (DESIGN.md): Knopf neben dem Fachbegriff, der darunter einen Satz aufklappt. Kein Hover, kein Popover.
 * Knopf und Satz kommen getrennt, weil sie an verschiedenen Stellen der Zeile stehen (Begriff links, Satz über die Breite).
 */
export function Explain({
  term,
  row,
  children,
}: {
  term: keyof typeof TERMS;
  /** Satz als zweispaltige Zeile einer Definitionsliste (`dd`), sonst als `div` */
  row?: boolean;
  children: (knopf: ReactNode, satz: ReactNode) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const t = TERMS[term];
  const knopf = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      aria-label={m.explain_label({ begriff: t.name() })}
      onClick={() => setOpen(!open)}
      className="-my-2.5 -ml-1 inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-fg focus-visible:outline-offset-2"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-5 items-center justify-center rounded-full border border-muted text-xs"
      >
        ?
      </span>
    </button>
  );
  const inhalt = (
    <>
      {t.text()}{" "}
      <a
        href={`${GLOSSARY}#${t.anchor}`}
        target="_blank"
        rel="noreferrer"
        className="whitespace-nowrap underline underline-offset-2"
      >
        {m.explain_glossary()}
      </a>
    </>
  );
  const klasse = "m-0 max-w-prose text-base text-fg sm:text-sm";
  const satz = row ? (
    <dd id={id} hidden={!open} className={`col-span-2 ${klasse}`}>
      {inhalt}
    </dd>
  ) : (
    <div id={id} hidden={!open} className={klasse}>
      {inhalt}
    </div>
  );
  return children(knopf, satz);
}
