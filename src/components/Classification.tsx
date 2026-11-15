import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { type Art, api, type Einordnung, type OrdnungsVorschlag } from "../lib/api.ts";
import { ARTEN, artLabel } from "../lib/arten.ts";
import { tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { LearnedSuggestion, RuleMatchSuggestion } from "./MatchSuggestions.tsx";
import { alsAenderung, SuggestionOrder } from "./SuggestionOrder.tsx";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Einordnung eines Dokuments: aktueller Stand und, für den Inhaber, das Formular für eine neue Version */
export function Classification({
  dokumentId,
  einordnung,
  eingang,
  dokumenttyp,
  korrespondent,
}: {
  dokumentId: string;
  einordnung: Einordnung | null;
  eingang: string;
  /** Dokumenttyp mit Vorgabe-Art: ein Vorschlag, die Art bleibt maßgeblich für die Frist */
  dokumenttyp?: { name: string; vorgabeArt: Art | null } | null;
  /** Korrespondent aus der Liste; das Formular nimmt seinen heutigen Namen */
  korrespondent?: { id: string; name: string } | null;
}) {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState(!einordnung);
  const [art, setArt] = useState<Art>(einordnung?.art ?? dokumenttyp?.vorgabeArt ?? "beleg");
  // Angaben aus einer erkannten E-Rechnung; das Formular übernimmt sie beim Klick auf „Übernehmen“
  const [vorgabe, setVorgabe] = useState<{ entstanden?: string; titel?: string; korrespondent?: string } | null>(null);
  const vorschlag = useQuery({
    queryKey: ["vorschlag", dokumentId],
    queryFn: () => api.vorschlag(dokumentId),
    // Vorschläge gibt es nur für den, der einordnen darf
    enabled: !einordnung && ich.data?.role === "inhaber",
  });
  // Vorhandene Korrespondenten zur Auswahl; ein neuer Name legt beim Einordnen einen an
  const korrespondenten = useQuery({
    queryKey: ["korrespondenten"],
    queryFn: api.korrespondenten,
    enabled: darfSchreiben(ich.data?.role),
  });
  const speichern = useMutation({
    mutationFn: (eingabe: Parameters<typeof api.einordnen>[1]) => api.einordnen(dokumentId, eingabe),
    onSuccess: async () => {
      setOffen(false);
      await queryClient.invalidateQueries();
    },
  });

  // Tags, Dokumenttyp und Feldwerte eines Vorschlags sind Metadaten: Übernehmen setzt sie sofort, die Art erst beim Einordnen
  const ordnen = useMutation({
    mutationFn: (o: OrdnungsVorschlag) => api.ordnen(dokumentId, alsAenderung(o)),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dokument", dokumentId] }),
        queryClient.invalidateQueries({ queryKey: ["verlauf", dokumentId] }),
      ]),
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    speichern.mutate({
      art,
      entstanden: String(f.get("entstanden")),
      freiwilligBis: text("freiwilligBis"),
      titel: text("titel"),
      korrespondent: text("korrespondent"),
    });
  }

  return (
    <section aria-labelledby="einordnung" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="einordnung" className="m-0 font-semibold text-base">
        {m.classify_title()}
      </h2>
      {einordnung ? (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{m.classify_kind()}</dt>
          <dd className="m-0 font-medium">{artLabel(einordnung.art)}</dd>
          <dt className="text-muted">{m.classify_created()}</dt>
          <dd className="m-0">{tag(einordnung.entstanden)}</dd>
          <dt className="text-muted">{m.classify_period()}</dt>
          <dd className="m-0">
            {einordnung.fristBis ? m.retention_until({ datum: tag(einordnung.fristBis) }) : m.classify_until_free()}
          </dd>
        </dl>
      ) : (
        <p className="m-0 text-muted text-sm">{m.classify_none()}</p>
      )}
      {darfSchreiben(ich.data?.role) && !offen && (
        <button
          type="button"
          onClick={() => setOffen(true)}
          className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
        >
          {m.classify_change()}
        </button>
      )}
      {darfSchreiben(ich.data?.role) && offen && dokumenttyp?.vorgabeArt && (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle p-2 text-sm">
          {m.suggest_doctype({ art: artLabel(dokumenttyp.vorgabeArt), typ: dokumenttyp.name })}
          <button
            type="button"
            onClick={() => setArt(dokumenttyp.vorgabeArt!)}
            className="h-8 rounded-md border border-border bg-bg px-3 font-medium"
          >
            {m.suggest_apply()}
          </button>
        </p>
      )}
      {darfSchreiben(ich.data?.role) && offen && vorschlag.data?.vorschlag && (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle p-2 text-sm">
          {vorschlag.data.vorschlag.art
            ? m.suggest_label({
                art: artLabel(vorschlag.data.vorschlag.art),
                regel: vorschlag.data.vorschlag.regel.name,
              })
            : m.suggest_label_order({ regel: vorschlag.data.vorschlag.regel.name })}
          {vorschlag.data.vorschlag.ordnung && <SuggestionOrder ordnung={vorschlag.data.vorschlag.ordnung} />}
          <button
            type="button"
            onClick={() => {
              const v = vorschlag.data!.vorschlag!;
              // Ohne Art setzt die Regel nur die Ordnung; die Einordnung bleibt offen
              if (v.art) setArt(v.art);
              if (v.ordnung) ordnen.mutate(v.ordnung);
            }}
            className="h-8 rounded-md border border-border bg-bg px-3 font-medium"
          >
            {m.suggest_apply()}
          </button>
        </p>
      )}
      {darfSchreiben(ich.data?.role) && offen && vorschlag.data?.zuordnung && (
        <RuleMatchSuggestion zuordnung={vorschlag.data.zuordnung} onUebernehmen={(o) => ordnen.mutate(o)} />
      )}
      {darfSchreiben(ich.data?.role) && offen && vorschlag.data?.gelernt && (
        <LearnedSuggestion gelernt={vorschlag.data.gelernt} onArt={setArt} onOrdnung={(o) => ordnen.mutate(o)} />
      )}
      {darfSchreiben(ich.data?.role) && offen && vorschlag.data?.erechnung && !vorgabe && (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle p-2 text-sm">
          {m.suggest_einvoice({
            nummer: vorschlag.data.erechnung.nummer ?? "–",
            verkaeufer: vorschlag.data.erechnung.verkaeufer ?? "–",
          })}
          <button
            type="button"
            onClick={() => {
              const r = vorschlag.data!.erechnung!;
              setArt(vorschlag.data!.vorschlag?.art ?? "beleg");
              setVorgabe({
                entstanden: r.datum ?? undefined,
                titel: r.nummer ? m.suggest_einvoice_title({ nummer: r.nummer }) : undefined,
                korrespondent: r.verkaeufer ?? undefined,
              });
            }}
            className="h-8 rounded-md border border-border bg-bg px-3 font-medium"
          >
            {m.suggest_apply()}
          </button>
        </p>
      )}
      {darfSchreiben(ich.data?.role) && offen && vorschlag.data?.import && !vorgabe && (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle p-2 text-sm">
          {m.suggest_import({
            herkunft: vorschlag.data.import.herkunft,
            angaben: [
              vorschlag.data.import.titel,
              vorschlag.data.import.korrespondent,
              vorschlag.data.import.entstanden && tag(vorschlag.data.import.entstanden),
            ]
              .filter(Boolean)
              .join(" · "),
          })}
          <button
            type="button"
            onClick={() => {
              const i = vorschlag.data!.import!;
              setVorgabe({
                entstanden: i.entstanden ?? undefined,
                titel: i.titel ?? undefined,
                korrespondent: i.korrespondent ?? undefined,
              });
            }}
            className="h-8 rounded-md border border-border bg-bg px-3 font-medium"
          >
            {m.suggest_apply()}
          </button>
        </p>
      )}
      {darfSchreiben(ich.data?.role) && offen && vorschlag.data?.ki && !vorgabe && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-subtle p-2 text-sm">
          <p className="m-0">
            {m.suggest_ki({ art: artLabel(vorschlag.data.ki.art), modell: vorschlag.data.ki.modell })}{" "}
            <span className="text-muted">{vorschlag.data.ki.begruendung}</span>
          </p>
          {vorschlag.data.ki.ordnung && <SuggestionOrder ordnung={vorschlag.data.ki.ordnung} />}
          <button
            type="button"
            onClick={() => {
              const k = vorschlag.data!.ki!;
              setArt(k.art);
              if (k.ordnung) ordnen.mutate(k.ordnung);
              setVorgabe({
                entstanden: k.entstanden ?? undefined,
                titel: k.titel ?? undefined,
                korrespondent: k.korrespondent ?? undefined,
              });
            }}
            className="h-8 self-start rounded-md border border-border bg-bg px-3 font-medium"
          >
            {m.suggest_apply()}
          </button>
        </div>
      )}
      {darfSchreiben(ich.data?.role) && offen && (
        <form
          key={`${JSON.stringify(vorgabe)}:${korrespondent?.id ?? ""}`}
          onSubmit={absenden}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_kind()}
            <select value={art} onChange={(e) => setArt(e.target.value as Art)} className={feld}>
              {ARTEN.map((a) => (
                <option key={a.art} value={a.art}>
                  {a.label()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_created()}
            <input
              name="entstanden"
              type="date"
              required
              defaultValue={vorgabe?.entstanden ?? einordnung?.entstanden ?? eingang.slice(0, 10)}
              className={feld}
            />
          </label>
          {art === "freiwillig" && (
            <label className="flex flex-col gap-1.5 font-medium text-sm">
              {m.classify_voluntary_until()}
              <input
                name="freiwilligBis"
                type="date"
                required
                defaultValue={einordnung?.art === "freiwillig" ? (einordnung.fristBis ?? "") : ""}
                className={feld}
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_label()}
            <input name="titel" defaultValue={vorgabe?.titel ?? einordnung?.titel ?? ""} className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.classify_party()}
            <input
              name="korrespondent"
              list="korrespondenten-liste"
              maxLength={300}
              defaultValue={vorgabe?.korrespondent ?? korrespondent?.name ?? einordnung?.korrespondent ?? ""}
              className={feld}
            />
            <datalist id="korrespondenten-liste">
              {korrespondenten.data?.map((k) => (
                <option key={k.id} value={k.name} />
              ))}
            </datalist>
          </label>
          {einordnung && <p className="m-0 text-muted text-xs">{m.classify_hint()}</p>}
          {ordnen.error && (
            <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
              {m.order_failed({ meldung: ordnen.error.message })}
            </p>
          )}
          {speichern.error && (
            <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
              {m.classify_failed({ meldung: speichern.error.message })}
            </p>
          )}
          <button
            type="submit"
            disabled={speichern.isPending}
            className="h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
          >
            {m.classify_submit()}
          </button>
        </form>
      )}
    </section>
  );
}
