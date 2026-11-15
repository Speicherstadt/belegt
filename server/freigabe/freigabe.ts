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

export type Zweck = "oeffnen" | "teilen";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
/** Form eines Links: 32 Zufallsbytes als base64url */
export const tokenGueltig = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

/** Legt eine Freigabe an; den Klartext gibt es nur hier */
export async function freigeben(
  db: Datenbank,
  dokumentId: string,
  akteur: string,
  minuten = GUELTIG_MINUTEN,
  zweck: Zweck = "oeffnen",
) {
  const token = randomBytes(32).toString("base64url");
  const gueltigBis = new Date(Date.now() + minuten * 60_000);
  const [f] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(freigaben)
      .values({ dokumentId, tokenHash: tokenHash(token), erstelltVon: akteur, gueltigBis, zweck })
      .returning({ id: freigaben.id }),
  );
  return { id: f!.id, token, gueltigBis };
}

/** Das Dokument einer gültigen Freigabe für „Öffnen mit …“ oder null; ein geteilter Link gilt hier nicht */
export async function einloesen(db: Datenbank, token: string): Promise<string | null> {
  if (!tokenGueltig(token)) return null;
  const [f] = await db
    .select({ dokumentId: freigaben.dokumentId })
    .from(freigaben)
    .where(
      and(
        eq(freigaben.tokenHash, tokenHash(token)),
        eq(freigaben.zweck, "oeffnen"),
        gt(freigaben.gueltigBis, sql`now()`),
      ),
    );
  return f?.dokumentId ?? null;
}

/** Die Adresse der App mit eingesetztem Link und Dateinamen */
export function zielAdresse(vorlage: string, werte: { url: string; name: string }): string {
  return vorlage
    .replaceAll("{url}", encodeURIComponent(werte.url))
    .replaceAll("{name}", encodeURIComponent(werte.name));
}
