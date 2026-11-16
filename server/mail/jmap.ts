import type { Ordner, Zugang } from "./abruf.ts";
import { papierkorbName } from "./papierkorb.ts";

/**
 * Abruf über JMAP (RFC 8620, RFC 8621), etwa von Stalwart. Beim ersten Abruf alle Mails des Ordners, danach nur, was
 * seit dem gemerkten Stand neu in den Ordner kam (Email/changes). Kann der Server das nicht mehr berechnen, holt Belegt
 * den Ordner neu; doppelte erkennt die Aufnahme am Hash. Anmeldung mit Basic (Benutzer und Passwort). Geschrieben wird
 * nur für die Aktionen nach dem Abholen (jmapBearbeiten).
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
interface Mailbox {
  id: string;
  name: string;
  role: string | null;
  parentId?: string | null;
}

/** Sitzung, Konto und Aufrufe an den eingetragenen Server; Zugangsdaten gehen an keinen anderen Host */
async function verbinden(zugang: Zugang, abfragen: Abfragen) {
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

  async function aufrufen(aufrufe: Aufruf[]): Promise<Record<string, Record<string, unknown>>> {
    const res = await holen(sitzung.apiUrl, {
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

  async function mailboxen(): Promise<Mailbox[]> {
    const { a } = await aufrufen([
      ["Mailbox/get", { accountId: konto, properties: ["name", "role", "parentId"] }, "a"],
    ]);
    return (a?.list as Mailbox[] | undefined) ?? [];
  }

  /** Ordner nach Name oder Rolle (INBOX ist die Rolle inbox) */
  const finden = (liste: Mailbox[], name: string) =>
    liste.find((m) => m.name === name || m.role === name.toLowerCase());

  async function laden(blobId: string) {
    const url = sitzung.downloadUrl
      .replace("{accountId}", encodeURIComponent(konto!))
      .replace("{blobId}", encodeURIComponent(blobId))
      .replace("{type}", encodeURIComponent("message/rfc822"))
      .replace("{name}", "mail.eml");
    return new Uint8Array(await (await holen(url)).arrayBuffer());
  }

  return { konto, aufrufen, mailboxen, finden, laden };
}

/** Holt neue Mails; aufnehmen bekommt Rohdaten und Email-ID. Gibt den neuen Stand zurück */
export async function jmapHolen(
  zugang: Zugang,
  stand: string | null,
  aufnehmen: (roh: Uint8Array, id: string) => Promise<void>,
  abfragen: Abfragen = fetch,
): Promise<string> {
  const { konto, aufrufen, mailboxen, finden, laden: blobLaden } = await verbinden(zugang, abfragen);
  const ordner = finden(await mailboxen(), zugang.ordner);
  if (!ordner) throw new Error(`JMAP: Ordner ${zugang.ordner} nicht gefunden`);

  async function laden(ids: string[]) {
    if (!ids.length) return;
    const { g } = await aufrufen([["Email/get", { accountId: konto, ids, properties: ["blobId", "mailboxIds"] }, "g"]]);
    for (const e of (g?.list as { id: string; blobId: string; mailboxIds: Record<string, boolean> }[] | undefined) ??
      []) {
      if (!e.mailboxIds?.[ordner!.id]) continue;
      await aufnehmen(await blobLaden(e.blobId), e.id);
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

/** Pfad einer Mailbox aus den Namen ihrer Eltern; Namen sind nur unter Geschwistern eindeutig (RFC 8621, 2) */
function pfadVon(liste: Mailbox[], m: Mailbox): string {
  const teile = [m.name];
  const gesehen = new Set([m.id]);
  for (let p = liste.find((x) => x.id === m.parentId); p && !gesehen.has(p.id); ) {
    gesehen.add(p.id);
    teile.unshift(p.name);
    const eltern = p.parentId;
    p = liste.find((x) => x.id === eltern);
  }
  return teile.join("/");
}

const ordnerVon =
  (liste: Mailbox[]) =>
  (m: Mailbox): Ordner => ({
    id: m.id,
    pfad: pfadVon(liste, m),
    papierkorb: m.role === "trash" || papierkorbName(m.name),
  });

/** Alle Ordner des Kontos mit Mailbox-ID und Pfad */
export async function jmapOrdner(zugang: Zugang, abfragen: Abfragen = fetch): Promise<Ordner[]> {
  const liste = await (await verbinden(zugang, abfragen)).mailboxen();
  return liste.map(ordnerVon(liste));
}

/**
 * Aktionen an Mails eines Ordners über Email/set (RFC 8621, 4.6): Schlüsselwörter $seen und $flagged setzen, den Ordner
 * in mailboxIds tauschen (andere Ordner der Mail bleiben); Löschen nimmt die Mail aus dem abgeholten Ordner und nur,
 * wenn sie in keinem anderen liegt, destroy. Jede Aktion wirft, wenn der Server sie ablehnt (notUpdated,
 * notDestroyed); mit dem Typ notFound, wenn es die Mail nicht mehr gibt.
 */
export async function jmapBearbeiten(zugang: Zugang, abfragen: Abfragen = fetch) {
  const { konto, aufrufen, mailboxen, finden, laden } = await verbinden(zugang, abfragen);
  const liste = await mailboxen();
  const quelle = finden(liste, zugang.ordner);
  if (!quelle) throw new Error(`JMAP: Ordner ${zugang.ordner} nicht gefunden`);

  /** Die Mail, wenn es sie gibt und sie noch im Ordner liegt */
  async function imOrdner(id: string) {
    const { g } = await aufrufen([
      ["Email/get", { accountId: konto, ids: [id], properties: ["blobId", "mailboxIds"] }, "g"],
    ]);
    const e = (g?.list as { id: string; blobId: string; mailboxIds: Record<string, boolean> }[] | undefined)?.find(
      (x) => x.id === id,
    );
    return e?.mailboxIds?.[quelle!.id] ? e : null;
  }

  async function setzen(antrag: Record<string, unknown>, id: string, feld: "notUpdated" | "notDestroyed") {
    const { s } = await aufrufen([["Email/set", { accountId: konto, ...antrag }, "s"]]);
    const abgelehnt = (s?.[feld] as Record<string, { type?: string; description?: string }> | undefined)?.[id];
    if (abgelehnt)
      throw Object.assign(new Error(`JMAP: ${abgelehnt.type ?? "abgelehnt"}`), { typ: abgelehnt.type ?? null });
  }
  const aendern = (id: string, patch: Record<string, unknown>) => setzen({ update: { [id]: patch } }, id, "notUpdated");

  return {
    /** Der Zielordner über die Mailbox-ID, null, wenn es ihn nicht gibt */
    ziel: (id: string) => {
      const m = liste.find((x) => x.id === id);
      return m ? ordnerVon(liste)(m) : null;
    },
    gibtEs: async (id: string) => Boolean(await imOrdner(id)),
    roh: async (id: string) => {
      const e = await imOrdner(id);
      return e ? laden(e.blobId) : null;
    },
    schluesselwort: (id: string, wort: "$seen" | "$flagged") => aendern(id, { [`keywords/${wort}`]: true }),
    verschieben: (id: string, zielId: string) =>
      aendern(id, { [`mailboxIds/${quelle.id}`]: null, [`mailboxIds/${zielId}`]: true }),
    // Liegt die Mail auch in anderen Ordnern (Labels), nimmt Belegt sie nur aus dem abgeholten; destroy träfe sie
    // überall. Liegt sie nur hier, geht das nicht (eine Email gehört zu mindestens einer Mailbox, RFC 8621, 4.1.1):
    // dann destroy
    loeschen: async (id: string) => {
      const e = await imOrdner(id);
      if (!e) throw Object.assign(new Error("JMAP: notFound"), { typ: "notFound" });
      const andere = Object.keys(e.mailboxIds).filter((m) => m !== quelle.id && e.mailboxIds[m]);
      if (andere.length) await aendern(id, { [`mailboxIds/${quelle.id}`]: null });
      else await setzen({ destroy: [id] }, id, "notDestroyed");
    },
  };
}
