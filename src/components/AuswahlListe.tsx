import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Minus, Plus } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { FARBEN, type Farbe } from "../../shared/ordnung.ts";
import { ApiFehler, api, type Eintrag, type OrdnungAenderung } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Was eine Liste an der Leiste der Auswahl setzt */
export type ListenArt = "tags" | "korrespondent" | "dokumenttyp";

type Zustand = "ja" | "teils" | "nein";

/** Ob alle, manche oder keine der gewählten Dokumente den Eintrag haben */
export function zustand(gewaehlt: Eintrag[], art: ListenArt, id: string | null): Zustand {
  const wert = (d: Eintrag) => (art === "korrespondent" ? d.korrespondent : d.dokumenttyp)?.id ?? null;
  const treffer = gewaehlt.filter((d) => (art === "tags" ? d.tags.some((t) => t.id === id) : wert(d) === id)).length;
  return treffer === 0 ? "nein" : treffer === gewaehlt.length ? "ja" : "teils";
}

const zeile =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none";

/**
 * Durchsuchbare Liste am Knopf der Leiste (wie Labels in Gmail oder Linear): Ein Klick setzt den Eintrag sofort für
 * alle gewählten Dokumente. Bei Tags zeigt das Kästchen, ob alle (✓), manche (–) oder keine ihn haben; ein Klick gibt
 * ihn allen, haben ihn schon alle, nimmt er ihn allen. Ein neuer Name legt den Tag an. Korrespondent und Typ gibt es
 * einmal je Dokument: der Klick setzt ihn und schließt die Liste.
 */
export function AuswahlListe({
  art,
  gewaehlt,
  schliessen,
}: {
  art: ListenArt;
  gewaehlt: Eintrag[];
  schliessen: () => void;
}) {
  const queryClient = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags, enabled: art === "tags" });
  const korrespondenten = useQuery({
    queryKey: ["korrespondenten"],
    queryFn: api.korrespondenten,
    enabled: art === "korrespondent",
  });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen, enabled: art === "dokumenttyp" });
  const eintraege = (art === "tags" ? tags.data : art === "korrespondent" ? korrespondenten.data : typen.data) ?? [];
  const [suche, setSuche] = useState("");
  const feld = useRef<HTMLInputElement>(null);
  useEffect(() => feld.current?.focus(), []);
  const ids = gewaehlt.map((d) => d.id);

  const setzen = useMutation({
    mutationFn: async (a: { id: string | null; neu?: string }) => {
      let id = a.id;
      if (a.neu) id = (await api.tagAnlegen({ name: a.neu, farbe: "grau" })).id;
      const aenderung: OrdnungAenderung =
        art === "tags"
          ? zustand(gewaehlt, art, id) === "ja"
            ? { tagsWeg: [id!] }
            : { tagsHinzu: [id!] }
          : { [art]: id };
      return api.sammeln(ids, aenderung);
    },
    onSuccess: async () => {
      setSuche("");
      await queryClient.invalidateQueries();
      if (art !== "tags") schliessen();
    },
  });

  const text = suche.trim().toLowerCase();
  const gefiltert = eintraege.filter((e) => e.name.toLowerCase().includes(text));
  const neu = art === "tags" && text && !eintraege.some((e) => e.name.toLowerCase() === text) ? suche.trim() : null;
  const keiner = art === "korrespondent" ? m.order_party_none() : m.order_doctype_none();
  const platzhalter =
    art === "tags" ? m.bulk_search_tags() : art === "korrespondent" ? m.bulk_search_party() : m.bulk_search_doctype();
  const fehler =
    setzen.error instanceof ApiFehler && setzen.error.ergebnis ? m.bulk_rolled_back() : setzen.error?.message;

  const eintrag = (id: string | null, name: string, farbe?: Farbe) => {
    const palette = farbe ? (FARBEN[farbe] ?? FARBEN.grau) : null;
    const z = zustand(gewaehlt, art, id);
    const Zeichen = z === "ja" ? Check : z === "teils" ? Minus : null;
    return (
      <li key={id ?? "ohne"}>
        <button
          type="button"
          aria-pressed={z === "teils" ? "mixed" : z === "ja"}
          disabled={setzen.isPending}
          onClick={() => setzen.mutate({ id })}
          className={zeile}
        >
          <span
            aria-hidden="true"
            className={`flex size-4 shrink-0 items-center justify-center ${art === "tags" ? "rounded-[4px] border border-border" : ""} ${z !== "nein" && art === "tags" ? "border-fg bg-fg text-bg" : ""}`}
          >
            {Zeichen && <Zeichen className="size-3" strokeWidth={3} />}
          </span>
          {/* Der Punkt wie in TagChip: hell die dunkle, dunkel die helle Farbe der Palette */}
          {palette && (
            <span
              aria-hidden="true"
              style={{ "--punkt-hell": palette.schrift, "--punkt-dunkel": palette.hintergrund } as CSSProperties}
              className="size-2 shrink-0 rounded-full bg-(--punkt-hell) dark:bg-(--punkt-dunkel)"
            />
          )}
          <span className="min-w-0 flex-1 truncate">{name}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={feld}
        type="search"
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (neu) setzen.mutate({ id: null, neu });
          else if (gefiltert.length === 1) setzen.mutate({ id: gefiltert[0]!.id });
        }}
        placeholder={platzhalter}
        aria-label={platzhalter}
        // Ersatz für den Ring wie beim Suchfeld des Archivs (DESIGN.md, Fokus): der Rand färbt sich
        className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm outline-hidden focus:border-fg"
      />
      <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0 pt-1">
        {art !== "tags" && !text && eintrag(null, keiner)}
        {gefiltert.map((e) => eintrag(e.id, e.name, "farbe" in e ? (e.farbe as Farbe) : undefined))}
        {neu && (
          <li>
            <button
              type="button"
              disabled={setzen.isPending}
              onClick={() => setzen.mutate({ id: null, neu })}
              className={zeile}
            >
              <Plus aria-hidden="true" className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{m.bulk_tag_create({ name: neu })}</span>
            </button>
          </li>
        )}
        {!gefiltert.length && !neu && <li className="px-2 py-1.5 text-muted text-sm">{m.bulk_nothing_found()}</li>}
      </ul>
      {fehler && (
        <p role="alert" className="m-0 px-2 text-red-700 text-sm dark:text-red-400">
          {fehler}
        </p>
      )}
    </div>
  );
}
