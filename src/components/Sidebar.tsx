import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ansichtAus, ansichtSuche } from "../../shared/archivansicht.ts";
import { useAnsichtTreffer } from "../lib/ansichtTreffer.ts";
import { api, type GespeicherteAnsicht, type Ich } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { Darstellung } from "./Darstellung.tsx";
import { BereichSymbol } from "./Symbole.tsx";

/** Die Seitenleiste in drei Gruppen; die Rollen sehen davon nur, was NUR und INHABER ihnen lassen */
const GRUPPEN = [
  {
    id: "dokumente",
    name: () => m.nav_group_documents(),
    items: [
      { to: "/", label: () => m.nav_start() },
      { to: "/eingang", label: () => m.nav_inbox() },
      { to: "/archiv", label: () => m.nav_archive() },
    ],
  },
  {
    id: "ordnen",
    name: () => m.nav_group_organize(),
    items: [
      { to: "/ordnung", label: () => m.nav_order() },
      { to: "/fristen", label: () => m.nav_retention() },
      { to: "/pruefung", label: () => m.nav_audit() },
    ],
  },
  {
    id: "einrichten",
    name: () => m.nav_group_setup(),
    items: [
      { to: "/quellen", label: () => m.nav_sources() },
      { to: "/workflows", label: () => m.nav_workflows() },
      { to: "/verfahrensdoku", label: () => m.nav_procedure() },
      { to: "/zugaenge", label: () => m.nav_access() },
      { to: "/benachrichtigungen", label: () => m.nav_notifications() },
    ],
  },
] as const;

const eintrag =
  "flex min-h-(--control-h) items-center gap-3 rounded-md px-3 py-2 text-muted text-sm hover:bg-subtle aria-[current=page]:bg-subtle aria-[current=page]:font-semibold aria-[current=page]:text-fg";

/**
 * Zahl der offenen Dokumente im Eingang: die Gesamtzahl der Liste „offen“ (dasselbe wie `start.eingang`). Der Schlüssel
 * beginnt mit „dokumente“, daher aktualisiert jede Invalidierung der Listen sie mit. Bei 0 oder ohne Daten nichts;
 * `aktiv` aus, solange der zweite Faktor einzurichten ist (der Server lehnt dann die Listen ab).
 */
function OffenImEingang({ aktiv }: { aktiv: boolean }) {
  const eingang = useQuery({
    queryKey: ["dokumente", "", "offen", "", 1, 1, "neu"],
    queryFn: () => api.dokumente("", "offen", "", 1, 1, "neu"),
    enabled: aktiv,
  });
  const offen = eingang.data?.gesamt;
  if (!offen) return null;
  return (
    <span className="ml-auto rounded-md bg-primary px-2 text-onprimary text-xs tabular-nums">
      <span aria-hidden="true">{offen}</span>
      <span className="sr-only">{m.nav_inbox_open({ anzahl: String(offen) })}</span>
    </span>
  );
}

/** Zahl der Treffer einer gespeicherten Ansicht, aus derselben Abfrage wie die Kachel auf der Startseite */
function Anzahl({ ansicht }: { ansicht: GespeicherteAnsicht }) {
  const treffer = useAnsichtTreffer(ansicht);
  if (!treffer.data) return null;
  return (
    <span className="ml-2 text-muted text-xs tabular-nums">
      <span className="sr-only">{m.views_nav_count()} </span>
      {treffer.data.gesamt}
    </span>
  );
}

/**
 * Der Prüfer sieht nur, was er für die Prüfung braucht, der Mitarbeiter nur die Dokumente seines Sichtbereichs; die
 * übrigen Schnittstellen lehnt der Server für beide ab
 */
const NUR: Partial<Record<Ich["role"], Set<string>>> = {
  pruefer: new Set(["/", "/eingang", "/archiv", "/pruefung"]),
  mitarbeiter: new Set(["/", "/eingang", "/archiv"]),
};
/** Zugänge und Benachrichtigungen sind nur für den Inhaber */
const NUR_INHABER = new Set(["/zugaenge", "/benachrichtigungen"]);

