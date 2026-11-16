import { ImapFlow } from "imapflow";
import type { Bearbeiten, Oeffnen } from "./abruf.ts";

/**
 * Öffnet ein Postfach mit imapflow (wie Kontext). Zum Abholen nur lesend (EXAMINE): nichts wird als gelesen markiert
 * oder gelöscht. Mit schreiben (SELECT) für die Aktionen nach dem Abholen; jede läuft über die UID (imapflow-Doku:
 * messageFlagsAdd, messageMove, messageDelete mit `{ uid: true }`). Die Methoden geben bei Ablehnung false zurück, statt
 * zu werfen; das wird hier zum Fehler.
 */
export const imapOeffnen: Oeffnen = async (zugang) => {
  const client = new ImapFlow({
    host: zugang.host,
    port: zugang.port,
    secure: zugang.tls,
    auth: zugang.accessToken
      ? { user: zugang.benutzer, accessToken: zugang.accessToken }
      : { user: zugang.benutzer, pass: zugang.passwort },
    logger: false,
  });
  await client.connect();
  const postfach = await client.mailboxOpen(zugang.ordner, { readOnly: !zugang.schreiben });
  const pruefen = (ok: unknown, was: string) => {
    if (!ok) throw new Error(`IMAP: ${was} abgelehnt`);
  };
  // Ohne UIDPLUS (RFC 4315) schickt imapflow ein einfaches EXPUNGE, das alle als \Deleted markierten Mails des Ordners
  // entfernt, auch nie archivierte (imapflow commands/expunge.js); ohne MOVE (RFC 6851) gilt das auch fürs Verschieben
  // (commands/move.js: COPY und messageDelete). Dann lieber nichts tun.
  const nurDieseUid = (was: string, auchMitMove = false) => {
    if (client.capabilities.has("UIDPLUS") || (auchMitMove && client.capabilities.has("MOVE"))) return;
    throw new Error(
      `IMAP: ${was} abgelehnt, der Server kann kein UIDPLUS; es würde auch andere als gelöscht markierte Mails entfernen`,
    );
  };
  const bearbeiten: Bearbeiten = {
    async gibtEs(uid) {
      const treffer = await client.search({ uid: String(uid) }, { uid: true });
      return Array.isArray(treffer) && treffer.includes(uid);
    },
    async roh(uid) {
      const n = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      return n && n.uid === uid && n.source ? new Uint8Array(n.source) : null;
    },
    async flagge(uid, flagge) {
      pruefen(await client.messageFlagsAdd(String(uid), [flagge], { uid: true }), "Markieren");
    },
    async verschieben(uid, ziel) {
      nurDieseUid("Verschieben", true);
      pruefen(await client.messageMove(String(uid), ziel, { uid: true }), "Verschieben");
    },
    // \Deleted und UID EXPUNGE (RFC 4315): nur diese UID
    async loeschen(uid) {
      nurDieseUid("Löschen");
      pruefen(await client.messageDelete(String(uid), { uid: true }), "Löschen");
    },
  };
  return {
    uidValidity: Number(postfach.uidValidity),
    async *neue(seitUid: number) {
      // Ein UID-Bereich „n:*“ liefert immer die letzte Nachricht, auch wenn ihre UID kleiner ist; deshalb filtern
      for await (const n of client.fetch(`${seitUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (n.uid > seitUid && n.source) yield { uid: n.uid, roh: new Uint8Array(n.source) };
      }
    },
    async ordner() {
      return (await client.list()).map((o) => ({ id: o.path, pfad: o.path }));
    },
    ...(zugang.schreiben ? { bearbeiten } : {}),
    async schliessen() {
      await client.logout();
    },
  };
};
