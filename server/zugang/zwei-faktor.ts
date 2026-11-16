import { count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ROLLEN, type Rolle } from "../../shared/rollen.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { anmeldungEinstellungen, passkey, session, twoFactor, user } from "../db/schema.ts";

/*
 * Zweiter Faktor (docs/zugaenge.md#zwei-faktor): TOTP mit Backup-Codes und Passkeys kommen aus den Plugins twoFactor und
 * passkey von Better Auth (server/auth.ts). Hier steht, was Belegt dazu tut: wie eine Sitzung entstand, für welche
 * Rollen ein zweiter Faktor Pflicht ist, und das Zurücksetzen durch den Inhaber oder im Notfall (notfall.ts).
 */

export const ANMELDEWEGE = ["passwort", "zwei_faktor", "passkey", "oidc"] as const;
export type Anmeldeweg = (typeof ANMELDEWEGE)[number];

/**
 * Anmeldeweg einer neuen Sitzung aus dem Pfad des Aufrufs, der sie anlegt. Der zweite Schritt nach dem Passwort
 * (verify-totp, verify-backup-code) und das Bestätigen beim Einrichten ergeben zwei_faktor, der Passkey passkey, die
 * Rückkehr vom OIDC-Anbieter oidc (/callback/:id, docs/einbetten.md); alles andere, auch Einrichten und Einladung, zählt
 * als Passwort allein.
 */
export function anmeldewegAus(pfad: string | undefined): Anmeldeweg {
  if (pfad?.startsWith("/two-factor/verify-")) return "zwei_faktor";
  if (pfad === "/passkey/verify-authentication") return "passkey";
  if (pfad === "/callback/:id" || pfad?.startsWith("/oauth2/callback")) return "oidc";
  return "passwort";
}

/** Eine Sitzung mit zweitem Faktor oder über den OIDC-Anbieter, der dann für die Anmeldung zuständig ist */
export const mitZweitemFaktor = (weg: unknown) => weg === "zwei_faktor" || weg === "passkey" || weg === "oidc";

export const PflichtEingabe = z.object({ rollen: z.array(z.enum(ROLLEN)).max(ROLLEN.length) });

/** Rollen, für die ein zweiter Faktor Pflicht ist */
export async function pflichtLaden(db: Datenbank): Promise<Rolle[]> {
  const [e] = await db
    .select({ rollen: anmeldungEinstellungen.zweiFaktorPflicht })
    .from(anmeldungEinstellungen)
    .where(eq(anmeldungEinstellungen.id, 1));
  return (e?.rollen ?? []).filter((r): r is Rolle => (ROLLEN as readonly string[]).includes(r));
}

export async function pflichtSetzen(db: Datenbank, rollen: Rolle[], akteur: string): Promise<Rolle[]> {
  const sortiert = ROLLEN.filter((r) => rollen.includes(r));
  await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(anmeldungEinstellungen)
      .values({ id: 1, zweiFaktorPflicht: [...sortiert] })
      .onConflictDoUpdate({
        target: anmeldungEinstellungen.id,
        set: { zweiFaktorPflicht: [...sortiert], geaendertAm: sql`now()` },
      }),
  );
  return sortiert;
}

/** Ob ein Zugang erst einen zweiten Faktor einrichten muss, bevor er etwas anderes aufruft */
export const einrichtungNoetig = (pflicht: Rolle[], rolle: Rolle, anmeldeweg: unknown) =>
  pflicht.includes(rolle) && !mitZweitemFaktor(anmeldeweg);

export interface ZweiFaktorStand {
  totp: boolean;
  passkeys: number;
}

/** TOTP und Zahl der Passkeys je Zugang, für die Liste der Zugänge und die Verfahrensdokumentation */
export async function staende(db: Datenbank, ids: string[]): Promise<Map<string, ZweiFaktorStand>> {
  if (!ids.length) return new Map();
  const [totp, keys] = await Promise.all([
    db.select({ id: user.id, an: user.twoFactorEnabled }).from(user).where(inArray(user.id, ids)),
    db
      .select({ id: passkey.userId, anzahl: count() })
      .from(passkey)
      .where(inArray(passkey.userId, ids))
      .groupBy(passkey.userId),
  ]);
  const anzahl = new Map(keys.map((k) => [k.id, Number(k.anzahl)]));
  return new Map(totp.map((t) => [t.id, { totp: t.an, passkeys: anzahl.get(t.id) ?? 0 }]));
}

export async function stand(db: Datenbank, id: string): Promise<ZweiFaktorStand> {
  return (await staende(db, [id])).get(id) ?? { totp: false, passkeys: 0 };
}

/**
 * Entfernt TOTP, Backup-Codes und Passkeys eines Zugangs und beendet seine Sitzungen; im Audit-Log mit dem Akteur.
 * Danach meldet er sich mit dem Passwort an und richtet neu ein (bei Pflicht zwangsweise). false, wenn es ihn nicht gibt.
 */
export async function zuruecksetzen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  return mitAkteur(db, akteur, async (tx) => {
    const [z] = await tx
      .update(user)
      .set({ twoFactorEnabled: false })
      .where(eq(user.id, id))
      .returning({ id: user.id });
    if (!z) return false;
    await tx.delete(twoFactor).where(eq(twoFactor.userId, id));
    await tx.delete(passkey).where(eq(passkey.userId, id));
    await tx.delete(session).where(eq(session.userId, id));
    return true;
  });
}

/** Ob ein Zugang Passkeys, aber kein TOTP hat: Dann meldet er sich nur mit dem Passkey an, nicht mit dem Passwort */
export async function nurPasskey(db: Datenbank, id: string): Promise<boolean> {
  const s = await stand(db, id);
  return !s.totp && s.passkeys > 0;
}

/** Der Zugang mit dieser Adresse (für das Notfall-Skript) */
export async function zugangPerAdresse(db: Datenbank, email: string) {
  const [z] = await db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()));
  return z ?? null;
}
