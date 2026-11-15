import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Typen, die eine Office-App öffnet: Word, Excel, PowerPoint, OpenDocument, alte Formate, RTF und Text (CSV) */
const OFFICE =
  /^(application\/(vnd\.openxmlformats-officedocument\.|vnd\.oasis\.opendocument\.|msword$|vnd\.ms-(excel|powerpoint)$|rtf$)|text\/plain$)/;

/**
 * „Öffnen mit …“: Belegt legt einen kurzlebigen Link an und öffnet die App aus der Einstellung damit in einem neuen
 * Tab. Das Fenster öffnet sich sofort beim Klick, sonst hielte der Browser es nach der Anfrage für ein Popup.
 */
export function OpenWith({ dokumentId, mimeType }: { dokumentId: string; mimeType: string }) {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const [fehler, setFehler] = useState(false);
  const app = status.data?.oeffnenMit;
  if (!app || !OFFICE.test(mimeType) || !ich.data || ich.data.role === "pruefer" || ich.data.role === "mitarbeiter")
    return null;

  async function oeffnen() {
    setFehler(false);
    const fenster = window.open("", "_blank");
    try {
      const { url } = await api.freigabe(dokumentId);
      if (fenster) {
        fenster.opener = null;
        fenster.location.href = url;
      } else window.location.href = url;
    } catch {
      fenster?.close();
      setFehler(true);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void oeffnen()}
        className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
      >
        {m.open_with({ name: app.name })}
      </button>
      {fehler && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.open_with_error()}
        </p>
      )}
    </div>
  );
}