export function Sidebar({
  ich,
  eingebettet = false,
  oidc = null,
  version,
  offen = false,
  onNavigiert,
}: {
  ich: Ich;
  /** Am Handy: ob das Menü aufgeklappt ist; ab lg steht die Leiste immer da */
  offen?: boolean;
  /** Ein Link in der Leiste wurde geklickt; am Handy klappt die Shell das Menü dann zu */
  onNavigiert?: () => void;
  /** Im Frame einer anderen Seite: ohne Namen und Konto, die zeigt die einbettende Seite */
  eingebettet?: boolean;
  oidc?: { name: string } | null;
  version?: string;
}) {
  const ansichten = useQuery({ queryKey: ["ansichten"], queryFn: api.ansichten });
  const ort = useLocation();
  // Jeder Seitenwechsel, auch Zurück und Vor, klappt das Menü zu (der Klick auf einen Link allein deckt ihn nicht ab)
  // biome-ignore lint/correctness/useExhaustiveDependencies: der Pfad ist der Auslöser
  useEffect(() => onNavigiert?.(), [ort.pathname]);
  // Die gespeicherte Ansicht, deren Filter das Archiv gerade zeigt; dann ist sie markiert und nicht „Archiv“
  const offeneAnsicht =
    ort.pathname === "/archiv"
      ? ansichten.data?.find(
          (a) =>
            ansichtSuche(ansichtAus(a.parameter)) === ansichtSuche(ansichtAus(ort.search as Record<string, string>)),
        )
      : undefined;
  const konten = useQuery({ queryKey: ["konten"], queryFn: api.konten, enabled: !!oidc && !eingebettet });
  const verbunden = konten.data?.some((k) => k.providerId === "oidc");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function abmelden() {
    await api.abmelden();
    queryClient.clear();
    await navigate({ to: "/anmelden" });
  }
  return (
    <aside
      id="seitenleiste"
      onClickCapture={(e) => {
        if (e.target instanceof Element && e.target.closest("a")) onNavigiert?.();
      }}
      className={`${offen ? "fixed top-14 bottom-0 left-0 z-40 flex w-64 max-w-full overflow-y-auto shadow-(--shadow-float) lg:z-auto lg:shadow-none" : "hidden"} print:hidden flex-col gap-6 border-border border-r bg-side px-3 py-4 lg:sticky lg:top-0 lg:bottom-auto lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:overflow-y-auto`}
    >
      {!eingebettet && (
        <div className="hidden flex-col px-3 lg:flex">
          <span className="font-semibold text-base">{m.app_name()}</span>
          <span className="text-muted text-xs">{m.app_claim()}</span>
        </div>
      )}
      <nav aria-label={m.nav_label()} className="flex flex-col gap-6">
        {GRUPPEN.map((gruppe) => {
          const items = gruppe.items.filter(
            (item) => (NUR[ich.role]?.has(item.to) ?? true) && (ich.role === "inhaber" || !NUR_INHABER.has(item.to)),
          );
          if (!items.length) return null;
          return (
            <div key={gruppe.id} className="flex flex-col gap-1">
              <p id={`nav-${gruppe.id}`} className="m-0 px-3 font-medium text-muted text-xs">
                {gruppe.name()}
              </p>
              <ul aria-labelledby={`nav-${gruppe.id}`} className="m-0 flex list-none flex-col gap-1 p-0">
                {items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      // Zeigt das Archiv eine gespeicherte Ansicht, ist sie markiert und nicht „Archiv“
                      activeOptions={{ exact: true, includeSearch: item.to === "/archiv" && !!offeneAnsicht }}
                      className={eintrag}
                    >
                      <BereichSymbol bereich={item.to} />
                      <span className="min-w-0">{item.label()}</span>
                      {item.to === "/eingang" && <OffenImEingang aktiv={!ich.zweiFaktorEinrichten} />}
                    </Link>
                    {item.to === "/archiv" && !!ansichten.data?.length && (
                      <ul aria-label={m.views_nav_label()} className="m-0 mt-1 flex list-none flex-col gap-1 p-0 pl-3">
                        {ansichten.data.map((a) => (
                          <li key={a.id}>
                            <Link
                              to="/archiv"
                              search={a.parameter}
                              activeOptions={{ exact: true, includeSearch: true }}
                              className={eintrag}
                            >
                              <span title={a.name} className="min-w-0 flex-1 truncate">
                                {a.name}
                              </span>
                              <Anzahl ansicht={a} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      {!eingebettet && (
        <div className="mt-auto flex flex-col gap-2 px-2 text-sm">
          <Darstellung />
          <span className="truncate text-muted">{ich.email}</span>
          <Link
            to="/konto"
            className="flex h-(--control-h) items-center self-start rounded-md border border-border px-3 font-medium hover:bg-subtle aria-[current=page]:bg-subtle"
          >
            {m.nav_account()}
          </Link>
          {oidc && konten.data && !verbunden && (
            <button
              type="button"
              onClick={() => void api.verbindenMitAnbieter()}
              className="h-(--control-h) self-start rounded-md border border-border px-3 font-medium hover:bg-subtle"
            >
              {m.oidc_link({ name: oidc.name })}
            </button>
          )}
          <button
            type="button"
            onClick={abmelden}
            className="h-(--control-h) self-start rounded-md border border-border px-3 font-medium hover:bg-subtle"
          >
            {m.logout()}
          </button>
          {version && <span className="text-muted text-xs">{m.version({ version })}</span>}
        </div>
      )}
    </aside>
  );
}
