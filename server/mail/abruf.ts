import { eq } from "drizzle-orm";
import { z } from "zod";
import { entschluesseln, verschluesseln } from "../crypto.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { quellen } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { mailAufnehmen } from "./import.ts";
import { type Abfragen, jmapHolen } from "./jmap.ts";
import { accessToken, type OAuthKonfig } from "./oauth.ts";

/** Ein geöffnetes Postfach; die Umsetzung mit imapflow steht in imapflow.ts, Tests nehmen eine eigene */
export interface Postfach {
  uidValidity: number;
  /** Nachrichten mit UID größer als seitUid, aufsteigend */
  neue(seitUid: number): AsyncIterable<{ uid: number; roh: Uint8Array }>;
  schliessen(): Promise<void>;
}

export interface Zugang {
  host: string;
  port: number;
  tls: boolean;
  benutzer: string;
  passwort: string;
  ordner: string;
  /** IMAP mit OAuth (XOAUTH2) statt Passwort */
  accessToken?: string;
}

/** Was ein Abruf neben dem Postfach braucht: HTTP für JMAP und OAuth (Tests geben eigenes), die OAuth-Apps */
export interface AbrufOptionen {
  abfragen?: Abfragen;
  oauth?: OAuthKonfig;
}

export type Oeffnen = (zugang: Zugang) => Promise<Postfach>;

export const QuelleEingabe = z.object({
  name: z.string().trim().min(1).max(200),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(993),
  tls: z.boolean().default(true),
  benutzer: z.string().trim().min(1).max(320),
  passwort: z.string().min(1).max(1000),
  ordner: z.string().trim().min(1).max(200).default("INBOX"),
  /** imap, oder jmap (Sitzung unter https://host:port/.well-known/jmap) */
  art: z.enum(["imap", "jmap"]).default("imap"),
});

/** Quelle ohne Chiffrat, für Antworten an die Oberfläche */
export type QuelleOhneGeheimnis = Omit<typeof quellen.$inferSelect, "ciphertext">;
const ohneGeheimnis = ({ ciphertext: _, ...q }: typeof quellen.$inferSelect): QuelleOhneGeheimnis => q;

export async function anlegen(
  db: Datenbank,
  schluessel: Buffer,
  eingabe: z.infer<typeof QuelleEingabe>,
  akteur: string,
) {
  const { passwort, ...rest } = eingabe;
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(quellen)
      .values({ ...rest, ciphertext: verschluesseln(schluessel, Buffer.from(passwort)) })
      .returning(),
  );
  return ohneGeheimnis(neu!);
}

/** Postfach mit OAuth: das Refresh-Token liegt verschlüsselt an der Stelle des Passworts */
export async function oauthAnlegen(
  db: Datenbank,
  schluessel: Buffer,
  e: {
    name: string;
    ordner: string;
    host: string;
    benutzer: string;
    refreshToken: string;
    oauth: "microsoft" | "google";
  },
  akteur: string,
) {
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(quellen)
      .values({
        name: e.name,
        host: e.host,
        port: 993,
        tls: true,
        benutzer: e.benutzer,
        ordner: e.ordner,
        art: "imap",
        oauth: e.oauth,
        ciphertext: verschluesseln(schluessel, Buffer.from(e.refreshToken)),
      })
      .returning(),
  );
  return ohneGeheimnis(neu!);
}

export async function listen(db: Datenbank): Promise<QuelleOhneGeheimnis[]> {
  return (await db.select().from(quellen).orderBy(quellen.erstelltAm)).map(ohneGeheimnis);
}

export async function aktivSetzen(db: Datenbank, id: string, aktiv: boolean, akteur: string) {
  const [q] = await mitAkteur(db, akteur, (tx) =>
    tx.update(quellen).set({ aktiv }).where(eq(quellen.id, id)).returning(),
  );
  return q ? ohneGeheimnis(q) : null;
}

export interface AbrufErgebnis {
  neu: number;
  doppelt: number;
  fehler: string | null;
}

/**
 * Holt neue Mails einer Quelle: jede für sich aufgenommen, letzte_uid nach jeder Mail fortgeschrieben, damit ein Abbruch
 * nichts doppelt holt und nichts auslässt. Ein Fehler steht in letzter_fehler; das Passwort steht nirgends im Klartext.
 */
