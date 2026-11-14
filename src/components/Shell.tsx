import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ApiFehler, api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { Sidebar } from "./Sidebar.tsx";

export function Shell({ children }: { children: ReactNode }) {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  if (ich.error instanceof ApiFehler && ich.error.status === 401) return <Navigate to="/anmelden" />;
  if (!ich.data) return <p className="p-8 text-muted text-sm">{m.loading()}</p>;
  return (
    <div className="flex min-h-screen flex-wrap bg-bg text-fg">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-onprimary"
      >
        {m.skip_link()}
      </a>
      <Sidebar ich={ich.data} />
      <main id="inhalt" className="min-w-0 flex-[999_1_560px] px-4 py-6 sm:px-8">
        {children}
      </main>
    </div>
  );
}
