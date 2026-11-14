import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Shell } from "./components/Shell.tsx";
import { ArchivePage } from "./pages/ArchivePage.tsx";
import { AuditPage } from "./pages/AuditPage.tsx";
import { DocumentPage } from "./pages/DocumentPage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { PlannedPage } from "./pages/PlannedPage.tsx";
import { RetentionPage } from "./pages/RetentionPage.tsx";
import { m } from "./paraglide/messages.js";

const root = createRootRoute({ component: Outlet });

const anmelden = createRoute({ getParentRoute: () => root, path: "/anmelden", component: LoginPage });

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
  createRoute({
    getParentRoute: () => app,
    path: "/quellen",
    component: () => <PlannedPage title={m.sources_title()} intro={m.sources_intro()} />,
  }),
  createRoute({
    getParentRoute: () => app,
    path: "/verfahrensdoku",
    component: () => <PlannedPage title={m.procedure_title()} intro={m.procedure_intro()} />,
  }),
];

export const router = createRouter({ routeTree: root.addChildren([anmelden, app.addChildren(seiten)]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
