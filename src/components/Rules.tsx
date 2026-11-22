import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { Feldwert } from "../../shared/ordnung.ts";
import { darfSchreiben } from "../../shared/rollen.ts";
import { type Art, api, type Feld } from "../lib/api.ts";
import { ARTEN, artLabel } from "../lib/arten.ts";
import { m } from "../paraglide/messages.js";
import { Ausklappbar, verwaltungsKarte } from "./Ausklappbar.tsx";
import { feldLabel } from "./DocumentOrdnung.tsx";
import { ausEingabe, FieldInput } from "./FieldInput.tsx";
import { SuggestionOrder } from "./SuggestionOrder.tsx";

const feldKlasseRegel = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Regeln für Vorschläge: Liste, anlegen, ein- und ausschalten */
export function Rules() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["regeln"], queryFn: api.regeln });
  // "" heißt: keine Art, die Regel schlägt nur Tags, Dokumenttyp oder Feldwerte vor
  const [art, setArt] = useState<Art | "">("beleg");
  // Vorgeschlagene Feldwerte: je Zeile ein Feld; der Schlüssel hält die Eingabe beim Entfernen einer Zeile fest
  const [zeilen, setZeilen] = useState<{ schluessel: number; feldId: string }[]>([]);
  const [offen, setOffen] = useState(false);
  const [naechste, setNaechste] = useState(0);
  const [ungueltig, setUngueltig] = useState<Feld | null>(null);
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten });
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder });
  const feldZu = (id: string) => felder.data?.find((f) => f.id === id);
  const neu = () => queryClient.invalidateQueries({ queryKey: ["regeln"] });
  const anlegen = useMutation({ mutationFn: api.regelAnlegen, onSuccess: neu });
  const schalten = useMutation({
    mutationFn: ({ id, aktiv }: { id: string; aktiv: boolean }) => api.regelSchalten(id, aktiv),
    onSuccess: neu,
  });
  const schreiben = darfSchreiben(ich.data?.role);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const werte: { feldId: string; wert: Feldwert }[] = [];
    for (const z of zeilen) {
      const feld = feldZu(z.feldId);
      if (!feld) continue;
      const wert = ausEingabe(feld, String(f.get(`wert-${z.schluessel}`) ?? ""));
      if (wert === undefined) return setUngueltig(feld);
      if (wert !== null) werte.push({ feldId: feld.id, wert });
    }
    setUngueltig(null);
    anlegen.mutate(
      {
        name: String(f.get("name")),
        wenn: {
          absender: text("absender"),
          domain: text("domain"),
          betreffEnthaelt: text("betreff"),
          anhangTyp: text("anhang"),
        },
        dann: art || null,
        ordnung: {
          tags: f.getAll("tags").map(String),
          dokumenttyp: text("dokumenttyp") ?? null,
          korrespondent: text("korrespondent") ?? null,
          felder: werte,
        },
      },
      {
        onSuccess: () => {
          form.reset();
          setZeilen([]);
          setOffen(false);
        },
      },
    );
  }

  return (
    <section aria-labelledby="regeln" className={verwaltungsKarte}>
      <h2 id="regeln" className="m-0 font-semibold text-base">
        {m.rules_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.rules_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.rules_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
          >
            <span className="flex flex-col">
              <span className="font-medium">
                {r.name} → {r.art ? artLabel(r.art) : m.rules_no_kind()}
              </span>
              <span className="text-muted">
                {Object.entries(r.bedingung)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}{" "}
                · {r.aktiv ? m.rules_active() : m.rules_inactive()}
              </span>
              {r.ordnung && <SuggestionOrder ordnung={r.ordnung} />}
            </span>
            {schreiben && (
              <button
                type="button"
                onClick={() => schalten.mutate({ id: r.id, aktiv: !r.aktiv })}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
              >
                {r.aktiv ? m.rules_disable() : m.rules_enable()}
              </button>
            )}
          </li>
        ))}
      </ul>
      {schreiben && (
        <Ausklappbar label={m.rules_create()} offen={offen} setOffen={setOffen}>
          <form onSubmit={absenden} className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3">
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.rules_name()}
              <input name="name" required className={feldKlasseRegel} />
            </label>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.rules_sender()}
              <input name="absender" type="email" className={feldKlasseRegel} />
            </label>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.rules_domain()}
              <input name="domain" className={feldKlasseRegel} />
            </label>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.rules_subject()}
              <input name="betreff" className={feldKlasseRegel} />
            </label>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.rules_attachment()}
              <input name="anhang" placeholder="application/pdf" className={feldKlasseRegel} />
            </label>
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.rules_then()}
              <select value={art} onChange={(e) => setArt(e.target.value as Art | "")} className={feldKlasseRegel}>
                <option value="">{m.rules_no_kind()}</option>
                {ARTEN.map((a) => (
                  <option key={a.art} value={a.art}>
                    {a.label()}
                  </option>
                ))}
              </select>
            </label>
            {!!korrespondenten.data?.length && (
              <label className="flex flex-col gap-1.5 font-medium text-sm">
                {m.rules_party()}
                <select name="korrespondent" className={feldKlasseRegel}>
                  <option value="">{m.order_party_none()}</option>
                  {korrespondenten.data.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!!typen.data?.length && (
              <label className="flex flex-col gap-1.5 font-medium text-sm">
                {m.rules_doctype()}
                <select name="dokumenttyp" className={feldKlasseRegel}>
                  <option value="">{m.order_doctype_none()}</option>
                  {typen.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!!felder.data?.length && (
              <fieldset className="col-span-full m-0 flex flex-col gap-2 border-0 p-0 text-sm">
                <legend className="mb-1.5 font-medium">{m.rules_fields()}</legend>
                {zeilen.map((z, i) => {
                  const feld = feldZu(z.feldId);
                  const vergeben = new Set(zeilen.filter((x) => x !== z).map((x) => x.feldId));
                  return (
                    <div key={z.schluessel} className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1.5 font-medium">
                        {m.rules_field_n({ nummer: String(i + 1) })}
                        <select
                          value={z.feldId}
                          onChange={(e) =>
                            setZeilen(zeilen.map((x) => (x === z ? { ...x, feldId: e.target.value } : x)))
                          }
                          className={feldKlasseRegel}
                        >
                          <option value="">{m.filter_field_none()}</option>
                          {felder.data.map((f) => (
                            <option key={f.id} value={f.id} disabled={vergeben.has(f.id)}>
                              {feldLabel(f)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {feld && (
                        <label htmlFor={`regel-wert-${z.schluessel}`} className="flex flex-col gap-1.5 font-medium">
                          {m.rules_field_value_n({ nummer: String(i + 1) })}
                          <FieldInput
                            key={feld.id}
                            id={`regel-wert-${z.schluessel}`}
                            feld={feld}
                            name={`wert-${z.schluessel}`}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => setZeilen(zeilen.filter((x) => x !== z))}
                        className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle"
                      >
                        {m.rules_field_remove({ nummer: String(i + 1) })}
                      </button>
                    </div>
                  );
                })}
                {zeilen.length < felder.data.length && (
                  <button
                    type="button"
                    onClick={() => {
                      setZeilen([...zeilen, { schluessel: naechste, feldId: "" }]);
                      setNaechste(naechste + 1);
                    }}
                    className="h-9 self-start rounded-md border border-border px-3 font-medium hover:bg-subtle"
                  >
                    {m.rules_field_add()}
                  </button>
                )}
              </fieldset>
            )}
            {!!tags.data?.length && (
              <fieldset className="col-span-full m-0 flex flex-wrap gap-3 border-0 p-0 text-sm">
                <legend className="mb-1.5 font-medium">{m.rules_tags()}</legend>
                {tags.data.map((t) => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input type="checkbox" name="tags" value={t.id} className="size-4" />
                    {t.name}
                  </label>
                ))}
              </fieldset>
            )}
            <button
              type="submit"
              className="col-span-full h-9 justify-self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm"
            >
              {m.rules_create()}
            </button>
          </form>
        </Ausklappbar>
      )}
      {ungueltig && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {feldLabel(ungueltig)}:{" "}
          {ungueltig.typ === "betrag" ? m.order_field_invalid_amount() : m.order_field_invalid()}
        </p>
      )}
      {(anlegen.error ?? schalten.error) && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.rules_failed({ meldung: (anlegen.error ?? schalten.error)!.message })}
        </p>
      )}
    </section>
  );
}
