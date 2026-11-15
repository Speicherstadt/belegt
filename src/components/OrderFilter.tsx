import { useQuery } from "@tanstack/react-query";
import { FARBEN } from "../../shared/ordnung.ts";
import { api, type ListenFilter } from "../lib/api.ts";
import { feldFilterArten } from "../lib/ordnung.ts";
import { m } from "../paraglide/messages.js";
import { feldLabel } from "./DocumentOrdnung.tsx";
import { feldKlasse } from "./FieldInput.tsx";

const ART_LABEL = {
  gesetzt: () => m.filter_field_set(),
  enthaelt: () => m.filter_field_contains(),
  bereich: () => m.filter_field_range(),
};

/**
 * Filter der Archivliste nach Tags (alle gewählten oder mindestens einer), Korrespondent, Dokumenttyp und einem
 * eigenen Feld
 */
export function OrderFilter({ filter, onChange }: { filter: ListenFilter; onChange: (f: ListenFilter) => void }) {
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten });
  const feld = filter.feld && felder.data?.find((f) => f.id === filter.feld!.feldId);
  if (
    !tags.data?.length &&
    !typen.data?.length &&
    !felder.data?.length &&
    !korrespondenten.data?.length &&
    !filter.korrespondent
  )
    return null;

  const tagUmschalten = (id: string) =>
    onChange({
      ...filter,
      tags: filter.tags.includes(id) ? filter.tags.filter((t) => t !== id) : [...filter.tags, id],
    });

  return (
    <div className="flex flex-col gap-3">
      {!!tags.data?.length && (
        <div className="flex flex-col gap-2">
          <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
            <legend className="mb-2 font-medium text-muted text-sm">{m.filter_tags()}</legend>
            {tags.data.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={filter.tags.includes(t.id)}
                onClick={() => tagUmschalten(t.id)}
                className="flex h-8 items-center gap-2 rounded-full border border-border px-3 font-medium text-sm hover:bg-subtle aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-onprimary"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full border border-black/20"
                  style={{ backgroundColor: FARBEN[t.farbe]?.hintergrund }}
                />
                {t.name}
              </button>
            ))}
          </fieldset>
          {filter.tags.length > 1 && (
            <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0 text-sm">
              <legend className="float-left mr-1 font-medium text-muted">{m.filter_tags_mode()}</legend>
              {(["alle", "einer"] as const).map((modus) => (
                <button
                  key={modus}
                  type="button"
                  aria-pressed={filter.tagModus === modus}
                  onClick={() => onChange({ ...filter, tagModus: modus })}
                  className="h-7 rounded-md border border-border px-2.5 font-medium hover:bg-subtle aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-onprimary"
                >
                  {modus === "alle" ? m.filter_tags_all() : m.filter_tags_any()}
                </button>
              ))}
            </fieldset>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {(!!korrespondenten.data?.length || !!filter.korrespondent) && (
          <label className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.order_party()}
            <select
              value={filter.korrespondent}
              onChange={(e) => onChange({ ...filter, korrespondent: e.target.value })}
              className={feldKlasse}
            >
              <option value="">{m.filter_party_all()}</option>
              <option value="ohne">{m.order_party_none()}</option>
              {korrespondenten.data?.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!!typen.data?.length && (
          <label className="flex flex-col gap-1.5 font-medium">
            {m.order_doctype()}
            <select
              value={filter.dokumenttyp}
              onChange={(e) => onChange({ ...filter, dokumenttyp: e.target.value })}
              className={feldKlasse}
            >
              <option value="">{m.filter_doctype_all()}</option>
              <option value="ohne">{m.order_doctype_none()}</option>
              {typen.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!!felder.data?.length && (
          <label className="flex flex-col gap-1.5 font-medium">
            {m.filter_field()}
            <select
              value={filter.feld?.feldId ?? ""}
              onChange={(e) =>
                onChange({
                  ...filter,
                  feld: e.target.value ? { feldId: e.target.value, art: "gesetzt", text: "", von: "", bis: "" } : null,
                })
              }
              className={feldKlasse}
            >
              <option value="">{m.filter_field_none()}</option>
              {felder.data.map((f) => (
                <option key={f.id} value={f.id}>
                  {feldLabel(f)}
                </option>
              ))}
            </select>
          </label>
        )}
        {feld && filter.feld && (
          <>
            <label className="flex flex-col gap-1.5 font-medium">
              {m.filter_field_condition()}
              <select
                value={filter.feld.art}
                onChange={(e) => onChange({ ...filter, feld: { ...filter.feld!, art: e.target.value as "gesetzt" } })}
                className={feldKlasse}
              >
                {feldFilterArten(feld.typ).map((a) => (
                  <option key={a} value={a}>
                    {ART_LABEL[a]()}
                  </option>
                ))}
              </select>
            </label>
            {filter.feld.art === "enthaelt" && (
              <label className="flex flex-col gap-1.5 font-medium">
                {m.filter_field_text()}
                <input
                  value={filter.feld.text}
                  onChange={(e) => onChange({ ...filter, feld: { ...filter.feld!, text: e.target.value } })}
                  className={feldKlasse}
                />
              </label>
            )}
            {filter.feld.art === "bereich" &&
              (["von", "bis"] as const).map((grenze) => (
                <label key={grenze} className="flex flex-col gap-1.5 font-medium">
                  {grenze === "von" ? m.filter_from() : m.filter_to()}
                  <input
                    type={feld.typ === "datum" ? "date" : "text"}
                    inputMode={feld.typ === "datum" ? undefined : "decimal"}
                    placeholder={feld.typ === "betrag" ? "1.234,56" : undefined}
                    value={filter.feld![grenze]}
                    onChange={(e) => onChange({ ...filter, feld: { ...filter.feld!, [grenze]: e.target.value } })}
                    className={feldKlasse}
                  />
                </label>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
