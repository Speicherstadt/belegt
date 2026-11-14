import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Shell } from "./components/Shell.tsx";
import { ArchivePage } from "./pages/ArchivePage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { PlannedPage } from "./pages/PlannedPage.tsx";
import { RetentionPage } from "./pages/RetentionPage.tsx";
import { m } from "./paraglide/messages.js";

const root = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

const routes = [
  createRoute({ getParentRoute: () => root, path: "/", component: InboxPage }),
  createRoute({ getParentRoute: () => root, path: "/archiv", component: ArchivePage }),
  createRoute({ getParentRoute: () => root, path: "/fristen", component: RetentionPage }),
  createRoute({
    getParentRoute: () => root,
    path: "/pruefung",
    component: () => <PlannedPage title={m.audit_title()} intro={m.audit_intro()} />,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/quellen",
    component: () => <PlannedPage title={m.sources_title()} intro={m.sources_intro()} />,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/verfahrensdoku",
    component: () => <PlannedPage title={m.procedure_title()} intro={m.procedure_intro()} />,
  }),
];

export const router = createRouter({ routeTree: root.addChildren(routes) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
