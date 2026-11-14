import { Link } from "@tanstack/react-router";
import { m } from "../paraglide/messages.js";

const ITEMS = [
  { to: "/", label: () => m.nav_inbox() },
  { to: "/archiv", label: () => m.nav_archive() },
  { to: "/fristen", label: () => m.nav_retention() },
  { to: "/pruefung", label: () => m.nav_audit() },
  { to: "/quellen", label: () => m.nav_sources() },
  { to: "/verfahrensdoku", label: () => m.nav_procedure() },
] as const;

export function Sidebar() {
  return (
    <aside className="flex flex-[1_1_240px] flex-col gap-5 border-border border-b bg-side px-3 py-4 sm:max-w-64 sm:border-r sm:border-b-0">
      <div className="flex flex-col px-2">
        <span className="font-semibold text-[15px]">{m.app_name()}</span>
        <span className="text-muted text-xs">{m.app_claim()}</span>
      </div>
      <nav aria-label={m.nav_label()} className="flex flex-col gap-0.5">
        {ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: true }}
            className="flex h-9 items-center rounded-md px-2.5 text-fg/80 text-sm hover:bg-subtle aria-[current=page]:bg-subtle aria-[current=page]:font-medium aria-[current=page]:text-fg"
          >
            {item.label()}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
