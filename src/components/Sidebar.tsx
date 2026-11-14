import { m } from "../paraglide/messages.js";

const ITEMS = [
  { href: "/", label: () => m.nav_inbox() },
  { href: "/archiv", label: () => m.nav_archive() },
  { href: "/fristen", label: () => m.nav_retention() },
  { href: "/pruefung", label: () => m.nav_audit() },
  { href: "/quellen", label: () => m.nav_sources() },
  { href: "/verfahrensdoku", label: () => m.nav_procedure() },
];

export function Sidebar() {
  const current = typeof window === "undefined" ? "/" : window.location.pathname;
  return (
    <aside className="flex max-w-64 flex-[1_1_240px] flex-col gap-5 border-r border-border bg-side px-3 py-4">
      <div className="flex flex-col px-2">
        <span className="text-[15px] font-semibold">{m.app_name()}</span>
        <span className="text-xs text-muted">{m.app_claim()}</span>
      </div>
      <nav aria-label={m.nav_label()} className="flex flex-col gap-0.5">
        {ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            aria-current={item.href === current ? "page" : undefined}
            className="flex h-9 items-center rounded-md px-2.5 text-sm text-fg/80 hover:bg-subtle aria-[current=page]:bg-subtle aria-[current=page]:font-medium aria-[current=page]:text-fg"
          >
            {item.label()}
          </a>
        ))}
      </nav>
    </aside>
  );
}
