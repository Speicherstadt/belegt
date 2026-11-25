import {
  abrufen,
  type Ordner,
  QuelleAenderung,
  QuelleEingabe,
  aendern as quelleAendern,
  anlegen as quelleAnlegen,
  entfernen as quelleEntfernen,
  listen as quellenListen,
  aktivSetzen as quelleSchalten,
} from "../mail/abruf.ts";
import { AktionEingabe, aktionEinstellen, ordnerListen, protokoll } from "../mail/aktionen.ts";
import { type App, type AppUmgebung, akteur, Id, nurInhaber } from "./gemeinsam.ts";

export function quellenRouten(app: App, umgebung: AppUmgebung) {
  verwaltungRouten(app, umgebung);
  abrufRouten(app, umgebung);
  aktionRouten(app, umgebung);
}

// Postfächer: das Passwort geht nur hinein, nie hinaus; ohne BELEGT_SCHLUESSEL lassen sie sich nicht anlegen
function verwaltungRouten(app: App, umgebung: AppUmgebung) {
  app.get("/api/quellen", async (c) => c.json(await quellenListen(umgebung.db)));

  app.post("/api/quellen", async (c) => {
    if (!umgebung.schluessel) return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    const eingabe = QuelleEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success)
      return c.json(
        {
          fehler: "Ungültige Quelle",
          details: eingabe.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    return c.json(await quelleAnlegen(umgebung.db, umgebung.schluessel, eingabe.data, akteur(c.get("nutzer"))), 201);
  });

  // Ändern und Entfernen wie die Aktionen: nur der Inhaber mit Sitzung
  app.patch("/api/quellen/:id", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    const eingabe = QuelleAenderung.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success)
      return c.json(
        {
          fehler: eingabe.error.issues[0]?.message ?? "Ungültige Quelle",
          details: eingabe.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    if (eingabe.data.passwort !== undefined && !umgebung.schluessel)
      return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    const q = await quelleAendern(
      umgebung.db,
      umgebung.schluessel ?? Buffer.alloc(0),
      id.data,
      eingabe.data,
      akteur(c.get("nutzer")),
    );
    if (!q) return c.json({ fehler: "Nicht gefunden" }, 404);
    return "fehler" in q ? c.json(q, 400) : c.json(q);
  });

  app.delete("/api/quellen/:id", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    const r = id.success ? await quelleEntfernen(umgebung.db, id.data, akteur(c.get("nutzer"))) : "unbekannt";
    if (r === "unbekannt") return c.json({ fehler: "Nicht gefunden" }, 404);
    if (r === "protokoll")
      return c.json(
        {
          fehler:
            "Zu diesem Postfach gibt es Aktionen im Protokoll, das sich nicht löschen lässt. Deaktivieren statt Entfernen.",
        },
        409,
      );
    return c.body(null, 204);
  });
}

function abrufRouten(app: App, umgebung: AppUmgebung) {
  app.post("/api/quellen/:id/abrufen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    if (!umgebung.schluessel || !umgebung.oeffnen)
      return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    return c.json(
      await abrufen(umgebung, umgebung.schluessel, id.data, umgebung.oeffnen, {
        oauth: umgebung.oauth,
        abfragen: umgebung.abfragen,
      }),
    );
  });

  // Ordner des Kontos, für die Wahl des Zielordners beim Verschieben
  app.get("/api/quellen/:id/ordner", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    if (!umgebung.schluessel || !umgebung.oeffnen)
      return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    try {
      const ordner = await ordnerListen(umgebung, umgebung.schluessel, id.data, umgebung.oeffnen, {
        oauth: umgebung.oauth,
        abfragen: umgebung.abfragen,
      });
      return ordner ? c.json({ ordner }) : c.json({ fehler: "Nicht gefunden" }, 404);
    } catch (err) {
      return c.json({ fehler: `Postfach nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  });
}

function aktionRouten(app: App, umgebung: AppUmgebung) {
  // Aktion nach dem Abholen; verschieben nur in einen Ordner, den es gibt, löschen nur mit Bestätigung
  app.post("/api/quellen/:id/aktion", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    const eingabe = AktionEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success)
      return c.json(
        {
          fehler: eingabe.error.issues[0]?.message ?? "Ungültige Aktion",
          details: eingabe.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    let ziel: Ordner | null = null;
    if (eingabe.data.aktion === "verschieben") {
      if (!umgebung.schluessel || !umgebung.oeffnen)
        return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
      let ordner: Ordner[] | null;
      try {
        ordner = await ordnerListen(umgebung, umgebung.schluessel, id.data, umgebung.oeffnen, {
          oauth: umgebung.oauth,
          abfragen: umgebung.abfragen,
        });
      } catch (err) {
        return c.json(
          { fehler: `Postfach nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` },
          502,
        );
      }
      if (!ordner) return c.json({ fehler: "Nicht gefunden" }, 404);
      ziel = ordner.find((o) => o.id === eingabe.data.ziel) ?? null;
      if (!ziel) return c.json({ fehler: `Den Ordner „${eingabe.data.ziel}“ gibt es im Postfach nicht` }, 400);
      // Ein Papierkorb leert sich von selbst: Verschieben dorthin ist Löschen und braucht dieselbe Bestätigung
      if (ziel.papierkorb && !eingabe.data.loeschenBestaetigt)
        return c.json(
          {
            fehler: `„${ziel.pfad}“ ist ein Papierkorb; Verschieben dorthin muss wie Löschen ausdrücklich bestätigt werden`,
          },
          400,
        );
    }
    // Ohne S3 mit Object Lock gibt es keine Sperre, auf die das Löschen warten könnte; es würde nie gelöscht
    if ((eingabe.data.aktion === "loeschen" || ziel?.papierkorb) && eingabe.data.nachSperre && !umgebung.objektsperre)
      return c.json({ fehler: "„Erst nach Sperre“ geht nur mit S3 und Object Lock" }, 400);
    const q = await aktionEinstellen(umgebung.db, id.data, eingabe.data, akteur(c.get("nutzer")), ziel);
    if (!q) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json((await quellenListen(umgebung.db)).find((x) => x.id === q.id));
  });

  // Stand der Warteschlange und Protokoll der Aktionen
  app.get("/api/quellen/:id/aktionen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json({ ...(await protokoll(umgebung.db, id.data)), objektsperre: umgebung.objektsperre ?? false });
  });

  app.post("/api/quellen/:id/:schalter{aktivieren|deaktivieren}", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const q = id.success
      ? await quelleSchalten(umgebung.db, id.data, c.req.param("schalter") === "aktivieren", akteur(c.get("nutzer")))
      : null;
    return q ? c.json(q) : c.json({ fehler: "Nicht gefunden" }, 404);
  });
}
