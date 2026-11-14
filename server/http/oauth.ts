import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { oauthAnlegen } from "../mail/abruf.ts";
import { ANBIETER, codeTauschen, endpunkte, starten, vorgangLesen } from "../mail/oauth.ts";
import { type App, type AppUmgebung, akteur } from "./gemeinsam.ts";

const COOKIE = "belegt_oauth";

const Start = z.object({
  name: z.string().trim().min(1).max(200),
  ordner: z.string().trim().min(1).max(200).default("INBOX"),
});

/** Postfächer bei Microsoft 365 und Google verbinden; nur der Inhaber, nur mit BELEGT_SCHLUESSEL */
export function oauthRouten(app: App, umgebung: AppUmgebung) {
  const basis = new URL(umgebung.auth.options.baseURL as string);
  const rueckkehr = new URL("/api/oauth/rueckkehr", basis).toString();
  const nurInhaber = (rolle: string) => rolle === "inhaber";

  app.get("/api/oauth", (c) => {
    if (!nurInhaber(c.get("nutzer").role) || c.get("nutzer").token)
      return c.json({ fehler: "Nur für den Inhaber" }, 403);
    return c.json({ anbieter: ANBIETER.filter((a) => umgebung.oauth?.[a]), rueckkehr });
  });

  app.get("/api/oauth/:anbieter/start", (c) => {
    if (!nurInhaber(c.get("nutzer").role) || c.get("nutzer").token)
      return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const anbieter = z.enum(ANBIETER).safeParse(c.req.param("anbieter"));
    const konfig = anbieter.success ? umgebung.oauth?.[anbieter.data] : undefined;
    if (!anbieter.success || !konfig) return c.json({ fehler: "Anbieter nicht eingerichtet" }, 404);
    if (!umgebung.schluessel) return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    const eingabe = Start.safeParse({ name: c.req.query("name"), ordner: c.req.query("ordner") || undefined });
    if (!eingabe.success) return c.json({ fehler: "name angeben" }, 400);
    const { url, cookie } = starten(anbieter.data, konfig, rueckkehr, umgebung.schluessel, eingabe.data);
    // Der PKCE-Verifier steht nur im verschlüsselten Cookie, nie in einer Adresse
    setCookie(c, COOKIE, cookie, {
      httpOnly: true,
      secure: basis.protocol === "https:",
      sameSite: "Lax",
      path: "/api/oauth",
      maxAge: 600,
    });
    return c.redirect(url, 302);
  });

  app.get("/api/oauth/rueckkehr", async (c) => {
    const zurueck = (ergebnis: string) => {
      deleteCookie(c, COOKIE, { path: "/api/oauth" });
      return c.redirect(`/quellen?oauth=${encodeURIComponent(ergebnis)}`, 302);
    };
    if (!nurInhaber(c.get("nutzer").role) || c.get("nutzer").token)
      return c.json({ fehler: "Nur für den Inhaber" }, 403);
    if (!umgebung.schluessel) return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    const v = vorgangLesen(getCookie(c, COOKIE), c.req.query("state"), umgebung.schluessel);
    if (!v) return zurueck("abgelaufen");
    const fehler = c.req.query("error");
    const code = c.req.query("code");
    const konfig = umgebung.oauth?.[v.anbieter];
    if (fehler || !code || !konfig) return zurueck("abgelehnt");
    try {
      const { adresse, refreshToken } = await codeTauschen(v, konfig, code, rueckkehr, umgebung.abfragen);
      await oauthAnlegen(
        umgebung.db,
        umgebung.schluessel,
        {
          name: `${v.name} (${adresse})`,
          ordner: v.ordner,
          host: endpunkte(v.anbieter, konfig).host,
          benutzer: adresse,
          refreshToken,
          oauth: v.anbieter,
        },
        akteur(c.get("nutzer")),
      );
      return zurueck("verbunden");
    } catch (err) {
      console.error(`OAuth: ${err instanceof Error ? err.message : err}`);
      return zurueck("fehler");
    }
  });
}
