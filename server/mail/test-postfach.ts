import type { Oeffnen } from "./abruf.ts";

/*
 * Nachgebauter IMAP-Server für Tests der Aktionen nach dem Abholen: je Benutzer ein Konto mit Ordnern, je Ordner
 * UIDVALIDITY, Mails mit UID und Flaggen. Verhält sich wie RFC 3501 dort, wo Belegt sich darauf verlässt: UIDs steigen,
 * ein Verschieben gibt der Mail im Ziel eine neue UID, nach dem Löschen gibt es die UID nicht mehr.
 */

interface Mail {
  roh: Uint8Array;
  flaggen: Set<string>;
}
interface Ordner {
  uidValidity: number;
  naechste: number;
  mails: Map<number, Mail>;
}
export interface Konto {
  ordner: Map<string, Ordner>;
  /** Jede schreibende Aktion, in der Reihenfolge */
  aufrufe: string[];
  /** Öffnen zum Schreiben schlägt so oft fehl (Verbindung bricht ab) */
  schreibenFehler: number;
  /** Die nächste Aktion schlägt fehl, nachdem der Server sie ausgeführt hat (Verbindung bricht danach ab) */
  abbruchNachAktion: boolean;
}

export const mailRoh = (n: number, kennung = "imap") =>
  new TextEncoder().encode(
    [
      "From: kunde@kunde.de",
      "To: anna@example.org",
      `Subject: ${kennung} ${n}`,
      `Message-ID: <${kennung}-${n}@kunde.de>`,
      "",
      `Text ${n}`,
    ].join("\r\n"),
  );

export function testPostfaecher() {
  const konten = new Map<string, Konto>();
  const neuerOrdner = (uidValidity = 1): Ordner => ({ uidValidity, naechste: 1, mails: new Map() });
  const konto = (benutzer: string) => {
    let k = konten.get(benutzer);
    if (!k) {
      k = {
        ordner: new Map([["INBOX", neuerOrdner()]]),
        aufrufe: [],
        schreibenFehler: 0,
        abbruchNachAktion: false,
      };
      konten.set(benutzer, k);
    }
    return k;
  };
  /** Legt eine Mail in einen Ordner und gibt ihre UID zurück */
  const einliefern = (benutzer: string, roh: Uint8Array, ordner = "INBOX") => {
    const o = konto(benutzer).ordner.get(ordner)!;
    const uid = o.naechste++;
    o.mails.set(uid, { roh, flaggen: new Set() });
    return uid;
  };
  /** Nummeriert einen Ordner neu (neue UIDVALIDITY), die Mails bleiben in ihrer Reihenfolge */
  const neuNummerieren = (benutzer: string, ordner = "INBOX") => {
    const alt = konto(benutzer).ordner.get(ordner)!;
    const neu = neuerOrdner(alt.uidValidity + 1);
    for (const m of alt.mails.values()) neu.mails.set(neu.naechste++, m);
    konto(benutzer).ordner.set(ordner, neu);
  };

  const oeffnen: Oeffnen = async (zugang) => {
    const k = konto(zugang.benutzer);
    if (zugang.schreiben && k.schreibenFehler > 0) {
      k.schreibenFehler--;
      throw new Error("Verbindung abgebrochen");
    }
    const o = k.ordner.get(zugang.ordner);
    if (!o) throw new Error(`Ordner ${zugang.ordner} gibt es nicht`);
    const mail = (uid: number) => {
      const m = o.mails.get(uid);
      if (!m) throw new Error(`UID ${uid} gibt es nicht`);
      return m;
    };
    const schreiben = async (beschreibung: string, tun: () => void) => {
      tun();
      k.aufrufe.push(beschreibung);
      if (k.abbruchNachAktion) {
        k.abbruchNachAktion = false;
        throw new Error("Verbindung abgebrochen");
      }
    };
    return {
      uidValidity: o.uidValidity,
      async *neue(seit) {
        for (const [uid, m] of [...o.mails].sort(([a], [b]) => a - b)) if (uid > seit) yield { uid, roh: m.roh };
      },
      async ordner() {
        return [...k.ordner.keys()];
      },
      async schliessen() {},
      ...(zugang.schreiben
        ? {
            bearbeiten: {
              gibtEs: async (uid) => o.mails.has(uid),
              roh: async (uid) => o.mails.get(uid)?.roh ?? null,
              flagge: (uid, flagge) => schreiben(`flagge ${uid} ${flagge}`, () => mail(uid).flaggen.add(flagge)),
              verschieben: (uid, ziel) =>
                schreiben(`verschieben ${uid} ${ziel}`, () => {
                  const z = k.ordner.get(ziel);
                  if (!z) throw new Error(`Ordner ${ziel} gibt es nicht`);
                  z.mails.set(z.naechste++, mail(uid));
                  o.mails.delete(uid);
                }),
              loeschen: (uid) =>
                schreiben(`loeschen ${uid}`, () => {
                  mail(uid);
                  o.mails.delete(uid);
                }),
            },
          }
        : {}),
    };
  };
  return { konto, einliefern, neuNummerieren, oeffnen, neuerOrdner };
}
