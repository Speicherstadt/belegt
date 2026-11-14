import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { api, type Ich } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const ITEMS = [
  { to: "/", label: () => m.nav_inbox() },
  { to: "/archiv", label: () => m.nav_archive() },
  { to: "/fristen", label: () => m.nav_retention() },
  { to: "/pruefung", label: () => m.nav_audit() },
  { to: "/quellen", label: () => m.nav_sources() },
  { to: "/verfahrensdoku", label: () => m.nav_procedure() },
] as const;

export function Sidebar({ ich }: { ich: Ich }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function abmelden() {
    await api.abmelden();
    queryClient.clear();
    await navigate({ to: "/anmelden" });
  }
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
      <div className="mt-auto flex flex-col gap-2 px-2 text-sm">
        <span className="truncate text-muted">{ich.email}</span>
        <button
          type="button"
          onClick={abmelden}
          className="h-9 self-start rounded-md border border-border px-3 font-medium hover:bg-subtle"
        >
          {m.logout()}
        </button>
      </div>
    </aside>
  );
}
