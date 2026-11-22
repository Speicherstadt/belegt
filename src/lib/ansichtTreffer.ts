import { useQuery } from "@tanstack/react-query";
import { ansichtAus } from "../../shared/archivansicht.ts";
import { api, type GespeicherteAnsicht } from "./api.ts";
import { filterParameter } from "./ordnung.ts";

/**
 * Die ersten Treffer einer gespeicherten Ansicht und ihre Gesamtzahl. Startseite und Seitenleiste fragen dasselbe ab
 * und teilen sich so den Cache: eine Anfrage je Ansicht
 */
export function useAnsichtTreffer(ansicht: GespeicherteAnsicht) {
  const a = ansichtAus(ansicht.parameter);
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder, enabled: !!a.feld });
  const parameter = filterParameter(a, felder.data ?? []);
  return useQuery({
    queryKey: ["dokumente", a.suche, a.gruppe, parameter, 1, 5, a.sortierung],
    queryFn: () => api.dokumente(a.suche, a.gruppe, parameter, 1, 5, a.sortierung),
    enabled: !a.feld || !!felder.data,
  });
}
