import { createHash, randomBytes } from "node:crypto";
import { entschluesseln, verschluesseln } from "../crypto.ts";
import type { Env } from "../env.ts";

/**
 * IMAP mit OAuth 2.0 für Microsoft 365 und Google (XOAUTH2): Die App registriert der Betreiber beim Anbieter und gibt
 * Client-ID und -Geheimnis als Umgebungsvariablen. Belegt speichert je Postfach nur das Refresh-Token, verschlüsselt,
 * und holt vor jedem Abruf ein Access-Token. Anmeldung mit Authorization Code und PKCE (RFC 7636).
 */

export const ANBIETER = ["microsoft", "google"] as const;
export type Anbieter = (typeof ANBIETER)[number];

export interface AnbieterKonfig {
  clientId: string;
  clientSecret: string;
  /** Microsoft: Mandant (common, organizations oder die ID) */
  tenant?: string;
}
export type OAuthKonfig = Partial<Record<Anbieter, AnbieterKonfig>>;

export const oauthAusEnv = (env: Env): OAuthKonfig => ({
  ...(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
    ? {
        microsoft: {
          clientId: env.MICROSOFT_CLIENT_ID,
          clientSecret: env.MICROSOFT_CLIENT_SECRET,
          tenant: env.MICROSOFT_TENANT ?? "common",
        },
      }
    : {}),
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
    : {}),
});

/** Endpunkte, Scopes und IMAP-Server; Microsoft: Entra ID v2, Google: OAuth 2.0 für Gmail IMAP */
export function endpunkte(anbieter: Anbieter, k: AnbieterKonfig) {
  if (anbieter === "microsoft") {
    const basis = `https://login.microsoftonline.com/${encodeURIComponent(k.tenant ?? "common")}/oauth2/v2.0`;
    return {
      autorisieren: `${basis}/authorize`,
      token: `${basis}/token`,
      scope: "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All",
      extra: {} as Record<string, string>,
      host: "outlook.office365.com",
    };
  }
  return {
    autorisieren: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://mail.google.com/",
    // Ohne offline und consent gibt Google beim zweiten Verbinden kein Refresh-Token mehr
    extra: { access_type: "offline", prompt: "consent" } as Record<string, string>,
    host: "imap.gmail.com",
  };
}

export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

/** Was zwischen Start und Rückkehr im verschlüsselten Cookie liegt */
export interface Vorgang {
  anbieter: Anbieter;
  state: string;
  verifier: string;
  name: string;
  ordner: string;
  bis: number;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function starten(
  anbieter: Anbieter,
  k: AnbieterKonfig,
  rueckkehr: string,
  schluessel: Buffer,
  { name, ordner }: { name: string; ordner: string },
) {
  const e = endpunkte(anbieter, k);
  const vorgang: Vorgang = {
    anbieter,
    state: b64url(randomBytes(24)),
    verifier: b64url(randomBytes(48)),
    name,
    ordner,
    bis: Date.now() + 10 * 60_000,
  };
  const url = new URL(e.autorisieren);
  url.search = new URLSearchParams({
    client_id: k.clientId,
    response_type: "code",
    redirect_uri: rueckkehr,
    scope: e.scope,
    state: vorgang.state,
    code_challenge: b64url(createHash("sha256").update(vorgang.verifier).digest()),
    code_challenge_method: "S256",
    ...e.extra,
  }).toString();
  return { url: url.toString(), cookie: b64url(verschluesseln(schluessel, Buffer.from(JSON.stringify(vorgang)))) };
}

/** Der Vorgang aus dem Cookie, wenn er echt, nicht abgelaufen und zu diesem state ist */
export function vorgangLesen(
  cookie: string | undefined,
  state: string | undefined,
  schluessel: Buffer,
): Vorgang | null {
  if (!cookie || !state) return null;
  try {
    const v = JSON.parse(entschluesseln(schluessel, Buffer.from(cookie, "base64url")).toString()) as Vorgang;
    return v.state === state && v.bis > Date.now() && ANBIETER.includes(v.anbieter) ? v : null;
  } catch {
    return null;
  }
}

interface TokenAntwort {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenAnfrage(anbieter: Anbieter, k: AnbieterKonfig, felder: Record<string, string>, abfragen: Abfragen) {
  const res = await abfragen(endpunkte(anbieter, k).token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: k.clientId, client_secret: k.clientSecret, ...felder }).toString(),
  });
  const t = (await res.json().catch(() => ({}))) as TokenAntwort;
  // Nur der Fehlercode, nie die Beschreibung im Ganzen: sie kann Kennungen des Mandanten enthalten
  if (!res.ok || t.error || !t.access_token) throw new Error(`OAuth: ${t.error ?? `Antwort ${res.status}`}`);
  return t;
}

/** Tauscht den Code gegen Tokens; die Adresse kommt aus dem ID-Token, das direkt vom Anbieter kommt */
export async function codeTauschen(
  v: Vorgang,
  k: AnbieterKonfig,
  code: string,
  rueckkehr: string,
  abfragen: Abfragen = fetch,
): Promise<{ adresse: string; refreshToken: string }> {
  const t = await tokenAnfrage(
    v.anbieter,
    k,
    { grant_type: "authorization_code", code, redirect_uri: rueckkehr, code_verifier: v.verifier },
    abfragen,
  );
  if (!t.refresh_token) throw new Error("OAuth: kein Refresh-Token erhalten");
  const ansprueche = JSON.parse(Buffer.from(t.id_token?.split(".")[1] ?? "", "base64url").toString() || "{}") as {
    email?: string;
    preferred_username?: string;
  };
  const adresse = ansprueche.email ?? ansprueche.preferred_username;
  if (!adresse) throw new Error("OAuth: keine Adresse im ID-Token");
  return { adresse, refreshToken: t.refresh_token };
}

/** Access-Token für einen Abruf; gibt der Anbieter ein neues Refresh-Token (Microsoft rotiert), kommt es mit */
export async function accessToken(
  anbieter: Anbieter,
  k: AnbieterKonfig,
  refreshToken: string,
  abfragen: Abfragen = fetch,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const t = await tokenAnfrage(anbieter, k, { grant_type: "refresh_token", refresh_token: refreshToken }, abfragen);
  return {
    accessToken: t.access_token!,
    refreshToken: t.refresh_token && t.refresh_token !== refreshToken ? t.refresh_token : null,
  };
}
