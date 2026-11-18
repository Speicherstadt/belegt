import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { EmbedBridge } from "./components/EmbedBridge.tsx";
import { NichtGefunden, SeitenFehler } from "./components/Fehlerseiten.tsx";
import { AccessPage } from "./pages/AccessPage.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { ArchivePage } from "./pages/ArchivePage.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { DocumentPage } from "./pages/DocumentPage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { InvitePage } from "./pages/InvitePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { NotificationsPage } from "./pages/NotificationsPage.tsx";
import { OrderPage } from "./pages/OrderPage.tsx";
import { ProcedurePage } from "./pages/ProcedurePage.tsx";
import { RetentionPage } from "./pages/RetentionPage.tsx";
import { SharePage } from "./pages/SharePage.tsx";
import { SourcesPage } from "./pages/SourcesPage.tsx";
import { StartPage } from "./pages/StartPage.tsx";
import { WorkflowsPage } from "./pages/WorkflowsPage.tsx";
import { Shell } from "./Shell.tsx";

// Die Brücke zur einbettenden Seite läuft auf jeder Seite, auch beim Anmelden
const root = createRootRoute({
  // Unbekannte Adresse landet an der Wurzel: die Meldung steht trotzdem in der Shell, die Seitenleiste bleibt
  notFoundComponent: () => (
    <Shell>
      <NichtGefunden />
    </Shell>
  ),
  component: () => (
    <>
      <EmbedBridge />
      <Outlet />
    </>
  ),
});

const anmelden = createRoute({ getParentRoute: () => root, path: "/anmelden", component: LoginPage });
const einladung = createRoute({ getParentRoute: () => root, path: "/einladung/$token", component: InvitePage });

/** Alles hinter der Anmeldung: Seitenleiste und Prüfung der Sitzung in Shell */
const app = createRoute({
  getParentRoute: () => root,
  id: "app",
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

const seiten = [
  createRoute({ getParentRoute: () => app, path: "/", component: StartPage }),
  createRoute({ getParentRoute: () => app, path: "/eingang", component: InboxPage }),
  createRoute({ getParentRoute: () => app, path: "/archiv", component: ArchivePage }),
  createRoute({ getParentRoute: () => app, path: "/dokumente/$id", component: DocumentPage }),
  createRoute({ getParentRoute: () => app, path: "/ordnung", component: OrderPage }),
  createRoute({ getParentRoute: () => app, path: "/fristen", component: RetentionPage }),
  createRoute({ getParentRoute: () => app, path: "/pruefung", component: AuditPage }),
  createRoute({ getParentRoute: () => app, path: "/zugaenge", component: AccessPage }),
  createRoute({ getParentRoute: () => app, path: "/konto", component: AccountPage }),
  createRoute({ getParentRoute: () => app, path: "/benachrichtigungen", component: NotificationsPage }),
  createRoute({ getParentRoute: () => app, path: "/quellen", component: SourcesPage }),
  createRoute({ getParentRoute: () => app, path: "/workflows", component: WorkflowsPage }),
  // Ziel des Teilens vom Handy (share_target im Manifest, src/pwa/)
  createRoute({ getParentRoute: () => app, path: "/teilen", component: SharePage }),
  createRoute({
    getParentRoute: () => app,
    path: "/verfahrensdoku",
    component: ProcedurePage,
  }),
];

/**
 * Suchparameter bleiben einfache Texte (?gruppe=pflicht&tags=a,b), damit eine Adresse lesbar und eine gespeicherte
 * Ansicht ein gewöhnlicher Link ist (shared/archivansicht.ts); die Vorgabe des Routers schriebe JSON hinein
 */
const parseSearch = (suche: string) => Object.fromEntries(new URLSearchParams(suche));
const stringifySearch = (werte: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(werte)) if (typeof v === "string" && v !== "") p.set(k, v);
  const text = p.toString();
  return text ? `?${text}` : "";
};

export const router = createRouter({
  routeTree: root.addChildren([anmelden, einladung, app.addChildren(seiten)]),
  parseSearch,
  stringifySearch,
  defaultNotFoundComponent: NichtGefunden,
  defaultErrorComponent: SeitenFehler,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
