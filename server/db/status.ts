import { count } from "drizzle-orm";
import type { Datenbank } from "./client.ts";
import { user } from "./schema.ts";

/** Ob es schon einen Zugang gibt; davor zeigt die Oberfläche „Einrichten“ statt „Anmelden“ */
export async function eingerichtet(db: Datenbank): Promise<boolean> {
  const [zeile] = await db.select({ n: count() }).from(user);
  return (zeile?.n ?? 0) > 0;
}
