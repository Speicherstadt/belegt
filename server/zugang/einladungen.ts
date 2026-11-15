import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Recht, Sichtbereich } from "../../shared/rollen.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { einladungen, session, user } from "../db/schema.ts";

/** Kopfzeile, mit der die Registrierung das Token einer Einladung mitschickt */
export const EINLADUNG_HEADER = "x-belegt-einladung";
/** Kopfzeile mit dem Einrichtungscode für das erste Konto */
export const EINRICHTUNGSCODE_HEADER = "x-belegt-einrichtungscode";

/** Wie lange ein Link gilt */
export const GUELTIG_STUNDEN = 72;

/** Gespeichert wird nur der SHA-256; wer die Datenbank liest, kann keine Einladung einlösen */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const einloesbar = (token: string) =>
  and(
    eq(einladungen.tokenHash, hash(token)),
    isNull(einladungen.eingeloestAm),
    isNull(einladungen.zurueckgezogenAm),
    gt(einladungen.gueltigBis, sql`now()`),
  );

export type Einladung = Omit<typeof einladungen.$inferSelect, "tokenHash">;

/** Der Zeitraum, den ein Prüfer sehen darf (Z1), beide Tage eingeschlossen */
export interface Zeitraum {
  von: string;
  bis: string;
}

export type Zugang =
  | { rolle: "steuerberatung"; zeitraum?: undefined; recht?: undefined; sichtbereich?: undefined }
  | { rolle: "pruefer"; zeitraum: Zeitraum; recht?: undefined; sichtbereich?: undefined }
  | { rolle: "mitarbeiter"; zeitraum?: undefined; recht: Recht; sichtbereich: Sichtbereich };

export async function einladen(
  db: Datenbank,
  { rolle, zeitraum, recht, sichtbereich }: Zugang,
  akteur: string,
): Promise<{ einladung: Einladung; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(einladungen)
      .values({
        tokenHash: hash(token),
        rolle,
        zeitraumVon: zeitraum?.von ?? null,
        zeitraumBis: zeitraum?.bis ?? null,
        recht: recht ?? null,
        sichtbereich: sichtbereich ?? null,
        gueltigBis: new Date(Date.now() + GUELTIG_STUNDEN * 3600_000),
      })
      .returning(),
  );
  const { tokenHash: _, ...einladung } = neu!;
  return { einladung, token };
}

export async function offen(
  db: Datenbank,
  token: string,
): Promise<{ rolle: string; zeitraumVon: string | null; zeitraumBis: string | null; recht?: Recht } | null> {
  const [e] = await db
    .select({
      rolle: einladungen.rolle,
      zeitraumVon: einladungen.zeitraumVon,
      zeitraumBis: einladungen.zeitraumBis,
      recht: einladungen.recht,
    })
    .from(einladungen)
    .where(einloesbar(token));
  if (!e) return null;
  const { recht, ...rest } = e;
  // Das Recht nur bei Mitarbeitern; die Seite der Einladung nennt es
  return recht ? { ...rest, recht } : rest;
}

/** Löst die Einladung in derselben Anweisung ein, die sie prüft: zwei gleichzeitige Registrierungen bekommen sie nicht beide */
export async function einloesen(db: Datenbank, token: string, email: string): Promise<Zugang | null> {
  const [e] = await mitAkteur(db, "system:einladung", (tx) =>
    tx.update(einladungen).set({ eingeloestAm: sql`now()`, eingeloestVon: email }).where(einloesbar(token)).returning({
      rolle: einladungen.rolle,
      von: einladungen.zeitraumVon,
      bis: einladungen.zeitraumBis,
      recht: einladungen.recht,
      sichtbereich: einladungen.sichtbereich,
    }),
  );
  if (!e) return null;
  if (e.rolle === "mitarbeiter" && e.recht && e.sichtbereich)
    return { rolle: "mitarbeiter", recht: e.recht, sichtbereich: e.sichtbereich };
  if (e.rolle === "pruefer" && e.von && e.bis) return { rolle: "pruefer", zeitraum: { von: e.von, bis: e.bis } };
  return e.rolle === "steuerberatung" ? { rolle: "steuerberatung" } : null;
}

export async function zurueckziehen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  const zeilen = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(einladungen)
      .set({ zurueckgezogenAm: sql`now()` })
      .where(and(eq(einladungen.id, id), isNull(einladungen.eingeloestAm), isNull(einladungen.zurueckgezogenAm)))
      .returning({ id: einladungen.id }),
  );
  return zeilen.length > 0;
}

export async function listen(db: Datenbank) {
  const liste = await db
    .select({
      id: einladungen.id,
      rolle: einladungen.rolle,
      zeitraumVon: einladungen.zeitraumVon,
      zeitraumBis: einladungen.zeitraumBis,
      recht: einladungen.recht,
      sichtbereich: einladungen.sichtbereich,
      erstelltAm: einladungen.erstelltAm,
      gueltigBis: einladungen.gueltigBis,
      eingeloestAm: einladungen.eingeloestAm,
      eingeloestVon: einladungen.eingeloestVon,
      zurueckgezogenAm: einladungen.zurueckgezogenAm,
    })
    .from(einladungen)
    .orderBy(desc(einladungen.erstelltAm));
  const zugaenge = await db
    .select({
      id: user.id,
      email: user.email,
      rolle: user.role,
      zeitraumVon: user.zeitraumVon,
      zeitraumBis: user.zeitraumBis,
      recht: user.recht,
      sichtbereich: user.sichtbereich,
      entzogenAm: user.entzogenAm,
      erstelltAm: user.createdAt,
    })
    .from(user)
    .orderBy(user.createdAt);
  return { einladungen: liste, zugaenge };
}

/** Recht und Sichtbereich eines Mitarbeiters ändern; die Änderung steht mit Akteur im Audit-Log (Tabelle user) */
export async function mitarbeiterAendern(
  db: Datenbank,
  id: string,
  { recht, sichtbereich }: { recht: Recht; sichtbereich: Sichtbereich },
  akteur: string,
): Promise<boolean> {
  const zeilen = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(user)
      .set({ recht, sichtbereich, updatedAt: sql`now()` })
      .where(and(eq(user.id, id), eq(user.role, "mitarbeiter"), isNull(user.entzogenAm)))
      .returning({ id: user.id }),
  );
  return zeilen.length > 0;
}

/**
 * Entzieht einen Zugang (nie den des Inhabers): Er bleibt mit seinem Namen im Protokoll stehen, seine Sitzungen enden,
 * und anmelden kann er sich nicht mehr (server/auth.ts)
 */
export async function entziehen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  return mitAkteur(db, akteur, async (tx) => {
    const zeilen = await tx
      .update(user)
      .set({ entzogenAm: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(user.id, id), ne(user.role, "inhaber"), isNull(user.entzogenAm)))
      .returning({ id: user.id });
    if (!zeilen.length) return false;
    await tx.delete(session).where(eq(session.userId, id));
    return true;
  });
}

/** Rolle, Recht, Sichtbereich und ob entzogen, frisch aus der Datenbank (für jede Anfrage eines Zugangs) */
export async function zugangLaden(db: Datenbank, id: string) {
  const [z] = await db
    .select({ recht: user.recht, sichtbereich: user.sichtbereich, entzogenAm: user.entzogenAm })
    .from(user)
    .where(eq(user.id, id));
  return z ?? null;
}
