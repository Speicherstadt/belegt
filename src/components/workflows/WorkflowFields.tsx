import type { Art, Dokumenttyp, Feld, Korrespondent, Tag, WorkflowQuelle } from "../../lib/api.ts";
import { ARTEN } from "../../lib/arten.ts";
import { m } from "../../paraglide/messages.js";
import { feldLabel } from "../DocumentOrdnung.tsx";
import { FieldInput, feldKlasse } from "../FieldInput.tsx";
import { AddableRows, type Zeile } from "./AddableRows.tsx";
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

const textFeld = (name: string) => (id: string) => <input id={id} name={name} maxLength={500} className={feldKlasse} />;

export function WorkflowConditions({
  tags,
  typen,
  korrespondenten,
  gewaehlt,
  setGewaehlt,
}: {
  tags: Tag[];
  typen: Dokumenttyp[];
  korrespondenten: Korrespondent[];
  gewaehlt: string[];
  setGewaehlt: (s: string[]) => void;
}) {
  const zeilen: Zeile[] = [
    ...(
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
    ).map(([name, label]) => ({ schluessel: name, label, feld: textFeld(name) })),
    {
      schluessel: "bedTag",
      label: m.workflow_has_tag(),
      feld: (id) => (
        <select id={id} name="bedTag" required className={feldKlasse}>
          <TagOptionen tags={tags} />
        </select>
      ),
    },
    {
      schluessel: "bedTyp",
      label: m.order_doctype(),
      feld: (id) => (
        <select id={id} name="bedTyp" required className={feldKlasse}>
          <option value="">{m.workflow_none()}</option>
          <option value="ohne">{m.order_doctype_none()}</option>
          {typen.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      schluessel: "bedKorrespondent",
      label: m.order_party(),
      feld: (id) => (
        <select id={id} name="bedKorrespondent" required className={feldKlasse}>
          <option value="">{m.workflow_none()}</option>
          <option value="ohne">{m.order_party_none()}</option>
          <KorrespondentOptionen korrespondenten={korrespondenten} />
        </select>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="mb-2 font-medium">{m.workflow_sources()}</legend>
        {QUELLEN.map((q) => (
          <label
            key={q}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border px-3 hover:bg-subtle has-checked:border-primary has-checked:bg-subtle"
          >
            <input type="checkbox" name="quellen" value={q} />
            {QUELLE_LABEL[q]()}
          </label>
        ))}
      </fieldset>
      <AddableRows
        zeilen={zeilen}
        gewaehlt={gewaehlt}
        setGewaehlt={setGewaehlt}
        auswahlLabel={m.workflow_add_condition()}
        leer={m.workflow_conditions_hint()}
      />
    </div>
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
  senden: boolean;
  setSenden: (ja: boolean) => void;
  art: Art;
  setArt: (a: Art) => void;
  gewaehlt: string[];
  setGewaehlt: (s: string[]) => void;
}) {
  const gewaehltesFeld = p.felder.find((x) => x.id === p.feldId);
  const zeilen: Zeile[] = [
    {
      schluessel: "tagHinzu",
      label: m.workflow_add_tag(),
      feld: (id) => (
        <select id={id} name="tagHinzu" required className={feldKlasse}>
          <TagOptionen tags={p.tags} />
        </select>
      ),
    },
    {
      schluessel: "tagWeg",
      label: m.workflow_remove_tag(),
      feld: (id) => (
        <select id={id} name="tagWeg" required className={feldKlasse}>
          <TagOptionen tags={p.tags} />
        </select>
      ),
    },
    {
      schluessel: "typ",
      label: m.workflow_set_doctype(),
      feld: (id) => (
        <select id={id} name="typ" required className={feldKlasse}>
          <option value="">{m.workflow_none()}</option>
          {p.typen.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      schluessel: "korrespondent",
      label: m.workflow_set_party(),
      feld: (id) => (
        <select id={id} name="korrespondent" required className={feldKlasse}>
          <option value="">{m.workflow_none()}</option>
          <KorrespondentOptionen korrespondenten={p.korrespondenten} />
        </select>
      ),
    },
    {
      schluessel: "feld",
      label: m.workflow_set_field(),
      feld: (id) => (
        <div className="flex flex-wrap gap-2 [&>*]:min-w-40 [&>*]:flex-1">
          <select
            id={id}
            value={p.feldId}
            onChange={(e) => p.setFeldId(e.target.value)}
            required
            className={feldKlasse}
          >
            <option value="">{m.workflow_none()}</option>
            {p.felder.map((x) => (
              <option key={x.id} value={x.id}>
                {feldLabel(x)}
              </option>
            ))}
          </select>
          {gewaehltesFeld && (
            <div className="flex flex-col">
              <label htmlFor="workflow-feldwert" className="sr-only">
                {m.workflow_field_value({ feld: gewaehltesFeld.name })}
              </label>
              <FieldInput feld={gewaehltesFeld} name="feldwert" id="workflow-feldwert" />
            </div>
          )}
        </div>
      ),
    },
    {
      schluessel: "notiz",
      label: m.workflow_note(),
      feld: (id) => (
        <textarea
          id={id}
          name="notiz"
          rows={2}
          required
          maxLength={5000}
          className="rounded-md border border-border bg-bg p-2"
        />
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <AddableRows
        zeilen={zeilen}
        gewaehlt={p.gewaehlt}
        setGewaehlt={(s) => {
          if (!s.includes("feld")) p.setFeldId("");
          p.setGewaehlt(s);
        }}
        auswahlLabel={m.workflow_add_action()}
        leer={m.workflow_actions_empty()}
      />
      <label className="flex items-center gap-2">
        <input type="checkbox" name="webhook" />
        {m.workflow_webhook()}
      </label>
      <SendAction an={p.senden} setAn={p.setSenden} />
      <ClassifyAction einordnen={p.einordnen} setEinordnen={p.setEinordnen} art={p.art} setArt={p.setArt} />
    </div>
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
