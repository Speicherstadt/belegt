import { z } from "zod";

/**
 * Belegt in einem Frame einer anderen Seite (Portal, Mail-Oberfläche): nur wenn der Server diesen einen Origin nennt
 * (BELEGT_EMBED_ORIGIN, in /api/status), nur im Frame und nur mit ?embedded=1 auf der ersten Seite oder gemerkt für
 * diesen Frame. Nachrichten per postMessage nimmt Belegt nur vom Elternfenster unter diesem Origin an und schickt sie
 * nur dorthin.
 */

export const EINBETTEN_PARAM = "embedded";
const GEMERKT = "belegt.eingebettet";
const STILL_VERSUCHT = "belegt.still-angemeldet";

/** Was Belegt dem Elternfenster sagt */
export type Ausgehend =
  | { source: "belegt"; type: "ready" }
  | { source: "belegt"; type: "route"; path: string }
  | { source: "belegt"; type: "title"; title: string }
  | { source: "belegt"; type: "signed-out" };

const Eingehend = z.discriminatedUnion("type", [
  z.object({ type: z.literal("theme"), theme: z.enum(["light", "dark"]) }),
  z.object({ type: z.literal("navigate"), path: z.string().max(2000) }),
  z.object({ type: z.literal("logout") }),
]);
export type Eingehend = z.infer<typeof Eingehend>;

/** Eine Nachricht vom Elternfenster unter dem erwarteten Origin, sonst null */
export function nachrichtLesen(
  e: { origin: string; source: unknown; data: unknown },
  erwartet: { origin: string; parent: unknown },
): Eingehend | null {
  if (e.origin !== erwartet.origin || e.source !== erwartet.parent) return null;
  const n = Eingehend.safeParse(e.data);
  return n.success ? n.data : null;
}

const PROBE = "https://belegt.invalid";

/** Ein Pfad dieser App, nie eine andere Seite (auch nicht //fremd.example oder /\fremd.example); der URL-Parser entscheidet */
export function istAppPfad(pfad: string): boolean {
  if (!pfad.startsWith("/")) return false;
  try {
    return new URL(pfad, PROBE).origin === PROBE;
  } catch {
    return false;
  }
}

export function istEingebettet(f: {
  search: string;
  gemerkt: boolean;
  imFrame: boolean;
  embedOrigin: string | null | undefined;
}): boolean {
  return (
    Boolean(f.embedOrigin) && f.imFrame && (f.gemerkt || new URLSearchParams(f.search).get(EINBETTEN_PARAM) === "1")
  );
}

const speicher = {
  lesen: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  schreiben: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {}
  },
};

/** Ob diese Seite eingebettet läuft; merkt es sich für den Frame, damit Navigation ohne Parameter es behält */
export function eingebettet(embedOrigin: string | null | undefined): boolean {
  const aktiv = istEingebettet({
    search: window.location.search,
    gemerkt: speicher.lesen(GEMERKT) === "1",
    imFrame: window.parent !== window,
    embedOrigin,
  });
  if (aktiv) speicher.schreiben(GEMERKT, "1");
  return aktiv;
}

/** Einmal je Frame still anmelden (prompt=none); öffnet die Seite den Frame neu mit ?embedded=1, darf es wieder */
export function stillAnmeldenErlaubt(): boolean {
  const neu = new URLSearchParams(window.location.search).get(EINBETTEN_PARAM) === "1";
  if (!neu && speicher.lesen(STILL_VERSUCHT) === "1") return false;
  speicher.schreiben(STILL_VERSUCHT, "1");
  return true;
}

export function senden(origin: string, n: Ausgehend) {
  window.parent.postMessage(n, origin);
}
