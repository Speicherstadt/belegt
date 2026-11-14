import { useQuery } from "@tanstack/react-query";
import { ApiTokens } from "../components/ApiTokens.tsx";
import { Mailboxes } from "../components/Mailboxes.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { Rules } from "../components/Rules.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

export function SourcesPage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.sources_title()} intro={m.sources_intro()} />
      <Mailboxes />
      <Rules />
      {ich.data?.role === "inhaber" && <ApiTokens />}
    </div>
  );
}
