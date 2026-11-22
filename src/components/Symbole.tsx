import {
  Archive,
  Bell,
  CalendarClock,
  FileText,
  House,
  Inbox,
  type LucideIcon,
  Mail,
  ShieldCheck,
  Tags,
  Users,
  Workflow,
} from "lucide-react";
import type { Gruppe } from "../lib/api.ts";

/** Symbol je Bereich der App (Lucide); Seitenleiste, Kacheln und leere Seiten nehmen dasselbe, immer einfarbig */
export const BEREICH: Record<string, LucideIcon> = {
  "/": House,
  "/eingang": Inbox,
  "/archiv": Archive,
  "/ordnung": Tags,
  "/fristen": CalendarClock,
  "/pruefung": ShieldCheck,
  "/quellen": Mail,
  "/workflows": Workflow,
  "/verfahrensdoku": FileText,
  "/zugaenge": Users,
  "/benachrichtigungen": Bell,
};

/** Symbol eines Bereichs in der Textfarbe drumherum (Seitenleiste, Beschriftungen); rein schmückend */
export function BereichSymbol({ bereich, className = "size-4" }: { bereich: string; className?: string }) {
  const S = BEREICH[bereich];
  if (!S) return null;
  return <S aria-hidden="true" className={`shrink-0 ${className}`} strokeWidth={2} />;
}

/** Großes Symbol auf grauer Fläche mit Rand, für leere Seiten */
export function LeerSymbol({ bereich }: { bereich: string }) {
  if (!BEREICH[bereich]) return null;
  return (
    <span
      aria-hidden="true"
      className="flex size-11 items-center justify-center rounded-lg border border-border bg-subtle text-muted"
    >
      <BereichSymbol bereich={bereich} className="size-5" />
    </span>
  );
}

/** Punkt je Art der Aufbewahrung, wie in Listen: Farbe nur mit Bedeutung, die übrigen Gruppen haben keinen */
export const PUNKT: Partial<Record<Gruppe, string>> = {
  pflicht: "bg-c-blue",
  freiwillig: "bg-c-amber",
  frei: "bg-muted",
};
