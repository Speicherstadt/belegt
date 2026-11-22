import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ansichtAus, ansichtSuche } from "../../shared/archivansicht.ts";
import { useAnsichtTreffer } from "../lib/ansichtTreffer.ts";
import { api, type GespeicherteAnsicht, type Ich } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { Darstellung } from "./Darstellung.tsx";

const ITEMS = [
  { to: "/", label: () => m.nav_start() },
  { to: "/eingang", label: () => m.nav_inbox() },
  { to: "/archiv", label: () => m.nav_archive() },
  { to: "/ordnung", label: () => m.nav_order() },
  { to: "/fristen", label: () => m.nav_retention() },
  { to: "/pruefung", label: () => m.nav_audit() },
  { to: "/quellen", label: () => m.nav_sources() },
  { to: "/workflows", label: () => m.nav_workflows() },
  { to: "/verfahrensdoku", label: () => m.nav_procedure() },
] as const;

const eintrag =
  "flex h-9 items-center rounded-md px-2.5 text-fg/80 text-sm hover:bg-subtle aria-[current=page]:bg-subtle aria-[current=page]:font-medium aria-[current=page]:text-fg";

/** Zahl der Treffer einer gespeicherten Ansicht, aus derselben Abfrage wie die Kachel auf der Startseite */
function Anzahl({ ansicht }: { ansicht: GespeicherteAnsicht }) {
  const treffer = useAnsichtTreffer(ansicht);
  if (!treffer.data) return null;
  return (
    <span className="ml-2 rounded-full bg-subtle px-1.5 text-muted text-xs tabular-nums">
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

export function Sidebar({
  ich,
  eingebettet = false,
  oidc = null,
  version,
}: {
  ich: Ich;
  /** Im Frame einer anderen Seite: ohne Namen und Konto, die zeigt die einbettende Seite */
  eingebettet?: boolean;
  oidc?: { name: string } | null;
  version?: string;
}) {
  const ansichten = useQuery({ queryKey: ["ansichten"], queryFn: api.ansichten });
  const ort = useLocation();
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
    <aside className="flex flex-[1_1_240px] print:hidden flex-col gap-5 border-border border-b bg-side px-3 py-4 sm:max-w-64 sm:border-r sm:border-b-0">
      {!eingebettet && (
        <div className="flex flex-col px-2">
          <span className="font-semibold text-[15px]">{m.app_name()}</span>
          <span className="text-muted text-xs">{m.app_claim()}</span>
        </div>
      )}
      <nav aria-label={m.nav_label()} className="flex flex-col gap-0.5">
        {[
          ...ITEMS.filter((item) => NUR[ich.role]?.has(item.to) ?? true),
          ...(ich.role === "inhaber"
            ? ([
                { to: "/zugaenge", label: () => m.nav_access() },
                { to: "/benachrichtigungen", label: () => m.nav_notifications() },
              ] as const)
            : []),
        ].map((item) => (
          <div key={item.to} className="contents">
            <Link
              to={item.to}
              // Zeigt das Archiv eine gespeicherte Ansicht, ist sie markiert und nicht „Archiv“
              activeOptions={{ exact: true, includeSearch: item.to === "/archiv" && !!offeneAnsicht }}
              className={eintrag}
            >
              {item.label()}
            </Link>
            {item.to === "/archiv" && !!ansichten.data?.length && (
              <ul aria-label={m.views_nav_label()} className="m-0 flex list-none flex-col gap-0.5 p-0 pl-3">
                {ansichten.data.map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/archiv"
                      search={a.parameter}
                      activeOptions={{ exact: true, includeSearch: true }}
                      className={eintrag}
                    >
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <Anzahl ansicht={a} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </nav>
      {!eingebettet && (
        <div className="mt-auto flex flex-col gap-2 px-2 text-sm">
          <Darstellung />
          <span className="truncate text-muted">{ich.email}</span>
          <Link
            to="/konto"
            className="flex h-9 items-center self-start rounded-md border border-border px-3 font-medium hover:bg-subtle aria-[current=page]:bg-subtle"
          >
            {m.nav_account()}
          </Link>
          {oidc && konten.data && !verbunden && (
            <button
              type="button"
              onClick={() => void api.verbindenMitAnbieter()}
              className="h-9 self-start rounded-md border border-border px-3 font-medium hover:bg-subtle"
            >
              {m.oidc_link({ name: oidc.name })}
            </button>
          )}
          <button
            type="button"
            onClick={abmelden}
            className="h-9 self-start rounded-md border border-border px-3 font-medium hover:bg-subtle"
          >
            {m.logout()}
          </button>
          {version && <span className="text-muted text-xs">{m.version({ version })}</span>}
        </div>
      )}
    </aside>
  );
}
