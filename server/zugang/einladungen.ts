import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { einladungen, user } from "../db/schema.ts";

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

export async function einladen(
  db: Datenbank,
  rolle: "steuerberatung" | "pruefer",
  akteur: string,
): Promise<{ einladung: Einladung; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(einladungen)
      .values({ tokenHash: hash(token), rolle, gueltigBis: new Date(Date.now() + GUELTIG_STUNDEN * 3600_000) })
      .returning(),
  );
  const { tokenHash: _, ...einladung } = neu!;
  return { einladung, token };
}

export async function offen(db: Datenbank, token: string): Promise<{ rolle: string } | null> {
  const [e] = await db.select({ rolle: einladungen.rolle }).from(einladungen).where(einloesbar(token));
  return e ?? null;
}

/** Löst die Einladung in derselben Anweisung ein, die sie prüft: zwei gleichzeitige Registrierungen bekommen sie nicht beide */
export async function einloesen(
  db: Datenbank,
  token: string,
  email: string,
): Promise<"steuerberatung" | "pruefer" | null> {
  const [e] = await mitAkteur(db, "system:einladung", (tx) =>
    tx
      .update(einladungen)
      .set({ eingeloestAm: sql`now()`, eingeloestVon: email })
      .where(einloesbar(token))
      .returning({ rolle: einladungen.rolle }),
  );
  return (e?.rolle as "steuerberatung" | "pruefer" | undefined) ?? null;
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
      erstelltAm: einladungen.erstelltAm,
      gueltigBis: einladungen.gueltigBis,
      eingeloestAm: einladungen.eingeloestAm,
      eingeloestVon: einladungen.eingeloestVon,
      zurueckgezogenAm: einladungen.zurueckgezogenAm,
    })
    .from(einladungen)
    .orderBy(desc(einladungen.erstelltAm));
  const zugaenge = await db
    .select({ id: user.id, email: user.email, rolle: user.role, erstelltAm: user.createdAt })
    .from(user)
    .orderBy(user.createdAt);
  return { einladungen: liste, zugaenge };
}
