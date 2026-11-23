import type { Eintrag, Gruppe } from "../lib/api.ts";
import { type Aufnahme, GRUPPEN, schluessel } from "./aufnahme.ts";

/*
 * Der Server der Demo in der Seite (docs/entwicklung.md, Demo): beantwortet die Anfragen der App an /api aus der
 * Aufnahme. Die Liste der Dokumente filtert, sortiert und blättert er selbst; was die Aufnahme nicht kennt, ist 404,
 * und was schreibt, lehnt er mit einem Hinweis ab (403).
 */

const json = (status: number, body: unknown, kopf: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...kopf } });

/** Einfache Suche: jedes Wort kommt in Titel, Dateiname, Korrespondent, Typ oder einem Tag vor */
function passtZurSuche(e: Eintrag, suche: string): boolean {
  const text = [e.titel, e.dateiname, e.korrespondent?.name, e.dokumenttyp?.name, ...e.tags.map((t) => t.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return suche
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w.replace(/^"|"$/g, "")));
}

function passtZumFilter(e: Eintrag, p: URLSearchParams): boolean {
  const tags = e.tags.map((t) => t.id);
  const gewaehlt = p.getAll("tag");
  if (gewaehlt.length) {
    const treffer = gewaehlt.filter((t) => tags.includes(t)).length;
    if (p.get("tagModus") === "einer" ? treffer === 0 : treffer < gewaehlt.length) return false;
  }
  if (p.getAll("tagNicht").some((t) => tags.includes(t))) return false;
  if (p.get("ohneTags") === "1" && tags.length) return false;
  const typ = p.get("dokumenttyp");
  if (typ && e.dokumenttyp?.id !== typ) return false;
  const korrespondent = p.get("korrespondent");
  if (korrespondent === "ohne" && e.korrespondent) return false;
  if (korrespondent && korrespondent !== "ohne" && e.korrespondent?.id !== korrespondent) return false;
  return true;
}

const SORTIERT: Record<string, (a: Eintrag, b: Eintrag) => number> = {
  neu: (a, b) => b.asn - a.asn,
  alt: (a, b) => a.asn - b.asn,
  titel: (a, b) => (a.titel ?? a.dateiname ?? "").localeCompare(b.titel ?? b.dateiname ?? ""),
  frist: (a, b) => (a.fristBis ?? "9999").localeCompare(b.fristBis ?? "9999"),
};

/** GET /api/dokumente wie der Server: eine Seite der Treffer, die Gesamtzahl in X-Gesamt */
export function liste(aufnahme: Aufnahme, p: URLSearchParams): Response {
  const gruppe = (GRUPPEN as string[]).includes(p.get("gruppe") ?? "") ? (p.get("gruppe") as Gruppe) : "alle";
  const suche = p.get("suche") ?? "";
  const treffer = (aufnahme.listen[gruppe] ?? [])
    .filter((e) => passtZurSuche(e, suche) && passtZumFilter(e, p))
    .sort(SORTIERT[p.get("sortierung") ?? "neu"] ?? SORTIERT.neu);
  const proSeite = Math.min(Math.max(Number(p.get("proSeite") ?? p.get("limit") ?? 50) || 50, 1), 200);
  const seite = Math.max(Number(p.get("seite") ?? 1) || 1, 1);
  return json(200, treffer.slice((seite - 1) * proSeite, seite * proSeite), { "x-gesamt": String(treffer.length) });
}

export interface DemoServer {
  /** Antwort auf eine Anfrage an /api; dateiAdresse(datei) ist die Adresse einer aufgenommenen Datei */
  beantworten(methode: string, url: URL): Promise<Response>;
  /** Wohin ein Link oder Bild auf /api in der Demo zeigt: die aufgenommene Datei, sonst die Adresse selbst */
  adresse(pfad: string): string;
}

export function demoServer(
  aufnahme: Aufnahme,
  dateiAdresse: (datei: string) => string,
  nichtMoeglich: () => string,
): DemoServer {
  const finden = (url: URL) => aufnahme.antworten[schluessel(url.pathname, url.search)];
  return {
    async beantworten(methode, url) {
      if (methode !== "GET" && methode !== "HEAD") return json(403, { fehler: nichtMoeglich() });
      if (url.pathname === "/api/dokumente") return liste(aufnahme, url.searchParams);
      const a = finden(url);
      if (!a) return json(404, { fehler: nichtMoeglich() });
      if ("datei" in a) {
        const res = await fetch(dateiAdresse(a.datei));
        return new Response(await res.blob(), { status: a.status, headers: { "content-type": a.typ } });
      }
      return json(a.status, a.json);
    },
    adresse(pfad) {
      const a = finden(new URL(pfad, "http://demo"));
      return a && "datei" in a ? dateiAdresse(a.datei) : pfad;
    },
  };
}
