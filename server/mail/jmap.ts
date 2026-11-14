import type { Zugang } from "./abruf.ts";

/**
 * Abruf über JMAP (RFC 8620, RFC 8621), etwa von Stalwart: nur lesend. Beim ersten Abruf alle Mails des Ordners, danach
 * nur, was seit dem gemerkten Stand neu in den Ordner kam (Email/changes). Kann der Server das nicht mehr berechnen,
 * holt Belegt den Ordner neu; doppelte erkennt die Aufnahme am Hash. Anmeldung mit Basic (Benutzer und Passwort).
 */

const MAIL = "urn:ietf:params:jmap:mail";
const KERN = "urn:ietf:params:jmap:core";
const SEITE = 100;

export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

interface Sitzung {
  apiUrl: string;
  downloadUrl: string;
  primaryAccounts: Record<string, string>;
}

type Aufruf = [string, Record<string, unknown>, string];

export async function jmapHolen(
  zugang: Zugang,
  stand: string | null,
  aufnehmen: (roh: Uint8Array) => Promise<void>,
  abfragen: Abfragen = fetch,
): Promise<string> {
  const basis = `${zugang.tls ? "https" : "http"}://${zugang.host}:${zugang.port}`;
  const kopf = {
    authorization: `Basic ${Buffer.from(`${zugang.benutzer}:${zugang.passwort}`).toString("base64")}`,
  };
  const herkunft = new URL(basis).origin;
  // Zugangsdaten gehen nur an den eingetragenen Server: Eine Sitzung, die auf einen anderen Host zeigt, wird abgelehnt
  const holen = async (adresse: string, init: RequestInit = {}) => {
    const url = new URL(adresse, basis);
    if (url.origin !== herkunft) throw new Error(`JMAP: Adresse auf fremdem Host ${url.host} abgelehnt`);
    const res = await abfragen(url.toString(), {
      ...init,
      headers: { ...kopf, ...(init.headers ?? {}) },
      redirect: "error",
    });
    if (!res.ok) throw new Error(`JMAP: Antwort ${res.status}`);
    return res;
  };
  const sitzung = (await (await holen(`${basis}/.well-known/jmap`)).json()) as Sitzung;
  const konto = sitzung.primaryAccounts?.[MAIL];
  if (!konto) throw new Error("JMAP: kein Konto für Mail");
  const api = sitzung.apiUrl;

  async function aufrufen(aufrufe: Aufruf[]): Promise<Record<string, Record<string, unknown>>> {
    const res = await holen(api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ using: [KERN, MAIL], methodCalls: aufrufe }),
    });
    const { methodResponses } = (await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] };
    const antworten: Record<string, Record<string, unknown>> = {};
    for (const [name, inhalt, id] of methodResponses) {
      // Ein Methodenfehler bricht ab, damit der Stand nicht über Mails hinweg vorrückt, die nie geholt wurden
      if (name === "error")
        throw Object.assign(new Error(`JMAP: ${String(inhalt.type ?? "Fehler")}`), { typ: inhalt.type });
      antworten[id] = inhalt;
    }
    return antworten;
  }

  // Ordner nach Name oder Rolle (INBOX ist die Rolle inbox)
  const { a: ordnerAntwort } = await aufrufen([
    ["Mailbox/get", { accountId: konto, properties: ["name", "role"] }, "a"],
  ]);
  const ordner = (ordnerAntwort?.list as { id: string; name: string; role: string | null }[] | undefined)?.find(
    (m) => m.name === zugang.ordner || m.role === zugang.ordner.toLowerCase(),
  );
  if (!ordner) throw new Error(`JMAP: Ordner ${zugang.ordner} nicht gefunden`);

  async function laden(ids: string[]) {
    if (!ids.length) return;
    const { g } = await aufrufen([["Email/get", { accountId: konto, ids, properties: ["blobId", "mailboxIds"] }, "g"]]);
    for (const e of (g?.list as { blobId: string; mailboxIds: Record<string, boolean> }[] | undefined) ?? []) {
      if (!e.mailboxIds?.[ordner!.id]) continue;
      const url = sitzung.downloadUrl
        .replace("{accountId}", encodeURIComponent(konto!))
        .replace("{blobId}", encodeURIComponent(e.blobId))
        .replace("{type}", encodeURIComponent("message/rfc822"))
        .replace("{name}", "mail.eml");
      await aufnehmen(new Uint8Array(await (await holen(url)).arrayBuffer()));
    }
  }

  async function alles(): Promise<string> {
    // Den Stand zuerst: Was während des Abrufs dazukommt, liefert der nächste Abruf über Email/changes
    const { s } = await aufrufen([["Email/get", { accountId: konto, ids: [] }, "s"]]);
    const neuerStand = String(s?.state ?? "");
    for (let position = 0; ; ) {
      const { q } = await aufrufen([
        [
          "Email/query",
          {
            accountId: konto,
            filter: { inMailbox: ordner!.id },
            sort: [{ property: "receivedAt", isAscending: true }],
            position,
            limit: SEITE,
          },
          "q",
        ],
      ]);
      const ids = (q?.ids as string[] | undefined) ?? [];
      await laden(ids);
      // Der Server darf kürzere Seiten liefern als erbeten (RFC 8620, 5.5); fertig erst ohne weitere Ids
      position += ids.length;
      if (!ids.length || (typeof q?.total === "number" && position >= q.total)) return neuerStand;
    }
  }

  if (!stand) return alles();
  let jetzt = stand;
  for (;;) {
    // Höchstens eine Seite Änderungen, damit das folgende Email/get unter maxObjectsInGet des Servers bleibt
    const { c } = await aufrufen([
      ["Email/changes", { accountId: konto, sinceState: jetzt, maxChanges: SEITE }, "c"],
    ]).catch((err: Error & { typ?: string }) => {
      if (err.typ === "cannotCalculateChanges") return { c: null };
      throw err;
    });
    if (!c) return alles();
    // Neu angelegt oder in den Ordner verschoben
    await laden([...((c?.created as string[]) ?? []), ...((c?.updated as string[]) ?? [])]);
    jetzt = String(c?.newState ?? jetzt);
    if (!c?.hasMoreChanges) return jetzt;
  }
}
