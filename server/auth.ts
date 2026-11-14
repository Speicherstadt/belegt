import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count } from "drizzle-orm";
import type { Rolle } from "../shared/rollen.ts";
import type { Datenbank } from "./db/client.ts";
import * as schema from "./db/schema.ts";

/*
 * Anmeldung mit Better Auth, wie in Haben: E-Mail und Passwort, das erste Konto ist der Inhaber. Weitere Zugänge
 * (Steuerberatung, Prüfer) kommen später per Einladung; bis dahin lehnt Belegt jede weitere Registrierung ab.
 */
export function createAuth({ db, secret, baseURL }: { db: Datenbank; secret: string; baseURL: string }) {
  return betterAuth({
    baseURL,
    secret,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    rateLimit: { enabled: true, window: 60, max: 20 },
    user: { additionalFields: { role: { type: "string", input: false, required: false } } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const [zeile] = await db.select({ n: count() }).from(schema.user);
            if ((zeile?.n ?? 0) > 0) {
              throw new APIError("FORBIDDEN", {
                message: "Belegt ist bereits eingerichtet. Weitere Zugänge gibt es nur per Einladung.",
              });
            }
            return { data: { ...user, role: "inhaber" satisfies Rolle } };
          },
        },
      },
    },
    // Nur die erste Zeile: Folgezeilen können SQL-Parameter und Tokens enthalten (wie in Haben)
    logger: {
      level: "error",
      log: (_level, message) => console.error(`Better Auth: ${message.split("\n")[0]!.slice(0, 200)}`),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface Angemeldet {
  id: string;
  email: string;
  role: Rolle;
}
