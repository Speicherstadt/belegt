import type { SammelErgebnis } from "./api-ordnung.ts";

/* Aufrufe der Schnittstelle (docs/api.md); Cookies der Sitzung schickt der Browser mit. Die Bereiche stehen in
 * api-zugang.ts, api-dokumente.ts, api-ordnung.ts und api-betrieb.ts, zusammen in api.ts. */

export class ApiFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Antwort der Sammelbearbeitung bei 409: das Ergebnis je Dokument */
    readonly ergebnis?: { ok: boolean; ergebnisse: SammelErgebnis[] },
    /** Beim Hochladen 409: das Dokument mit derselben Datei (id und asn null, wenn der Zugang es nicht sieht) */
    readonly vorhanden?: { id: string | null; asn: number | null },
    /** true, wenn die Antwort kein JSON mit fehler/message war (HTML, Klartext, leer: oft ein Proxy) */
    readonly ohneHinweis?: boolean,
    /** Beim Anlegen eines Postfachs: woran die Prüfung scheiterte; fehlt er, gilt unbekannt */
    readonly grund?: "anmeldung" | "server" | "ordner" | "zeit" | "unbekannt",
    /** Rohtext des Servers (ohne Passwort), nur eingeklappt zu zeigen */
    readonly details?: string,
    /** Bei 400 (Zod): das Feld, auf das der erste Fehler zeigt (erstes Pfadstück) */
    readonly feld?: string,
  ) {
    super(message);
  }
}

export async function aufruf<T>(pfad: string, init?: RequestInit): Promise<T> {
  return (await antwort(pfad, init)).json() as Promise<T>;
}

/** Die Antwort mit Kopfzeilen; Fehler wie bei aufruf */
export async function antwort(pfad: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(pfad, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const text = await res.text();
    // HTML eines Proxys gehört nicht in eine Meldung: dann nur der Status
    let meldung = text.trimStart().startsWith("<") ? `${res.status} ${res.statusText}`.trim() : text;
    let ergebnis: ApiFehler["ergebnis"];
    let vorhanden: ApiFehler["vorhanden"];
    let ohneHinweis = true;
    let grund: ApiFehler["grund"];
    let details: string | undefined;
    let feld: string | undefined;
    try {
      const json = JSON.parse(text) as {
        fehler?: string;
        message?: string;
        ok?: boolean;
        ergebnisse?: SammelErgebnis[];
        vorhanden?: ApiFehler["vorhanden"];
        grund?: ApiFehler["grund"];
        details?: unknown;
      };
      ohneHinweis = (json.fehler ?? json.message) == null;
      meldung = json.fehler ?? json.message ?? meldung;
      if (json.ergebnisse) ergebnis = { ok: false, ergebnisse: json.ergebnisse };
      vorhanden = json.vorhanden;
      grund = json.grund;
      // Bei 400 ist details die Liste der Zod-Issues: eine lesbare Zeile, nie das Array
      const d = json.details;
      const erster = Array.isArray(d) ? (d[0] as { message?: string; path?: unknown[] } | undefined) : undefined;
      details = typeof d === "string" ? d : erster?.message;
      if (typeof erster?.path?.[0] === "string") feld = erster.path[0];
    } catch {}
    throw new ApiFehler(res.status, meldung, ergebnis, vorhanden, ohneHinweis, grund, details, feld);
  }
  return res;
}

export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