export async function abrufen(
  umgebung: Umgebung,
  schluessel: Buffer,
  quelleId: string,
  oeffnen: Oeffnen,
  { abfragen, oauth }: AbrufOptionen = {},
): Promise<AbrufErgebnis> {
  const { db } = umgebung;
  const [q] = await db.select().from(quellen).where(eq(quellen.id, quelleId));
  if (!q) throw new Error("Quelle nicht gefunden");
  const akteur = `system:${q.art}:${q.name}`;
  const ergebnis: AbrufErgebnis = { neu: 0, doppelt: 0, fehler: null };
  let postfach: Postfach | null = null;
  try {
    if (q.art === "jmap") {
      const zugang = { host: q.host, port: q.port, tls: q.tls, benutzer: q.benutzer, ordner: q.ordner };
      const passwort = entschluesseln(schluessel, q.ciphertext).toString();
      const stand = await jmapHolen(
        { ...zugang, passwort },
        q.jmapStand,
        async (roh) => {
          const { neu } = await mailAufnehmen(umgebung, roh, "mail", akteur);
          if (neu) ergebnis.neu++;
          else ergebnis.doppelt++;
        },
        abfragen,
      );
      await mitAkteur(db, akteur, (tx) => tx.update(quellen).set({ jmapStand: stand }).where(eq(quellen.id, q.id)));
      return ergebnis;
    }
    const geheimnis = entschluesseln(schluessel, q.ciphertext).toString();
    let anmeldung: { passwort: string; accessToken?: string } = { passwort: geheimnis };
    if (q.oauth) {
      const app = oauth?.[q.oauth];
      if (!app) throw new Error(`OAuth für ${q.oauth} ist auf dem Server nicht eingerichtet`);
      const t = await accessToken(q.oauth, app, geheimnis, abfragen);
      // Microsoft gibt bei jedem Abruf ein neues Refresh-Token; das alte verfällt irgendwann
      if (t.refreshToken)
        await mitAkteur(db, akteur, (tx) =>
          tx
            .update(quellen)
            .set({ ciphertext: verschluesseln(schluessel, Buffer.from(t.refreshToken!)) })
            .where(eq(quellen.id, q.id)),
        );
      anmeldung = { passwort: "", accessToken: t.accessToken };
    }
    postfach = await oeffnen({
      host: q.host,
      port: q.port,
      tls: q.tls,
      benutzer: q.benutzer,
      ordner: q.ordner,
      ...anmeldung,
    });
    let seit = q.uidValidity === postfach.uidValidity ? q.letzteUid : 0;
    if (seit !== q.letzteUid || q.uidValidity !== postfach.uidValidity) {
      await mitAkteur(db, akteur, (tx) =>
        tx.update(quellen).set({ letzteUid: 0, uidValidity: postfach!.uidValidity }).where(eq(quellen.id, q.id)),
      );
    }
    for await (const nachricht of postfach.neue(seit)) {
      const { neu } = await mailAufnehmen(umgebung, nachricht.roh, "mail", akteur);
      if (neu) ergebnis.neu++;
      else ergebnis.doppelt++;
      seit = Math.max(seit, nachricht.uid);
      await mitAkteur(db, akteur, (tx) => tx.update(quellen).set({ letzteUid: seit }).where(eq(quellen.id, q.id)));
    }
  } catch (err) {
    // Nur die Meldung, nie das Objekt: es könnte Zugangsdaten enthalten
    ergebnis.fehler = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  } finally {
    await postfach?.schliessen().catch(() => {});
    await mitAkteur(db, akteur, (tx) =>
      tx.update(quellen).set({ letzterAbruf: new Date(), letzterFehler: ergebnis.fehler }).where(eq(quellen.id, q.id)),
    );
  }
  return ergebnis;
}

/** Ruft alle aktiven Quellen nacheinander ab */
export async function alleAbrufen(
  umgebung: Umgebung,
  schluessel: Buffer,
  oeffnen: Oeffnen,
  optionen: AbrufOptionen = {},
) {
  const aktive = (await listen(umgebung.db)).filter((q) => q.aktiv);
  const ergebnisse: Record<string, AbrufErgebnis> = {};
  for (const q of aktive) ergebnisse[q.name] = await abrufen(umgebung, schluessel, q.id, oeffnen, optionen);
  return ergebnisse;
}
