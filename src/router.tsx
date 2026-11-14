import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Shell } from "./components/Shell.tsx";
import { AccessPage } from "./pages/AccessPage.tsx";
import { ArchivePage } from "./pages/ArchivePage.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { DocumentPage } from "./pages/DocumentPage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { InvitePage } from "./pages/InvitePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ProcedurePage } from "./pages/ProcedurePage.tsx";
import { RetentionPage } from "./pages/RetentionPage.tsx";
import { SourcesPage } from "./pages/SourcesPage.tsx";

const root = createRootRoute({ component: Outlet });

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
  createRoute({ getParentRoute: () => app, path: "/", component: InboxPage }),
  createRoute({ getParentRoute: () => app, path: "/archiv", component: ArchivePage }),
  createRoute({ getParentRoute: () => app, path: "/dokumente/$id", component: DocumentPage }),
  createRoute({ getParentRoute: () => app, path: "/fristen", component: RetentionPage }),
  createRoute({ getParentRoute: () => app, path: "/pruefung", component: AuditPage }),
  createRoute({ getParentRoute: () => app, path: "/zugaenge", component: AccessPage }),
  createRoute({ getParentRoute: () => app, path: "/quellen", component: SourcesPage }),
  createRoute({
    getParentRoute: () => app,
    path: "/verfahrensdoku",
    component: ProcedurePage,
  }),
];

export const router = createRouter({ routeTree: root.addChildren([anmelden, einladung, app.addChildren(seiten)]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
