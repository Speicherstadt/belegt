import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { type Art, api, type WorkflowAktion, type WorkflowBedingungen, type WorkflowQuelle } from "../../lib/api.ts";
import { m } from "../../paraglide/messages.js";
import { ausEingabe, feldKlasse } from "../FieldInput.tsx";
import { sendenAus } from "./SendAction.tsx";
import { WorkflowActions, WorkflowConditions } from "./WorkflowFields.tsx";

const feld = "flex flex-col gap-1.5 font-medium";
const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim() || undefined;

/** Die Bedingungen aus dem Formular; leere Felder fallen weg */
function bedingungenAus(f: FormData): WorkflowBedingungen {
  const quellen = f.getAll("quellen").map(String) as WorkflowQuelle[];
  const tag = text(f, "bedTag");
  const b: WorkflowBedingungen = {
    quellen: quellen.length ? quellen : undefined,
    dateinameEnthaelt: text(f, "dateinameEnthaelt"),
    betreffEnthaelt: text(f, "betreffEnthaelt"),
    absender: text(f, "absender"),
    domain: text(f, "domain"),
    textEnthaelt: text(f, "textEnthaelt"),
    mimeTyp: text(f, "mimeTyp"),
    tags: tag ? [tag] : undefined,
    dokumenttyp: text(f, "bedTyp"),
    korrespondent: text(f, "bedKorrespondent"),
    postfach: text(f, "postfach"),
    unterordner: text(f, "unterordner"),
  };
  return Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
}

/** Ein Schritt des Editors: Nummer, Überschrift und Inhalt */
function Schritt({ nummer, titel, children }: { nummer: number; titel: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 border-border border-t p-0 pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-3 flex items-center gap-2 font-semibold text-base">
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full bg-primary text-onprimary text-xs"
        >
          {nummer}
        </span>
        {titel}
      </legend>
      <div className="clear-left flex flex-col gap-3">{children}</div>
    </fieldset>
  );
}

/**
 * Editor für einen neuen Workflow in drei Schritten: Wann (Name und Auslöser), Wenn (Bedingungen), Dann (Aktionen).
 * Nur der Inhaber sieht ihn; nach dem Anlegen meldet onFertig, damit die Seite ihn schließt
 */
export function WorkflowForm({ onFertig, onAbbrechen }: { onFertig?: () => void; onAbbrechen?: () => void }) {
  const queryClient = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten });
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder });
  const [feldId, setFeldId] = useState("");
  const [einordnen, setEinordnen] = useState(false);
  const [senden, setSenden] = useState(false);
  const [art, setArt] = useState<Art>("beleg");
  const [bedingungen, setBedingungen] = useState<string[]>([]);
  const [aktionenGewaehlt, setAktionenGewaehlt] = useState<string[]>([]);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const anlegen = useMutation({
    mutationFn: api.workflowAnlegen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflows"] }),
  });
  const gewaehltesFeld = felder.data?.find((x) => x.id === feldId);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHinweis(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const aktionen: WorkflowAktion[] = [];
    const hinzu = text(f, "tagHinzu");
    const weg = text(f, "tagWeg");
    const typ = text(f, "typ");
    if (hinzu) aktionen.push({ art: "tagsHinzu", tags: [hinzu] });
    if (weg) aktionen.push({ art: "tagsWeg", tags: [weg] });
    if (typ) aktionen.push({ art: "dokumenttyp", dokumenttyp: typ });
    const korrespondent = text(f, "korrespondent");
    if (korrespondent) aktionen.push({ art: "korrespondent", korrespondent });
    if (gewaehltesFeld) {
      const wert = ausEingabe(gewaehltesFeld, String(f.get("feldwert") ?? ""));
      if (wert === undefined || wert === null) return setHinweis(m.workflow_field_invalid());
      aktionen.push({ art: "feld", feldId: gewaehltesFeld.id, wert });
    }
    const notiz = text(f, "notiz");
    if (notiz) aktionen.push({ art: "notiz", text: notiz });
    if (f.get("webhook") === "on") aktionen.push({ art: "webhook" });
    const senden = sendenAus(f);
    if (senden === undefined) return setHinweis(m.workflow_send_fields_invalid());
    if (senden) aktionen.push(senden);
    if (einordnen)
      aktionen.push({
        art: "einordnen",
        als: art,
        entstanden: f.get("entstanden") === "erechnung" ? "erechnung" : "eingang",
        ...(art === "freiwillig" ? { freiwilligBis: text(f, "freiwilligBis") } : {}),
        ...(text(f, "titel") ? { titel: text(f, "titel") } : {}),
        ausdruecklich: true,
      });
    if (!aktionen.length) return setHinweis(m.workflow_no_action());
    anlegen.mutate(
      {
        name: String(f.get("name") ?? ""),
        ausloeser: f.get("ausloeser") === "eingeordnet" ? "eingeordnet" : "eingang",
        bedingungen: bedingungenAus(f),
        aktionen,
        anhalten: f.get("anhalten") === "on",
      },
      {
        onSuccess: () => {
          form.reset();
          setFeldId("");
          setEinordnen(false);
          setSenden(false);
          setBedingungen([]);
          setAktionenGewaehlt([]);
          onFertig?.();
        },
      },
    );
  }

  return (
    <form onSubmit={absenden} className="flex flex-col gap-5 rounded-lg border border-border p-4 text-sm sm:p-5">
      <Schritt nummer={1} titel={m.workflow_step_when()}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={feld}>
            {m.workflow_name()}
            <input name="name" required maxLength={100} className={feldKlasse} />
          </label>
          <label className={feld}>
            {m.workflow_trigger()}
            <select name="ausloeser" className={feldKlasse}>
              <option value="eingang">{m.workflow_trigger_eingang()}</option>
              <option value="eingeordnet">{m.workflow_trigger_eingeordnet()}</option>
            </select>
          </label>
        </div>
      </Schritt>
      <Schritt nummer={2} titel={m.workflow_step_if()}>
        <WorkflowConditions
          tags={tags.data ?? []}
          typen={typen.data ?? []}
          korrespondenten={korrespondenten.data ?? []}
          gewaehlt={bedingungen}
          setGewaehlt={setBedingungen}
        />
      </Schritt>
      <Schritt nummer={3} titel={m.workflow_step_then()}>
        <WorkflowActions
          tags={tags.data ?? []}
          typen={typen.data ?? []}
          korrespondenten={korrespondenten.data ?? []}
          felder={felder.data ?? []}
          feldId={feldId}
          setFeldId={setFeldId}
          einordnen={einordnen}
          setEinordnen={setEinordnen}
          senden={senden}
          setSenden={setSenden}
          art={art}
          setArt={setArt}
          gewaehlt={aktionenGewaehlt}
          setGewaehlt={setAktionenGewaehlt}
        />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="anhalten" />
          {m.workflow_stop()}
        </label>
      </Schritt>
      {(hinweis || anlegen.error) && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {hinweis ?? anlegen.error?.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-border border-t pt-4">
        <button
          type="submit"
          disabled={anlegen.isPending}
          className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
        >
          {m.workflow_create()}
        </button>
        {onAbbrechen && (
          <button
            type="button"
            onClick={onAbbrechen}
            className="h-9 rounded-md border border-border px-4 font-medium hover:bg-subtle"
          >
            {m.workflow_cancel()}
          </button>
        )}
      </div>
    </form>
  );
}
