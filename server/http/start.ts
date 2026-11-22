import { verarbeitungsstand } from "../inhalt/verarbeitung.ts";
import { KachelEingabe, kachelnListen, kachelnSetzen, startZahlen } from "../start/start.ts";
import { type App, type AppUmgebung, akteur, heute } from "./gemeinsam.ts";

/*
 * Startseite (server/start/): Zahlen je Rolle und die Kacheln aus gespeicherten Ansichten, je Zugang. Die Kacheln
 * wählt jede Rolle selbst (Ausnahme in server/http/zugang.ts); Programme mit Token haben keine Startseite.
 */
export function startRouten(app: App, umgebung: AppUmgebung) {
  app.get("/api/start", async (c) =>
    c.json(
      await startZahlen(umgebung.db, c.get("nutzer"), { heute: heute(), eingangsordner: umgebung.eingangsordner }),
    ),
  );

  // Wie viel der Worker noch zu lesen hat; Inhaber und Steuerberatung (Mitarbeiter und Prüfer lehnt die Middleware ab)
  app.get("/api/verarbeitung", async (c) => c.json(await verarbeitungsstand(umgebung.db)));

  app.get("/api/start/kacheln", async (c) => c.json({ ansichten: await kachelnListen(umgebung.db, c.get("nutzer")) }));

  app.put("/api/start/kacheln", async (c) => {
    const nutzer = c.get("nutzer");
    const eingabe = KachelEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "ansichten: bis zu 12 IDs" }, 400);
    const ok = await kachelnSetzen(umgebung.db, nutzer, eingabe.data.ansichten, akteur(nutzer));
    if (!ok) return c.json({ fehler: "Unbekannte Ansicht" }, 404);
    return c.json({ ansichten: await kachelnListen(umgebung.db, nutzer) });
  });
}
