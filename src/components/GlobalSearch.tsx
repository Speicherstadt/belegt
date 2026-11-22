import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type ArchivAnsicht, ansichtZuParametern, LEERE_ANSICHT } from "../../shared/archivansicht.ts";
import { api } from "../lib/api.ts";
import { tag as tagText } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const HOECHSTENS = 5;
const passt = (name: string, text: string) => name.toLowerCase().includes(text.toLowerCase());

function Gruppe({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <li className="flex flex-col">
      <span className="px-3 pt-2 pb-1 font-medium text-muted text-xs">{titel}</span>
      <ul className="m-0 flex list-none flex-col p-0">{children}</ul>
    </li>
  );
}

const eintrag = "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-subtle";

/**
 * Suche in der Kopfzeile jeder Seite: schon beim Tippen Dokumente (Volltext) und passende Tags, Korrespondenten und
 * Dokumenttypen; ein Klick öffnet das Dokument oder das Archiv mit diesem Filter, Enter das Archiv mit der Suche.
 * „/“ springt hinein, Escape schließt
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [offen, setOffen] = useState(false);
  const feld = useRef<HTMLInputElement>(null);
  const rahmen = useRef<HTMLDivElement>(null);
  const suche = text.trim();
  const aktiv = offen && suche.length >= 2;
  const dokumente = useQuery({
    queryKey: ["schnellsuche", suche],
    queryFn: () => api.dokumente(suche, "alle", "", 1, 25),
    enabled: aktiv,
    staleTime: 10_000,
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags, enabled: aktiv });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten, enabled: aktiv });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen, enabled: aktiv });

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      const tippt = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !tippt && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        feld.current?.focus();
      }
    };
    const klick = (e: MouseEvent) => {
      if (!rahmen.current?.contains(e.target as Node)) setOffen(false);
    };
    window.addEventListener("keydown", taste);
    document.addEventListener("mousedown", klick);
    return () => {
      window.removeEventListener("keydown", taste);
      document.removeEventListener("mousedown", klick);
    };
  }, []);

  const fertig = () => {
    setOffen(false);
    setText("");
  };
  // Suchparameter des Archivs für eine Ansicht mit nur dieser Angabe
  const archiv = (teil: Partial<ArchivAnsicht>) => ansichtZuParametern({ ...LEERE_ANSICHT, ...teil });
  const treffer = {
    dokumente: (dokumente.data?.eintraege ?? []).slice(0, HOECHSTENS),
    tags: (tags.data ?? []).filter((t) => passt(t.name, suche)).slice(0, HOECHSTENS),
    korrespondenten: (korrespondenten.data ?? []).filter((k) => passt(k.name, suche)).slice(0, HOECHSTENS),
    typen: (typen.data ?? []).filter((t) => passt(t.name, suche)).slice(0, HOECHSTENS),
  };
  const nichts = !Object.values(treffer).some((l) => l.length) && !dokumente.isFetching;

  return (
    <div ref={rahmen} className="relative w-full max-w-xl">
      <search>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!suche) return;
            fertig();
            void navigate({ to: "/archiv", search: archiv({ suche }) });
          }}
        >
          <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm focus-within:border-fg">
            <span aria-hidden="true" className="text-muted">
              ⌕
            </span>
            <input
              ref={feld}
              type="search"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setOffen(true);
              }}
              onFocus={() => setOffen(true)}
              onKeyDown={(e) => e.key === "Escape" && setOffen(false)}
              aria-label={m.global_search()}
              placeholder={m.global_search_placeholder()}
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            <kbd className="hidden rounded border border-border px-1.5 text-muted text-xs sm:inline">/</kbd>
          </label>
        </form>
      </search>
      {aktiv && (
        <div className="absolute top-11 right-0 left-0 z-30 rounded-lg border border-border bg-bg p-1 shadow-lg">
          <ul
            aria-label={m.global_search_results()}
            className="m-0 flex max-h-[70vh] list-none flex-col overflow-y-auto p-0"
          >
            {!!treffer.dokumente.length && (
              <Gruppe titel={m.global_search_documents()}>
                {treffer.dokumente.map((d) => (
                  <li key={d.id}>
                    <Link to="/dokumente/$id" params={{ id: d.id }} onClick={fertig} className={eintrag}>
                      <span className="min-w-0 flex-1 truncate">{d.titel ?? d.dateiname ?? m.unnamed()}</span>
                      <span className="text-muted text-xs tabular-nums">{tagText(d.eingegangenAm)}</span>
                    </Link>
                  </li>
                ))}
              </Gruppe>
            )}
            {!!treffer.tags.length && (
              <Gruppe titel={m.filter_tags()}>
                {treffer.tags.map((t) => (
                  <li key={t.id}>
                    <Link to="/archiv" search={archiv({ tags: [t.id] })} onClick={fertig} className={eintrag}>
                      {t.name}
                    </Link>
                  </li>
                ))}
              </Gruppe>
            )}
            {!!treffer.korrespondenten.length && (
              <Gruppe titel={m.global_search_parties()}>
                {treffer.korrespondenten.map((k) => (
                  <li key={k.id}>
                    <Link to="/archiv" search={archiv({ korrespondent: k.id })} onClick={fertig} className={eintrag}>
                      {k.name}
                    </Link>
                  </li>
                ))}
              </Gruppe>
            )}
            {!!treffer.typen.length && (
              <Gruppe titel={m.global_search_doctypes()}>
                {treffer.typen.map((t) => (
                  <li key={t.id}>
                    <Link to="/archiv" search={archiv({ dokumenttyp: t.id })} onClick={fertig} className={eintrag}>
                      {t.name}
                    </Link>
                  </li>
                ))}
              </Gruppe>
            )}
            {nichts && <li className="px-3 py-2 text-muted text-sm">{m.global_search_none()}</li>}
            <li className="border-border border-t">
              <Link to="/archiv" search={archiv({ suche })} onClick={fertig} className={eintrag}>
                {m.global_search_all({ suche })}
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
