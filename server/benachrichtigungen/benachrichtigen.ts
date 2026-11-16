import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { benachrichtigungen, user } from "../db/schema.ts";
import { type Lage, type Meldung, meldungenSammeln } from "./anlaesse.ts";
import { laden as einstellungenLaden } from "./einstellungen.ts";
import type { Versender } from "./versand.ts";

/*
 * Benachrichtigungen per Mail, im Worker (docs/betrieb.md#benachrichtigungen): sammelt die Meldungen der eingeschalteten
 * Anlässe, entprellt sie und schickt sie an Inhaber und weitere Empfänger. Jeder Versuch steht im Protokoll
 * (benachrichtigungen, nur ergänzen), mit Betreff, nie mit dem Text. Ohne Versender (MAIL_SMTP_URL) geschieht nichts.
 */

const AKTEUR = "system:benachrichtigungen";
/** Nach einem gescheiterten Versand dieselbe Meldung frühestens nach einer Stunde wieder versuchen */
const WIEDERHOLEN_MS = 3_600_000;

export interface Umgebung {
  db: Datenbank;
  versender: Versender;
  /** Adresse von Belegt für die Links (BETTER_AUTH_URL) */
  basisUrl: string;
}

/** Inhaber (wenn eingestellt) und weitere Empfänger, ohne doppelte */
async function empfaengerLaden(db: Datenbank, anInhaber: boolean, weitere: string[]): Promise<string[]> {
  const inhaber = anInhaber
    ? await db
        .select({ email: user.email })
        .from(user)
        .where(and(eq(user.role, "inhaber"), isNull(user.entzogenAm)))
    : [];
  return [...new Set([...inhaber.map((i) => i.email), ...weitere])];
}

/** Ob dieselbe Meldung im selben Zustand schon hinausging (oder vor kurzem scheiterte) */
async function schonGemeldet(db: Datenbank, m: Meldung, jetzt: Date): Promise<boolean> {
  const [letzte] = await db
    .select({ am: benachrichtigungen.gesendetAm, ok: benachrichtigungen.ok })
    .from(benachrichtigungen)
    .where(
      and(
        eq(benachrichtigungen.anlass, m.anlass),
        eq(benachrichtigungen.zustand, m.zustand),
        gt(benachrichtigungen.gesendetAm, new Date(jetzt.getTime() - (m.abstandStunden ?? 24) * 3_600_000)),
      ),
    )
    .orderBy(desc(benachrichtigungen.gesendetAm))
    .limit(1);
  if (!letzte) return false;
  return letzte.ok || jetzt.getTime() - letzte.am.getTime() < WIEDERHOLEN_MS;
}

export function mailText(basisUrl: string, zeilen: string[], pfad: string): string {
  const basis = basisUrl.replace(/\/$/, "");
  return [
    ...zeilen,
    "",
    `In Belegt ansehen: ${basis}${pfad}`,
    "",
    "--",
    `Diese Nachricht schickt Belegt. Benachrichtigungen einstellen: ${basis}/benachrichtigungen`,
  ].join("\n");
}

/** Schickt eine Mail und trägt den Versuch ein; gibt den Fehler zurück oder null */
export async function senden(
  u: Umgebung,
  eintrag: { anlass: string; zustand: string; betreff: string; empfaenger: string[] },
  text: string,
  am = new Date(),
): Promise<string | null> {
  const fehler = await u
    .versender({ an: eintrag.empfaenger, betreff: eintrag.betreff, text })
    .then(() => null)
    .catch((err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300));
  await mitAkteur(u.db, AKTEUR, (tx) =>
    tx.insert(benachrichtigungen).values({ ...eintrag, gesendetAm: am, ok: fehler === null, fehler }),
  );
  return fehler;
}

export interface Ergebnis {
  gesendet: number;
  fehler: number;
  entprellt: number;
}

export async function benachrichtigen(u: Umgebung, lage: Lage): Promise<Ergebnis> {
  const e = await einstellungenLaden(u.db);
  const empfaenger = await empfaengerLaden(u.db, e.anInhaber, e.weitereEmpfaenger);
  const meldungen = await meldungenSammeln(u.db, e.anlaesse, lage);
  const ergebnis: Ergebnis = { gesendet: 0, fehler: 0, entprellt: 0 };
  for (const m of meldungen) {
    const an = m.empfaenger ?? empfaenger;
    if (!an.length) continue;
    if (await schonGemeldet(u.db, m, lage.jetzt)) {
      ergebnis.entprellt++;
      continue;
    }
    const fehler = await senden(
      u,
      { anlass: m.anlass, zustand: m.zustand, betreff: m.betreff, empfaenger: an },
      mailText(u.basisUrl, m.zeilen, m.pfad),
      lage.jetzt,
    );
    if (fehler) ergebnis.fehler++;
    else ergebnis.gesendet++;
  }
  return ergebnis;
}

/** Testmail an die eingestellten Empfänger (Knopf auf der Seite Benachrichtigungen) */
export async function testmail(u: Umgebung): Promise<{ empfaenger: string[]; fehler: string | null }> {
  const e = await einstellungenLaden(u.db);
  const empfaenger = await empfaengerLaden(u.db, e.anInhaber, e.weitereEmpfaenger);
  if (!empfaenger.length) return { empfaenger, fehler: "Keine Empfänger eingestellt" };
  const fehler = await senden(
    u,
    { anlass: "test", zustand: new Date().toISOString(), betreff: "Belegt: Testmail", empfaenger },
    mailText(
      u.basisUrl,
      ["Diese Testmail zeigt, dass Belegt Benachrichtigungen verschicken kann."],
      "/benachrichtigungen",
    ),
  );
  return { empfaenger, fehler };
}

/** Die letzten gesendeten Benachrichtigungen für die Seite */
export async function protokoll(db: Datenbank, limit = 50) {
  return db
    .select()
    .from(benachrichtigungen)
    .orderBy(desc(benachrichtigungen.gesendetAm), desc(benachrichtigungen.id))
    .limit(limit);
}
