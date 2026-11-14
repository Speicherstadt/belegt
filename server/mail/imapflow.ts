import { ImapFlow } from "imapflow";
import type { Oeffnen } from "./abruf.ts";

/** Öffnet ein Postfach mit imapflow (wie Kontext); nur lesend, nichts wird als gelesen markiert oder gelöscht */
export const imapOeffnen: Oeffnen = async (zugang) => {
  const client = new ImapFlow({
    host: zugang.host,
    port: zugang.port,
    secure: zugang.tls,
    auth: { user: zugang.benutzer, pass: zugang.passwort },
    logger: false,
  });
  await client.connect();
  const postfach = await client.mailboxOpen(zugang.ordner, { readOnly: true });
  return {
    uidValidity: Number(postfach.uidValidity),
    async *neue(seitUid: number) {
      // Ein UID-Bereich „n:*“ liefert immer die letzte Nachricht, auch wenn ihre UID kleiner ist; deshalb filtern
      for await (const n of client.fetch(`${seitUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (n.uid > seitUid && n.source) yield { uid: n.uid, roh: new Uint8Array(n.source) };
      }
    },
    async schliessen() {
      await client.logout();
    },
  };
};
