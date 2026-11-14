import { timingSafeEqual } from "node:crypto";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins";
import type { Rolle } from "../shared/rollen.ts";
import type { Datenbank } from "./db/client.ts";
import * as schema from "./db/schema.ts";
import { eingerichtet } from "./db/status.ts";
import { EINLADUNG_HEADER, EINRICHTUNGSCODE_HEADER, einloesen, offen } from "./zugang/einladungen.ts";

const verboten = (message: string) => new APIError("FORBIDDEN", { message });

function gleich(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/*
 * Anmeldung mit Better Auth, wie in Haben: E-Mail und Passwort. Das erste Konto ist der Inhaber und braucht den
 * Einrichtungscode aus dem Server-Log, damit auf einer frischen Installation nicht der Erste, der die Seite findet,
 * Inhaber wird. Jedes weitere Konto entsteht nur mit einer Einladung und bekommt deren Rolle.
 */
/** Anmeldung über einen OpenID-Connect-Anbieter (Firmenkonto); der Callback ist /api/auth/callback/oidc */
export interface OidcKonfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Name auf dem Knopf „Anmelden mit …“ */
  name: string;
}
export const OIDC_ANBIETER = "oidc";

/** Ein Konto ohne Access-, Refresh- und ID-Token, beim Anlegen und bei jeder Aktualisierung */
function ohneTokens<T extends object>(account: T): T {
  return { ...account, accessToken: null, refreshToken: null, idToken: null };
}

export function createAuth({
  db,
  secret,
  baseURL,
  einrichtungscode,
  begrenzen = true,
  oidc,
}: {
  db: Datenbank;
  secret: string;
  baseURL: string;
  einrichtungscode: string;
  /** Anmeldeversuche begrenzen; nur Tests schalten das ab, die viele Konten in kurzer Zeit anlegen */
  begrenzen?: boolean;
  oidc?: OidcKonfig;
}) {
  return betterAuth({
    baseURL,
    secret,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    // Mit dem Anbieter verbindet nur, wer angemeldet ist (link-social): Belegt bestätigt keine Adressen, und wer einen
    // Einladungslink öffnet, wählt seine Adresse selbst; eine Verknüpfung über die Adresse wäre daher unsicher. Danach
    // meldet der Anbieter über sein sub an. Neue Konten entstehen weiter nur mit Einladung (Hook unten).
    // Ob der Anbieter die Adresse bestätigt, zählt deshalb auch nicht (Microsoft Entra sendet email_verified gar nicht):
    // trustedProviders erlaubt das Verbinden ohne, disableImplicitLinking verbietet weiter jede Verknüpfung über die Adresse.
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        trustedProviders: [OIDC_ANBIETER],
      },
    },
    plugins: oidc
      ? [
          genericOAuth({
            config: [
              {
                providerId: OIDC_ANBIETER,
                discoveryUrl: `${oidc.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
                clientId: oidc.clientId,
                clientSecret: oidc.clientSecret,
                scopes: ["openid", "profile", "email"],
                pkce: true,
                authentication: "basic",
                requireIdTokenVerification: true,
                disableImplicitSignUp: true,
                mapProfileToUser: (profile) => ({ emailVerified: profile.email_verified === true }),
              },
            ],
          }),
        ]
      : [],
    rateLimit: { enabled: begrenzen, storage: "memory", window: 60, max: 20 },
    user: {
      additionalFields: {
        role: { type: "string", input: false, required: false },
        // Zeitraum eines Prüfers als JJJJ-MM-TT; nur der Hook setzt ihn aus der Einladung
        zeitraumVon: { type: "string", input: false, required: false },
        zeitraumBis: { type: "string", input: false, required: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Name, Bild und E-Mail ändert Belegt nicht über Better Auth: das schriebe ohne Akteur und an der Rollenprüfung vorbei
        if (ctx.path === "/update-user" || ctx.path === "/change-email")
          throw verboten("Das Konto lässt sich hier nicht ändern.");
        if (ctx.path !== "/sign-up/email") return;
        const token = ctx.headers?.get(EINLADUNG_HEADER);
        if (token) {
          if (!(await offen(db, token))) throw verboten("Die Einladung ist ungültig, abgelaufen oder schon eingelöst.");
        } else if (await eingerichtet(db)) {
          throw verboten("Belegt ist bereits eingerichtet. Weitere Zugänge gibt es nur per Einladung.");
        } else if (!gleich(ctx.headers?.get(EINRICHTUNGSCODE_HEADER), einrichtungscode)) {
          throw verboten("Der Einrichtungscode stimmt nicht.");
        }
      }),
    },
    databaseHooks: {
      // Tokens des Anbieters braucht Belegt nach der Anmeldung nicht; gespeichert wären sie ein Geheimnis im Klartext
      account: {
        create: { before: async (account) => ({ data: ohneTokens(account) }) },
        update: { before: async (account) => ({ data: ohneTokens(account) }) },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            if (ctx?.path !== "/sign-up/email") throw verboten("Konten entstehen nur über Einrichtung oder Einladung.");
            const token = ctx.headers?.get(EINLADUNG_HEADER);
            if (token) {
              const zugang = await einloesen(db, token, user.email);
              if (!zugang) throw verboten("Die Einladung ist ungültig, abgelaufen oder schon eingelöst.");
              return {
                data: {
                  ...user,
                  role: zugang.rolle satisfies Rolle,
                  zeitraumVon: zugang.zeitraum?.von ?? null,
                  zeitraumBis: zugang.zeitraum?.bis ?? null,
                },
              };
            }
            // Der eindeutige Index user_inhaber_single verhindert zwei Inhaber auch bei gleichzeitiger Einrichtung
            if (await eingerichtet(db))
              throw verboten("Belegt ist bereits eingerichtet. Weitere Zugänge gibt es nur per Einladung.");
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
  /** Nur beim Prüfer: was er sehen darf */
  zeitraum?: { von: string; bis: string };
  /** Nur bei einem Programm mit API-Token */
  token?: { name: string; recht: "lesen" | "schreiben" };
}
