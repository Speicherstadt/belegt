import type { Angemeldet } from "../auth.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { VERSION } from "../http/gemeinsam.ts";
import { istWerkzeugFehler, WERKZEUGE } from "./werkzeuge.ts";

/**
 * Model Context Protocol über Streamable HTTP, zustandslos: jede Anfrage ist ein JSON-RPC-Aufruf per POST, die
 * Antwort kommt als JSON, ohne Sitzung und ohne Server-Sent Events. Unterstützt werden initialize, ping, tools/list
 * und tools/call (https://modelcontextprotocol.io/specification/2025-06-18).
 */

export const PROTOKOLLE = ["2025-06-18", "2025-03-26"];

interface Anfrage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Antwort =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const fehler = (id: Anfrage["id"], code: number, message: string): Antwort => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const ANWEISUNGEN =
  "Belegt ist ein Dokumentenarchiv mit GoBD-Modus. Originale sind unveränderbar; Löschen ist über diese Schnittstelle nicht möglich. Suche mit dokumente_suchen, lies mit dokument_lesen und dokument_text. Beträge sind in Cent.";

/** Die erlaubten Werkzeuge: ein lesendes Token sieht die schreibenden nicht */
const erlaubt = (nutzer: Angemeldet) =>
  WERKZEUGE.filter(
    (w) => !w.schreibt || (nutzer.token ? nutzer.token.recht === "schreiben" : nutzer.role === "inhaber"),
  );

/** Beantwortet eine Nachricht; null bei einer Benachrichtigung (ohne id), die keine Antwort bekommt */
export async function beantworten(umgebung: Umgebung, nutzer: Angemeldet, nachricht: unknown): Promise<Antwort | null> {
  if (Array.isArray(nachricht)) return fehler(null, -32600, "Stapel werden nicht unterstützt");
  const a = nachricht as Partial<Anfrage> | null;
  // MCP schließt null als ID aus, JSON-RPC erlaubt nur Text und Zahl
  const gueltig = typeof a?.id === "string" || typeof a?.id === "number";
  if (a?.jsonrpc !== "2.0" || typeof a.method !== "string")
    return fehler(gueltig ? a.id : null, -32600, "Ungültige Anfrage");
  if (a.id === undefined) return null;
  if (!gueltig) return fehler(null, -32600, "Ungültige ID");
  const id = a.id;

  switch (a.method) {
    case "initialize": {
      const gewuenscht = String(a.params?.protocolVersion ?? "");
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOKOLLE.includes(gewuenscht) ? gewuenscht : PROTOKOLLE[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "belegt", title: "Belegt", version: VERSION },
          instructions: ANWEISUNGEN,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: erlaubt(nutzer).map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations,
          })),
        },
      };
    case "tools/call": {
      const name = a.params?.name;
      const werkzeug = erlaubt(nutzer).find((w) => w.name === name);
      if (!werkzeug) return fehler(id, -32602, `Unbekanntes oder nicht erlaubtes Werkzeug: ${String(name)}`);
      const eingabe = werkzeug.eingabe.safeParse(a.params?.arguments ?? {});
      if (!eingabe.success) {
        const meldung = eingabe.error.issues.map((i) => `${i.path.join(".") || "Eingabe"}: ${i.message}`).join("; ");
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: meldung }], isError: true } };
      }
      try {
        const ergebnis = await werkzeug.ausfuehren(umgebung, nutzer, eingabe.data as never);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(ergebnis) }],
            // structuredContent muss ein Objekt sein; Listen kommen eingepackt
            structuredContent: Array.isArray(ergebnis) ? { ergebnis } : ergebnis,
          },
        };
      } catch (err) {
        // Unerwartete Fehler (etwa der Datenbank) nur ins Log; der Assistent bekommt eine Antwort ohne ihren Text
        if (!istWerkzeugFehler(err)) console.error(`MCP ${werkzeug.name}:`, err);
        const text = istWerkzeugFehler(err) ? err.message : "Interner Fehler; Einzelheiten stehen im Log des Servers";
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } };
      }
    }
    default:
      return fehler(id, -32601, `Unbekannte Methode: ${a.method}`);
  }
}
