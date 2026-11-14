import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { apiTokens } from "../db/schema.ts";

/** Vorsilbe, an der Belegt und Werkzeuge zur Geheimnissuche ein Token erkennen */
export const TOKEN_PRAEFIX = "belegt_";

export const TokenEingabe = z.object({
  name: z.string().trim().min(1).max(200),
  recht: z.enum(["lesen", "schreiben"]),
});
export type Recht = z.infer<typeof TokenEingabe>["recht"];

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export type Token = Omit<typeof apiTokens.$inferSelect, "tokenHash">;
const ohneHash = ({ tokenHash: _, ...t }: typeof apiTokens.$inferSelect): Token => t;

/** Legt ein Token an; den Klartext gibt es nur in dieser Antwort */
export async function anlegen(db: Datenbank, eingabe: z.infer<typeof TokenEingabe>, akteur: string) {
  const token = `${TOKEN_PRAEFIX}${randomBytes(32).toString("base64url")}`;
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(apiTokens)
      .values({ ...eingabe, tokenHash: hash(token) })
      .returning(),
  );
  return { token: ohneHash(neu!), klartext: token };
}

/** Das gültige Token zu einem Klartext oder null */
export async function finden(db: Datenbank, klartext: string): Promise<Token | null> {
  if (!klartext.startsWith(TOKEN_PRAEFIX)) return null;
  const [t] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hash(klartext)), isNull(apiTokens.widerrufenAm)));
  return t ? ohneHash(t) : null;
}

export async function widerrufen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  const zeilen = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(apiTokens)
      .set({ widerrufenAm: sql`now()` })
      .where(and(eq(apiTokens.id, id), isNull(apiTokens.widerrufenAm)))
      .returning({ id: apiTokens.id }),
  );
  return zeilen.length > 0;
}

export async function listen(db: Datenbank): Promise<Token[]> {
  return (await db.select().from(apiTokens).orderBy(desc(apiTokens.erstelltAm))).map(ohneHash);
}

const LESEN = [
  /^\/api\/ich$/,
  /^\/api\/dokumente$/,
  /^\/api\/dokumente\/[^/]+(\/(datei|ansicht|inhalt|mail|verlauf))?$/,
];
const SCHREIBEN = [/^\/api\/dokumente$/, /^\/api\/mails$/, /^\/api\/dokumente\/[^/]+\/einordnung$/];

/** Was ein Token darf: lesen nur GET auf Dokumente, schreiben zusätzlich Aufnehmen und Einordnen */
export function tokenDarf(recht: Recht, methode: string, pfad: string): boolean {
  // MCP: jedes Token; welche Werkzeuge es aufrufen darf, entscheidet server/mcp/protokoll.ts nach dem Recht
  if (pfad === "/api/mcp") return true;
  if (methode === "GET" || methode === "HEAD") return LESEN.some((r) => r.test(pfad));
  return recht === "schreiben" && methode === "POST" && SCHREIBEN.some((r) => r.test(pfad));
}
