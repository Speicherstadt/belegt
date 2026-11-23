import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type Art, api, type Eintrag, type OrdnungAenderung, type SammelEinordnung } from "../lib/api.ts";
import { ARTEN } from "../lib/arten.ts";
import { m } from "../paraglide/messages.js";
import { feldLabel } from "./DocumentOrdnung.tsx";
import { ausEingabe, FieldInput, feldKlasse } from "./FieldInput.tsx";

/** Was die Leiste der Auswahl (SelectionBar) anbietet; Tags fügt hinzu oder entfernt, je nach Knopf */
export type Aktion = "tags" | "korrespondent" | "dokumenttyp" | "feld" | "einordnen";

const label = "flex min-w-0 flex-col gap-1.5 font-medium";

/**
 * Sammelbearbeitung der gewählten Dokumente im Panel über der Leiste: eine Aktion für alle, in einer Transaktion.
 * Scheitert eines, gilt für keines etwas, und das Panel nennt, woran es lag.
 */
export function BulkEdit({
  aktion,
  gewaehlt,
  eintraege,
  fertig,
}: {
  aktion: Aktion;
  gewaehlt: string[];
  eintraege: Eintrag[];
  /** Nach Erfolg, mit der Meldung für die Liste */
  fertig: (meldung: string) => void;
}) {
  const queryClient = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten });
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder });
  const [feldId, setFeldId] = useState("");
  const [art, setArt] = useState<Art>("beleg");
  const [eingangstag, setEingangstag] = useState(true);
  const [ungueltig, setUngueltig] = useState(false);
  const feld = felder.data?.find((f) => f.id === feldId) ?? felder.data?.[0];
  const ausfuehren = useMutation({
    mutationFn: (a: OrdnungAenderung & { einordnung?: SammelEinordnung }) => api.sammeln(gewaehlt, a),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries();
      if (r.ok)
        fertig(
          m.bulk_done({
            anzahl: String(r.ergebnisse.length),
            eingeordnet: String(r.ergebnisse.filter((e) => e.ok && e.eingeordnet).length),
          }),
        );
    },
  });
  const name = (id: string) => {
    const e = eintraege.find((x) => x.id === id);
    return e?.titel ?? e?.dateiname ?? id;
  };

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    setUngueltig(false);
    if (aktion === "tags") {
      const weg = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "weg";
      ausfuehren.mutate({ [weg ? "tagsWeg" : "tagsHinzu"]: [text("tag")] });
    } else if (aktion === "dokumenttyp") ausfuehren.mutate({ dokumenttyp: text("dokumenttyp") || null });
    else if (aktion === "korrespondent") ausfuehren.mutate({ korrespondent: text("korrespondent") || null });
    else if (aktion === "feld" && feld) {
      const wert = ausEingabe(feld, text("wert"));
      if (wert === undefined) setUngueltig(true);
      else ausfuehren.mutate({ felder: [{ feldId: feld.id, wert }] });
    } else if (aktion === "einordnen")
      ausfuehren.mutate({
        einordnung: {
          art,
          entstanden: eingangstag ? "eingang" : text("entstanden"),
          freiwilligBis: text("freiwilligBis") || undefined,
          titel: text("titel") || undefined,
          korrespondent: text("korrespondent") || undefined,
          nurOffene: f.get("alle") !== "on",
        },
      });
  }

  const r = ausfuehren.data;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <form onSubmit={absenden} className="flex flex-col gap-3">
        {aktion === "einordnen" && <p className="m-0 text-muted">{m.bulk_classify_hint()}</p>}
        {/* Oben die Felder, unten rechts die Knöpfe: in jedem Panel der Leiste gleich (DESIGN.md, Auswahl und Kacheln) */}
        <div className="grid items-end gap-3 sm:grid-cols-2">
          {aktion === "tags" &&
            (tags.data?.length ? (
              <label className={label}>
                {m.order_tag_add_label()}
                <select name="tag" required className={feldKlasse}>
                  {tags.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="m-0 text-muted">{m.order_tags_none()}</p>
            ))}
          {aktion === "korrespondent" && (
            <label className={label}>
              {m.order_party()}
              <select name="korrespondent" className={feldKlasse}>
                <option value="">{m.order_party_none()}</option>
                {korrespondenten.data?.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {aktion === "dokumenttyp" && (
            <label className={label}>
              {m.order_doctype()}
              <select name="dokumenttyp" className={feldKlasse}>
                <option value="">{m.order_doctype_none()}</option>
                {typen.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {aktion === "feld" &&
            (feld ? (
              <>
                <label className={label}>
                  {m.filter_field()}
                  <select value={feld.id} onChange={(e) => setFeldId(e.target.value)} className={feldKlasse}>
                    {felder.data?.map((f) => (
                      <option key={f.id} value={f.id}>
                        {feldLabel(f)}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="sammel-wert" className={label}>
                  {m.bulk_value()}
                  <FieldInput key={feld.id} id="sammel-wert" feld={feld} name="wert" />
                </label>
              </>
            ) : (
              <p className="m-0 text-muted">{m.order_fields_none()}</p>
            ))}
          {aktion === "einordnen" && (
            <>
              <label className={label}>
                {m.classify_kind()}
                <select value={art} onChange={(e) => setArt(e.target.value as Art)} className={feldKlasse}>
                  {ARTEN.map((a) => (
                    <option key={a.art} value={a.art}>
                      {a.label()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex h-9 items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={eingangstag}
                  onChange={(e) => setEingangstag(e.target.checked)}
                  className="size-4"
                />
                {m.bulk_created_received()}
              </label>
              {!eingangstag && (
                <label className={label}>
                  {m.classify_created()}
                  <input name="entstanden" type="date" required className={feldKlasse} />
                </label>
              )}
              {art === "freiwillig" && (
                <label className={label}>
                  {m.classify_voluntary_until()}
                  <input name="freiwilligBis" type="date" required className={feldKlasse} />
                </label>
              )}
              <label className={label}>
                {m.classify_label()}
                <input name="titel" className={feldKlasse} />
              </label>
              <label className={label}>
                {m.classify_party()}
                <input name="korrespondent" className={feldKlasse} />
              </label>
              <label className="flex h-9 items-center gap-2 font-medium sm:col-span-2">
                <input name="alle" type="checkbox" className="size-4" />
                {m.bulk_reclassify()}
              </label>
            </>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {aktion === "tags" ? (
            <>
              <button
                type="submit"
                value="weg"
                disabled={ausfuehren.isPending}
                className="h-9 rounded-md border border-border px-4 font-medium hover:bg-subtle disabled:opacity-60"
              >
                {m.bulk_tags_remove()}
              </button>
              <button
                type="submit"
                value="hinzu"
                disabled={ausfuehren.isPending}
                className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
              >
                {m.bulk_tags_add()}
              </button>
            </>
          ) : (
            <button
              type="submit"
              disabled={ausfuehren.isPending}
              className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
            >
              {m.bulk_apply({ anzahl: String(gewaehlt.length) })}
            </button>
          )}
        </div>
      </form>
      {ungueltig && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {feld?.typ === "betrag" ? m.order_field_invalid_amount() : m.order_field_invalid()}
        </p>
      )}
      {r && !r.ok && (
        <div role="alert" className="flex flex-col gap-1 text-red-700 dark:text-red-400">
          <p className="m-0 font-medium">{m.bulk_rolled_back()}</p>
          <ul className="m-0 pl-5">
            {r.ergebnisse.flatMap((e) =>
              e.ok ? [] : [<li key={e.id}>{m.bulk_failed_item({ name: name(e.id), fehler: e.fehler })}</li>],
            )}
          </ul>
        </div>
      )}
      {ausfuehren.error && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {m.order_failed({ meldung: ausfuehren.error.message })}
        </p>
      )}
    </div>
  );
}
