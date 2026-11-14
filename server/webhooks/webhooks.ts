import { createHmac, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { entschluesseln, verschluesseln } from "../crypto.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { webhooks, webhookZustellungen } from "../db/schema.ts";

/**
 * Webhooks: Belegt meldet einem Empfänger per POST, dass ein Dokument aufgenommen, eingeordnet oder gelöscht wurde.
 * Die Nachricht enthält nur Art, Dokument-ID und Zeitpunkt; den Inhalt holt der Empfänger mit einem API-Token. Die
 * Signatur ist HMAC-SHA256 über den Rumpf mit dem Geheimnis des Webhooks (Kopfzeile X-Belegt-Signatur: sha256=…).
 */

export const EREIGNISSE = ["dokument.aufgenommen", "dokument.eingeordnet", "dokument.geloescht"] as const;

export const WebhookEingabe = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.url({ protocol: /^https?$/ }).max(2000),
  arten: z.array(z.enum(EREIGNISSE)).min(1),
});

export type Webhook = Omit<typeof webhooks.$inferSelect, "ciphertext">;
const ohneGeheimnis = ({ ciphertext: _, ...w }: typeof webhooks.$inferSelect): Webhook => w;

export async function anlegen(
  db: Datenbank,
  schluessel: Buffer,
  eingabe: z.infer<typeof WebhookEingabe>,
  akteur: string,
) {
  const geheimnis = `whsec_${randomBytes(32).toString("base64url")}`;
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(webhooks)
      .values({
        ...eingabe,
        arten: [...new Set(eingabe.arten)],
        ciphertext: verschluesseln(schluessel, Buffer.from(geheimnis)),
      })
      .returning(),
  );
  return { webhook: ohneGeheimnis(neu!), geheimnis };
}

export async function listen(db: Datenbank): Promise<Webhook[]> {
  return (await db.select().from(webhooks).orderBy(webhooks.erstelltAm)).map(ohneGeheimnis);
}

export async function aktivSetzen(db: Datenbank, id: string, aktiv: boolean, akteur: string) {
  const [w] = await mitAkteur(db, akteur, (tx) =>
    tx.update(webhooks).set({ aktiv }).where(eq(webhooks.id, id)).returning(),
  );
  return w ? ohneGeheimnis(w) : null;
}

export const signatur = (geheimnis: string, rumpf: string) =>
  `sha256=${createHmac("sha256", geheimnis).update(rumpf).digest("hex")}`;

export type Senden = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Stellt jedem aktiven Webhook die offenen Ereignisse zu, in ihrer Reihenfolge. Scheitert eine Zustellung, hält der
 * Webhook dort an und versucht es beim nächsten Lauf wieder; so kommt nichts doppelt und nichts außer der Reihe.
 */
export async function zustellen(
  db: Datenbank,
  schluessel: Buffer,
  senden: Senden = fetch,
  { stapel = 100 }: { stapel?: number } = {},
): Promise<Record<string, { zugestellt: number; fehler: string | null }>> {
  const ergebnis: Record<string, { zugestellt: number; fehler: string | null }> = {};
  const aktive = (await db.select().from(webhooks)).filter((w) => w.aktiv);
  for (const w of aktive) {
    const geheimnis = entschluesseln(schluessel, w.ciphertext).toString();
    const offen = await db.execute<{ id: string; art: string; dokument_id: string; zeitpunkt: Date }>(sql`
      select e.id, e.art, e.dokument_id, e.zeitpunkt from webhook_ereignisse e
       where e.zeitpunkt >= ${w.erstelltAm.toISOString()}::timestamptz and e.art = any(${sql`array[${sql.join(
         w.arten.map((a) => sql`${a}`),
         sql`, `,
       )}]::text[]`})
         and not exists (select 1 from webhook_zustellungen z where z.webhook_id = ${w.id} and z.ereignis_id = e.id)
       order by e.id limit ${stapel}`);
    let zugestellt = 0;
    let fehler: string | null = null;
    for (const e of offen) {
      const rumpf = JSON.stringify({
        id: Number(e.id),
        art: e.art,
        dokumentId: e.dokument_id,
        zeitpunkt: new Date(e.zeitpunkt).toISOString(),
      });
      try {
        const res = await senden(w.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-belegt-ereignis": e.art,
            "x-belegt-signatur": signatur(geheimnis, rumpf),
          },
          body: rumpf,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Antwort ${res.status}`);
      } catch (err) {
        fehler = err instanceof Error ? err.message.slice(0, 500) : "Zustellung fehlgeschlagen";
        break;
      }
      await db.insert(webhookZustellungen).values({ webhookId: w.id, ereignisId: Number(e.id) });
      zugestellt++;
    }
    // Nur bei einer Änderung schreiben, sonst stünde jeder leere Lauf im Audit-Log
    if (zugestellt > 0 || fehler !== w.letzterFehler) {
      await mitAkteur(db, "system:webhooks", (tx) =>
        tx
          .update(webhooks)
          .set({ letzterFehler: fehler, ...(zugestellt > 0 ? { letzteZustellung: new Date() } : {}) })
          .where(eq(webhooks.id, w.id)),
      );
    }
    ergebnis[w.name] = { zugestellt, fehler };
  }
  return ergebnis;
}
