import type { SammelErgebnis } from "./api-ordnung.ts";

/* Aufrufe der Schnittstelle (docs/api.md); Cookies der Sitzung schickt der Browser mit. Die Bereiche stehen in
 * api-zugang.ts, api-dokumente.ts, api-ordnung.ts und api-betrieb.ts, zusammen in api.ts. */

export class ApiFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Antwort der Sammelbearbeitung bei 409: das Ergebnis je Dokument */
    readonly ergebnis?: { ok: boolean; ergebnisse: SammelErgebnis[] },
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
    let meldung = text;
    let ergebnis: ApiFehler["ergebnis"];
    try {
      const json = JSON.parse(text) as {
        fehler?: string;
        message?: string;
        ok?: boolean;
        ergebnisse?: SammelErgebnis[];
      };
      meldung = json.fehler ?? json.message ?? text;
      if (json.ergebnisse) ergebnis = { ok: false, ergebnisse: json.ergebnisse };
    } catch {}
    throw new ApiFehler(res.status, meldung, ergebnis);
  }
  return res;
}

export const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
