import type { Ausloeser, Tag, Workflow, WorkflowAktion, WorkflowQuelle } from "../../lib/api.ts";
import { artLabel } from "../../lib/arten.ts";
import { m } from "../../paraglide/messages.js";

export const QUELLE_LABEL: Record<WorkflowQuelle, () => string> = {
  upload: () => m.source_upload(),
  mail: () => m.source_mail(),
  ordner: () => m.source_ordner(),
  api: () => m.source_api(),
  abgeleitet: () => m.source_abgeleitet(),
  import: () => m.source_import(),
};

export const AUSLOESER_LABEL: Record<Ausloeser, () => string> = {
  eingang: () => m.workflow_trigger_eingang(),
  eingeordnet: () => m.workflow_trigger_eingeordnet(),
};

/** Die Bedingungen eines Workflows in Worten, je Bedingung ein Eintrag */
type Namen = { id: string; name: string }[];
const nameIn = (liste: Namen, id: string) => liste.find((x) => x.id === id)?.name ?? "?";

export function bedingungenText(w: Workflow, tags: Tag[], typen: Namen, korrespondenten: Namen = []): string[] {
  const b = w.bedingungen;
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? "?";
  const teile: string[] = [];
  if (b.quellen?.length)
    teile.push(m.workflow_c_sources({ quellen: b.quellen.map((q) => QUELLE_LABEL[q]()).join(", ") }));
  if (b.dateinameEnthaelt) teile.push(m.workflow_c_filename({ text: b.dateinameEnthaelt }));
  if (b.betreffEnthaelt) teile.push(m.workflow_c_subject({ text: b.betreffEnthaelt }));
  if (b.absender) teile.push(m.workflow_c_sender({ text: b.absender }));
  if (b.domain) teile.push(m.workflow_c_domain({ text: b.domain }));
  if (b.anhangTyp) teile.push(m.workflow_c_attachment({ text: b.anhangTyp }));
  if (b.textEnthaelt) teile.push(m.workflow_c_text({ text: b.textEnthaelt }));
  if (b.mimeTyp) teile.push(m.workflow_c_mime({ text: b.mimeTyp }));
  if (b.tags?.length) teile.push(m.workflow_c_tags({ tags: b.tags.map(tagName).join(", ") }));
  if (b.dokumenttyp)
    teile.push(
      m.workflow_c_doctype({
        typ:
          b.dokumenttyp === "ohne" ? m.order_doctype_none() : (typen.find((t) => t.id === b.dokumenttyp)?.name ?? "?"),
      }),
    );
  if (b.korrespondent)
    teile.push(
      m.workflow_c_party({
        name: b.korrespondent === "ohne" ? m.order_party_none() : nameIn(korrespondenten, b.korrespondent),
      }),
    );
  if (b.postfach) teile.push(m.workflow_c_mailbox({ text: b.postfach }));
  if (b.unterordner) teile.push(m.workflow_c_subfolder({ text: b.unterordner }));
  return teile.length ? teile : [m.workflow_c_all()];
}

/** Eine Aktion in Worten */
export function aktionText(a: WorkflowAktion, tags: Tag[], typen: Namen, korrespondenten: Namen = []): string {
  const tagNamen = (ids: string[]) => ids.map((id) => tags.find((t) => t.id === id)?.name ?? "?").join(", ");
  switch (a.art) {
    case "tagsHinzu":
      return m.workflow_a_add_tags({ tags: tagNamen(a.tags) });
    case "tagsWeg":
      return m.workflow_a_remove_tags({ tags: tagNamen(a.tags) });
    case "dokumenttyp":
      return m.workflow_a_doctype({ typ: typen.find((t) => t.id === a.dokumenttyp)?.name ?? "?" });
    case "korrespondent":
      return m.workflow_a_party({ name: nameIn(korrespondenten, a.korrespondent) });
    case "feld":
      return m.workflow_a_field();
    case "einordnen":
      return m.workflow_a_classify({ art: artLabel(a.als) });
    case "webhook":
      return m.workflow_a_webhook();
    case "notiz":
      return m.workflow_a_note();
  }
}
