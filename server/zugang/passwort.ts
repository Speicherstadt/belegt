import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { account, passwortLinks, session, user } from "../db/schema.ts";

/*
 * Passwort vergessen (docs/zugaenge.md#passwort-vergessen): Der Inhaber (oder im Notfall notfall-passwort.ts) stellt
 * einen Link aus, mit dem die Person ihr neues Passwort selbst setzt. Der zweite Faktor bleibt, wie er ist.
 */

/** Wie lange ein Link gilt */
export const GUELTIG_STUNDEN = 24;
/** Wie bei Better Auth (emailAndPassword in server/auth.ts) */
export const PASSWORT_MIN = 12;
export const PASSWORT_MAX = 128;

/** Gespeichert wird nur der SHA-256; wer die Datenbank liest, kann keinen Link einlösen */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Stellt einen Link für den Zugang aus und macht seine anderen offenen Links ungültig. Der Pfad (mit Token) steht nur im
 * Rückgabewert. null, wenn es den Zugang nicht gibt, er entzogen ist oder kein Passwort hat (nur OIDC).
 */
export async function linkAusstellen(db: Datenbank, id: string, akteur: string): Promise<string | null> {
  const token = randomBytes(32).toString("base64url");
  const ok = await mitAkteur(db, akteur, async (tx) => {
    const [z] = await tx
      .select({ id: user.id })
      .from(user)
      .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
      .where(and(eq(user.id, id), isNull(user.entzogenAm), isNotNull(account.password)));
    if (!z) return false;
    await tx.delete(passwortLinks).where(and(eq(passwortLinks.userId, id), isNull(passwortLinks.eingeloestAm)));
    await tx.insert(passwortLinks).values({
      tokenHash: hash(token),
      userId: id,
      gueltigBis: new Date(Date.now() + GUELTIG_STUNDEN * 3600_000),
    });
    return true;
  });
  return ok ? `/passwort/${token}` : null;
}

/**
 * Setzt das Passwort mit dem Link: löst ihn in derselben Anweisung ein, die ihn prüft (zwei gleichzeitige Aufrufe
 * bekommen ihn nicht beide), schreibt den Hash von Better Auth und beendet alle Sitzungen. false bei ungültigem Link; der teure Hash entsteht erst nach dem Einlösen, ein erratener Link kostet nichts.
 */
export async function passwortSetzen(db: Datenbank, token: string, passwort: string): Promise<boolean> {
  return mitAkteur(db, "system:passwort-link", async (tx) => {
    const [l] = await tx
      .update(passwortLinks)
      .set({ eingeloestAm: sql`now()` })
      .where(
        and(
          eq(passwortLinks.tokenHash, hash(token)),
          isNull(passwortLinks.eingeloestAm),
          gt(passwortLinks.gueltigBis, sql`now()`),
          // Ein entzogener Zugang setzt kein Passwort mehr
          sql`not exists (select 1 from "user" u where u.id = ${passwortLinks.userId} and u.entzogen_am is not null)`,
        ),
      )
      .returning({ userId: passwortLinks.userId });
    if (!l) return false;
    const [z] = await tx
      .update(account)
      .set({ password: await hashPassword(passwort), updatedAt: sql`now()` })
      .where(and(eq(account.userId, l.userId), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    // Kein Konto mit Passwort mehr: wie ein ungültiger Link
    if (!z) return false;
    await tx.delete(session).where(eq(session.userId, l.userId));
    return true;
  });
}
