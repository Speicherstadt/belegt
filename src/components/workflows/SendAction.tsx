import type { WorkflowAktion } from "../../lib/api.ts";
import { m } from "../../paraglide/messages.js";
import { feldKlasse } from "../FieldInput.tsx";

/*
 * Aktion „Original an Adresse senden“ im Formular für einen Workflow (docs/workflows.md#original-an-adresse-senden):
 * Adresse, Name des Dateifelds, eine Kopfzeile für die Anmeldung und feste Felder, je Zeile name=wert mit Platzhaltern.
 */

const feld = "flex flex-col gap-1.5 font-medium";

/** Die Aktion aus dem Formular, null ohne Häkchen; undefined bei einer Zeile der Felder ohne „=“ */
export function sendenAus(f: FormData): Extract<WorkflowAktion, { art: "senden" }> | null | undefined {
  if (f.get("senden") !== "on") return null;
  const felder = [];
  for (const zeile of String(f.get("sendenFelder") ?? "").split("\n")) {
    if (!zeile.trim()) continue;
    const gleich = zeile.indexOf("=");
    if (gleich < 1) return undefined;
    felder.push({ name: zeile.slice(0, gleich).trim(), wert: zeile.slice(gleich + 1).trim() });
  }
  const name = String(f.get("sendenKopfName") ?? "").trim();
  const wert = String(f.get("sendenKopfWert") ?? "");
  return {
    art: "senden",
    url: String(f.get("sendenUrl") ?? "").trim(),
    dateifeld: String(f.get("sendenFeld") ?? "").trim(),
    ...(name && wert ? { kopfzeile: { name, wert } } : {}),
    felder,
  };
}

/** Das Häkchen hält WorkflowForm, damit es nach dem Anlegen mit dem Formular zurückgesetzt wird */
export function SendAction({ an, setAn }: { an: boolean; setAn: (ja: boolean) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          name="senden"
          checked={an}
          onChange={(e) => setAn(e.target.checked)}
          className="size-4"
        />
        {m.workflow_send()}
      </label>
      <p className="m-0 text-muted">{m.workflow_send_hint()}</p>
      {an && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <label className={`${feld} col-span-full`}>
            {m.workflow_send_url()}
            <input
              name="sendenUrl"
              type="url"
              required
              placeholder={m.workflow_send_url_example()}
              className={feldKlasse}
            />
          </label>
          <label className={feld}>
            {m.workflow_send_field()}
            <input name="sendenFeld" required defaultValue="datei" maxLength={100} className={feldKlasse} />
          </label>
          <label className={feld}>
            {m.workflow_send_header_name()}
            <input name="sendenKopfName" defaultValue="Authorization" maxLength={100} className={feldKlasse} />
          </label>
          <label className={feld}>
            {m.workflow_send_header_value()}
            <input
              name="sendenKopfWert"
              type="password"
              autoComplete="off"
              placeholder="Bearer …"
              maxLength={4000}
              className={feldKlasse}
            />
          </label>
          <label className={`${feld} col-span-full`}>
            {m.workflow_send_fields()}
            <textarea
              name="sendenFelder"
              rows={3}
              placeholder={m.workflow_send_fields_example()}
              className="rounded-md border border-border bg-bg p-2 font-mono"
            />
            <span className="font-normal text-muted">{m.workflow_send_fields_hint()}</span>
          </label>
        </div>
      )}
    </div>
  );
}
