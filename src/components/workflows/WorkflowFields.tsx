import type { Art, Dokumenttyp, Feld, Korrespondent, Tag, WorkflowQuelle } from "../../lib/api.ts";
import { ARTEN } from "../../lib/arten.ts";
import { m } from "../../paraglide/messages.js";
import { feldLabel } from "../DocumentOrdnung.tsx";
import { FieldInput, feldKlasse } from "../FieldInput.tsx";
import { QUELLE_LABEL } from "./labels.ts";
import { SendAction } from "./SendAction.tsx";

/* Felder des Formulars für einen Workflow: Bedingungen und Aktionen. Die Namen liest WorkflowForm aus dem FormData */

const QUELLEN: WorkflowQuelle[] = ["upload", "mail", "ordner", "api", "abgeleitet", "import"];
const feld = "flex flex-col gap-1.5 font-medium";

function TagOptionen({ tags }: { tags: Tag[] }) {
  return (
    <>
      <option value="">{m.workflow_none()}</option>
      {tags.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </>
  );
}

function KorrespondentOptionen({ korrespondenten }: { korrespondenten: Korrespondent[] }) {
  return (
    <>
      {korrespondenten.map((k) => (
        <option key={k.id} value={k.id}>
          {k.name}
        </option>
      ))}
    </>
  );
}

export function WorkflowConditions({
  tags,
  typen,
  korrespondenten,
}: {
  tags: Tag[];
  typen: Dokumenttyp[];
  korrespondenten: Korrespondent[];
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 font-semibold">{m.workflow_conditions()}</legend>
      <p className="m-0 text-muted">{m.workflow_conditions_hint()}</p>
      <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
        <legend className="mb-1.5 font-medium">{m.workflow_sources()}</legend>
        {QUELLEN.map((q) => (
          <label key={q} className="flex items-center gap-1.5">
            <input type="checkbox" name="quellen" value={q} className="size-4" />
            {QUELLE_LABEL[q]()}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {(
          [
            ["dateinameEnthaelt", m.workflow_filename()],
            ["betreffEnthaelt", m.rules_subject()],
            ["absender", m.rules_sender()],
            ["domain", m.rules_domain()],
            ["textEnthaelt", m.workflow_text()],
            ["mimeTyp", m.workflow_mime()],
            ["postfach", m.workflow_mailbox()],
            ["unterordner", m.workflow_subfolder()],
          ] as const
        ).map(([name, label]) => (
          <label key={name} className={feld}>
            {label}
            <input name={name} maxLength={500} className={feldKlasse} />
          </label>
        ))}
        <label className={feld}>
          {m.workflow_has_tag()}
          <select name="bedTag" className={feldKlasse}>
            <TagOptionen tags={tags} />
          </select>
        </label>
        <label className={feld}>
          {m.order_doctype()}
          <select name="bedTyp" className={feldKlasse}>
            <option value="">{m.workflow_none()}</option>
            <option value="ohne">{m.order_doctype_none()}</option>
            {typen.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={feld}>
          {m.order_party()}
          <select name="bedKorrespondent" className={feldKlasse}>
            <option value="">{m.workflow_none()}</option>
            <option value="ohne">{m.order_party_none()}</option>
            <KorrespondentOptionen korrespondenten={korrespondenten} />
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function WorkflowActions(p: {
  tags: Tag[];
  typen: Dokumenttyp[];
  korrespondenten: Korrespondent[];
  felder: Feld[];
  feldId: string;
  setFeldId: (id: string) => void;
  einordnen: boolean;
  setEinordnen: (ja: boolean) => void;
  art: Art;
  setArt: (a: Art) => void;
}) {
  const gewaehltesFeld = p.felder.find((x) => x.id === p.feldId);
  return (
    <fieldset className="m-0 flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 font-semibold">{m.workflow_actions()}</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <label className={feld}>
          {m.workflow_add_tag()}
          <select name="tagHinzu" className={feldKlasse}>
            <TagOptionen tags={p.tags} />
          </select>
        </label>
        <label className={feld}>
          {m.workflow_remove_tag()}
          <select name="tagWeg" className={feldKlasse}>
            <TagOptionen tags={p.tags} />
          </select>
        </label>
        <label className={feld}>
          {m.workflow_set_doctype()}
          <select name="typ" className={feldKlasse}>
            <option value="">{m.workflow_none()}</option>
            {p.typen.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className={feld}>
          {m.workflow_set_party()}
          <select name="korrespondent" className={feldKlasse}>
            <option value="">{m.workflow_none()}</option>
            <KorrespondentOptionen korrespondenten={p.korrespondenten} />
          </select>
        </label>
        <label className={feld}>
          {m.workflow_set_field()}
          <select value={p.feldId} onChange={(e) => p.setFeldId(e.target.value)} className={feldKlasse}>
            <option value="">{m.workflow_none()}</option>
            {p.felder.map((x) => (
              <option key={x.id} value={x.id}>
                {feldLabel(x)}
              </option>
            ))}
          </select>
        </label>
        {gewaehltesFeld && (
          <div className={feld}>
            <label htmlFor="workflow-feldwert">{m.workflow_field_value({ feld: gewaehltesFeld.name })}</label>
            <FieldInput feld={gewaehltesFeld} name="feldwert" id="workflow-feldwert" />
          </div>
        )}
      </div>
      <label className={feld}>
        {m.workflow_note()}
        <textarea name="notiz" rows={2} maxLength={5000} className="rounded-md border border-border bg-bg p-2" />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="webhook" className="size-4" />
        {m.workflow_webhook()}
      </label>
      <SendAction />
      <ClassifyAction einordnen={p.einordnen} setEinordnen={p.setEinordnen} art={p.art} setArt={p.setArt} />
    </fieldset>
  );
}

/** Einordnen ohne Bestätigung: nur mit dem Häkchen, dann Art, Entstehung, Frist (bei freiwillig) und Titel */
function ClassifyAction({
  einordnen,
  setEinordnen,
  art,
  setArt,
}: {
  einordnen: boolean;
  setEinordnen: (ja: boolean) => void;
  art: Art;
  setArt: (a: Art) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={einordnen}
          onChange={(e) => setEinordnen(e.target.checked)}
          className="size-4"
        />
        {m.workflow_classify()}
      </label>
      <p className="m-0 text-muted">{m.workflow_classify_hint()}</p>
      {einordnen && (
        <div className="flex flex-wrap items-end gap-3">
          <label className={feld}>
            {m.workflow_classify_art()}
            <select value={art} onChange={(e) => setArt(e.target.value as Art)} className={feldKlasse}>
              {ARTEN.map((a) => (
                <option key={a.art} value={a.art}>
                  {a.label()}
                </option>
              ))}
            </select>
          </label>
          <label className={feld}>
            {m.workflow_classify_date()}
            <select name="entstanden" className={feldKlasse}>
              <option value="eingang">{m.workflow_classify_date_eingang()}</option>
              <option value="erechnung">{m.workflow_classify_date_erechnung()}</option>
            </select>
          </label>
          {art === "freiwillig" && (
            <label className={feld}>
              {m.workflow_classify_until()}
              <input type="date" name="freiwilligBis" required className={feldKlasse} />
            </label>
          )}
          <label className={feld}>
            {m.workflow_classify_title()}
            <input name="titel" maxLength={300} className={feldKlasse} />
          </label>
        </div>
      )}
    </div>
  );
}
