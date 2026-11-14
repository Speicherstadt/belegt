import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { freigaben } from "../db/schema.ts";

/*
 * „Öffnen mit …“: Belegt gibt einer anderen App (Office im Browser, Editor) einen kurzlebigen Link auf das Original.
 * Die App holt damit eine Kopie; was sie daraus macht, ist ein neues Dokument, das Original bleibt unverändert.
 */

/** Wie lange ein Link gilt; die App holt die Datei gleich nach dem Öffnen */
export const GUELTIG_MINUTEN = 10;

export interface OeffnenMit {
  /** Name der App auf dem Knopf, aus der Einstellung */
  name: string;
  /** Adresse der App mit {url} (Link auf die Datei), optional {name} (Dateiname) */
  url: string;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Legt eine Freigabe an; den Klartext gibt es nur hier */
export async function freigeben(db: Datenbank, dokumentId: string, akteur: string, minuten = GUELTIG_MINUTEN) {
  const token = randomBytes(32).toString("base64url");
  const gueltigBis = new Date(Date.now() + minuten * 60_000);
  await mitAkteur(db, akteur, (tx) =>
    tx.insert(freigaben).values({ dokumentId, tokenHash: hash(token), erstelltVon: akteur, gueltigBis }),
  );
  return { token, gueltigBis };
}

/** Das Dokument einer gültigen Freigabe oder null */
export async function einloesen(db: Datenbank, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [f] = await db
    .select({ dokumentId: freigaben.dokumentId })
    .from(freigaben)
    .where(and(eq(freigaben.tokenHash, hash(token)), gt(freigaben.gueltigBis, sql`now()`)));
  return f?.dokumentId ?? null;
}

/** Die Adresse der App mit eingesetztem Link und Dateinamen */
export function zielAdresse(vorlage: string, werte: { url: string; name: string }): string {
  return vorlage
    .replaceAll("{url}", encodeURIComponent(werte.url))
    .replaceAll("{name}", encodeURIComponent(werte.name));
}
