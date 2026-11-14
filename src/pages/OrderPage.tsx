import { useQuery } from "@tanstack/react-query";
import { darfSchreiben } from "../../shared/rollen.ts";
import { DoctypesAdmin } from "../components/DoctypesAdmin.tsx";
import { FieldsAdmin } from "../components/FieldsAdmin.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { TagsAdmin } from "../components/TagsAdmin.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Tags, Dokumenttypen und eigene Felder; anlegen und ändern nur der Inhaber */
export function OrderPage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const schreiben = darfSchreiben(ich.data?.role);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.order_page_title()} intro={m.order_page_intro()} />
      <TagsAdmin schreiben={schreiben} />
      <DoctypesAdmin schreiben={schreiben} />
      <FieldsAdmin schreiben={schreiben} />
    </div>
  );
}
