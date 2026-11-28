import type { z } from "zod";
import type { Oeffnen, QuelleEingabe, Zugang } from "./abruf.ts";
import { type Abfragen, jmapPruefen } from "./jmap.ts";

/** Wie lange die Prüfung einer neuen Verbindung höchstens dauert, bevor sie mit „zeit“ abbricht */
export const PRUEF_ZEIT_MS = 15_000;

export type Grund = "anmeldung" | "server" | "ordner" | "zeit" | "unbekannt";
export type Pruefung = { ok: true } | { ok: false; grund: Grund; details: string };

/** Kurzer Satz je Grund für die Antwort der Schnittstelle */
export const GRUND_MELDUNG: Record<Grund, string> = {
  anmeldung: "Die Anmeldung beim Postfach ist fehlgeschlagen",
  server: "Der Server ist nicht erreichbar",
  ordner: "Den Ordner gibt es im Postfach nicht",
  zeit: "Der Server hat nicht rechtzeitig geantwortet",
  unbekannt: "Die Verbindung zum Postfach ist fehlgeschlagen",
};

// Fehlercodes aus Node (Socket, DNS) und imapflow (dist/esm/errors.js), die nach einem Server ohne Verbindung aussehen
const NICHT_ERREICHBAR = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "NoConnection",
  "EConnectionClosed",
  "ClosedAfterConnectText",
  "ClosedAfterConnectTLS",
]);
const ZEITUEBERSCHREITUNG = new Set([
  "ETIMEDOUT",
  "ETIMEOUT",
  "CONNECT_TIMEOUT",
  "GREETING_TIMEOUT",
  "UPGRADE_TIMEOUT",
]);
// TLS: Zertifikat abgelaufen, selbst signiert, falscher Name, falsches Protokoll
const TLS_FEHLER = /^(ERR_(TLS|SSL)|EPROTO|ETLS|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_)/;
const ORDNER_FEHLT =
  /nonexistent|doesn'?t exist|does not exist|no such mailbox|unknown mailbox|(folder|mailbox).*not (be )?found|^JMAP: Ordner/i;

type Fehlerform = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  authenticationFailed?: unknown;
  serverResponseCode?: unknown;
  responseText?: unknown;
};

/** Ordnet einen Fehler von imapflow, Node oder fetch einem Grund zu; liest nur Felder, gibt das Objekt nie weiter */
export function fehlerGrund(err: unknown): Grund {
  const e = (typeof err === "object" && err ? err : {}) as Fehlerform;
  // fetch verpackt den Socket-Fehler in cause
  const code = String(e.code ?? (e as { cause?: Fehlerform }).cause?.code ?? "");
  const antwort = String(e.serverResponseCode ?? "");
  const text = String(e.responseText ?? e.message ?? "");
  if (
    e.authenticationFailed ||
    /^AUTH(ENTICATION|ORIZATION)FAILED$/.test(antwort) ||
    /^JMAP: Antwort 40[13]$/.test(text)
  )
    return "anmeldung";
  if (antwort === "NONEXISTENT" || ORDNER_FEHLT.test(text)) return "ordner";
  if (ZEITUEBERSCHREITUNG.has(code) || e.name === "TimeoutError") return "zeit";
  if (NICHT_ERREICHBAR.has(code) || TLS_FEHLER.test(code) || /^JMAP: (Antwort \d+|Adresse auf fremdem)/.test(text))
    return "server";
  if (text === "fetch failed") return "server";
  return "unbekannt";
}

/** Feste Antwort, wenn der Text des Servers ein Geheimnis enthält; Teile davon zu schwärzen würde kurze Geheimnisse verraten */
export const GEHEIMNIS_MELDUNG = "Antwort des Servers enthielt Zugangsdaten und wurde entfernt";

/**
 * Formen, in denen ein Server ein Geheimnis zurückgeben kann: roh, IMAP-quoted (imapflow schickt \ und " escaped),
 * URL-kodiert, als latin1 gelesene UTF-8-Bytes (imapflow liest eine Zeile ohne Tag so) und Base64 in allen drei
 * Versätzen (PLAIN, Basic, XOAUTH2 und OAUTHBEARER setzen es mitten in eine Zeile); von den Base64-Zeichen bleiben nur
 * die, die allein vom Geheimnis abhängen. Ein einzelnes Ersatzzeichen wird über Buffer zu U+FFFD, wie es auch gespeichert wird.
 * shortcut: Kein Abgleich eines gekürzten Echos (Präfix); bei Bedarf Mindestlänge und Präfixvergleich ergänzen.
 */
function varianten(geheimnisse: string[]): string[] {
  const quoted = (s: string) => s.replace(/[\\"]/g, "\\$&");
  return geheimnisse.filter(Boolean).flatMap((g) => {
    const norm = Buffer.from(g).toString();
    const latin1 = Buffer.from(g).toString("latin1");
    const base64 = [0, 1, 2].map((i) => {
      const bytes = Buffer.from("x".repeat(i) + g);
      return bytes.toString("base64").slice(Math.ceil((i * 8) / 6), Math.floor((bytes.length * 8) / 6));
    });
    return [g, quoted(g), norm, quoted(norm), encodeURIComponent(norm), latin1, quoted(latin1), ...base64].filter(
      Boolean,
    );
  });
}

/** Nur der Text des Fehlers, auf 500 Zeichen gekürzt; enthält er ein Geheimnis in einer der Formen (ohne Groß-/Kleinschreibung), nur ein fester Satz */
export function bereinigen(err: unknown, geheimnisse: string[]): string {
  const e = (typeof err === "object" && err ? err : {}) as Fehlerform;
  const roh = String(e.responseText || e.message || err);
  const klein = roh.toLowerCase();
  return varianten(geheimnisse).some((v) => klein.includes(v.toLowerCase())) ? GEHEIMNIS_MELDUNG : roh.slice(0, 500);
}

/** Fester Satz für einen Fehler der eigenen Datenbank: Drizzle hängt Anweisung und Parameter (Token, Host, Benutzer, Hashes) an */
export const DATENBANK_MELDUNG = "Der Abruf ist an der Datenbank gescheitert";

/** Was am Postfach steht: bei erkanntem Grund nur der feste Satz, sonst nur err.message (nie die Rohantwort des Servers) */
export function abrufFehler(err: unknown, geheimnisse: string[]): string {
  const e = err as { message?: unknown; query?: unknown; params?: unknown } | null;
  if (String(e?.message).startsWith("Failed query") || (e?.query !== undefined && e?.params !== undefined))
    return DATENBANK_MELDUNG;
  const grund = fehlerGrund(err);
  if (grund !== "unbekannt") return GRUND_MELDUNG[grund];
  return bereinigen({ message: (err as Fehlerform | null)?.message ?? err }, geheimnisse);
}

/**
 * Prüft vor dem Speichern, ob die Verbindung steht. IMAP: anmelden und Ordner öffnen, dann die Ordnerliste. JMAP:
 * Sitzung, Ordnerliste, und der Ordner muss darunter sein. Nach zeitMs bricht sie mit „zeit“ ab; eine dann noch
 * aufgehende Verbindung wird geschlossen.
 */
export async function verbindungPruefen(
  eingabe: z.infer<typeof QuelleEingabe>,
  oeffnen: Oeffnen,
  { abfragen, zeitMs = PRUEF_ZEIT_MS }: { abfragen?: Abfragen; zeitMs?: number } = {},
): Promise<Pruefung> {
  const zugang: Zugang = {
    host: eingabe.host,
    port: eingabe.port,
    tls: eingabe.tls,
    benutzer: eingabe.benutzer,
    passwort: eingabe.passwort,
    ordner: eingabe.ordner,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<never>((_, nein) => {
    timer = setTimeout(() => nein(Object.assign(new Error("Zeitüberschreitung"), { code: "ETIMEOUT" })), zeitMs);
  });
  const lauf = async () => {
    if (eingabe.art === "jmap") {
      // Nach der Frist bricht der Abruf selbst ab. shortcut: IMAP hat kein Signal, imapflow läuft bis zu seinem socketTimeout weiter
      const signal = AbortSignal.timeout(zeitMs);
      const mitFrist: Abfragen = (url, init) => (abfragen ?? fetch)(url, { ...init, signal });
      if (!(await jmapPruefen(zugang, mitFrist))) throw new Error(`JMAP: Ordner ${zugang.ordner} nicht gefunden`);
      return;
    }
    const postfach = await oeffnen(zugang);
    try {
      await postfach.ordner?.();
    } finally {
      await postfach.schliessen().catch(() => {});
    }
  };
  const l = lauf();
  try {
    await Promise.race([l, frist]);
    return { ok: true };
  } catch (err) {
    // Ein nach der Frist noch öffnendes Postfach schließt sich selbst, sobald es da ist: lauf schließt im finally
    return { ok: false, grund: fehlerGrund(err), details: bereinigen(err, [eingabe.passwort]) };
  } finally {
    clearTimeout(timer);
    l.catch(() => {});
  }
}
