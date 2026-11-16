import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import type { AppUmgebung } from "../http/gemeinsam.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";

/*
 * Jede Route der Schnittstelle, eingeordnet nach dem, was ein Mitarbeiter mit ihr darf (docs/zugaenge.md). Kommt eine
 * Route dazu, schlägt der erste Test fehl, bis sie hier steht; eine Route unter /api/dokumente/:id prüft der zweite
 * mit einem Dokument außerhalb des Sichtbereichs, eine verbotene der dritte. So vergisst niemand eine Route.
 *
 * offen: ohne Anmeldung (der Link ist die Berechtigung); dokument: liefert oder ändert ein einzelnes Dokument;
 * sicht: erlaubt, zeigt nur, was in der Sicht liegt (Tests in mitarbeiter.test.ts); verboten: 403.
 */
const ROUTEN: Record<string, "offen" | "dokument" | "sicht" | "verboten"> = {
  "GET /healthz": "offen",
  "GET /api/auth/*": "offen",
  "POST /api/auth/*": "offen",
  "GET /api/openapi.json": "offen",
  "GET /api/status": "offen",
  "GET /api/einladung/:token": "offen",
  "GET /api/freigabe/:token": "offen",
  "GET /api/geteilt/:token": "offen",
  // Die Oberfläche (statisch.ts): Dateien aus dist, keine Dokumente; /api reicht sie an die Routen oben weiter
  "GET /*": "offen",
  "POST /teilen": "offen",

  "GET /api/dokumente/:id": "dokument",
  "POST /api/dokumente/:id/einordnung": "dokument",
  "POST /api/dokumente/:id/loeschung": "dokument",
  "GET /api/dokumente/:id/datei": "dokument",
  "GET /api/dokumente/:id/ansicht": "dokument",
  "GET /api/dokumente/:id/archivfassung": "dokument",
  "GET /api/dokumente/:id/vorschaubild": "dokument",
  "GET /api/dokumente/:id/inhalt": "dokument",
  "GET /api/dokumente/:id/verlauf": "dokument",
  "GET /api/dokumente/:id/seiten": "dokument",
  "GET /api/dokumente/:id/seiten/:nr": "dokument",
  "POST /api/dokumente/:id/seiten": "dokument",
  "GET /api/dokumente/:id/aehnliche": "dokument",
  "GET /api/dokumente/:id/ableitungen": "dokument",
  "GET /api/dokumente/:id/notizen": "dokument",
  "POST /api/dokumente/:id/notizen": "dokument",
  "POST /api/dokumente/:id/notizen/:notiz/zurueckziehen": "dokument",
  "POST /api/dokumente/:id/ordnung": "dokument",
  "POST /api/dokumente/:id/freigabe": "dokument",
  "POST /api/dokumente/:id/links": "dokument",
  "GET /api/dokumente/:id/links": "dokument",
  "POST /api/dokumente/:id/links/:link/widerrufen": "dokument",
  "GET /api/dokumente/:id/mail": "dokument",
  "GET /api/dokumente/:id/vorschlag": "dokument",

  "GET /api/ich": "sicht",
  "POST /api/dokumente": "sicht",
  "GET /api/dokumente": "sicht",
  "POST /api/dokumente/sammeln": "sicht",
  "GET /api/trennblatt.pdf": "sicht",
  "GET /api/ansichten": "sicht",
  "POST /api/ansichten": "sicht",
  "POST /api/ansichten/reihenfolge": "sicht",
  "PATCH /api/ansichten/:id": "sicht",
  "DELETE /api/ansichten/:id": "sicht",
  "GET /api/start": "sicht",
  "GET /api/start/kacheln": "sicht",
  "PUT /api/start/kacheln": "sicht",
  "GET /api/tags": "sicht",
  "GET /api/dokumenttypen": "sicht",
  "GET /api/korrespondenten": "sicht",
  "GET /api/felder": "sicht",
  // Das eigene Konto (zweiter Faktor): jede Rolle für sich selbst
  "GET /api/konto": "sicht",
  "POST /api/konto/qr": "sicht",

  "GET /api/zugaenge": "verboten",
  "POST /api/einladungen": "verboten",
  "POST /api/einladungen/:id/zurueckziehen": "verboten",
  "PATCH /api/zugaenge/:id": "verboten",
  "POST /api/zugaenge/:id/entziehen": "verboten",
  "POST /api/zugaenge/:id/zwei-faktor-zuruecksetzen": "verboten",
  "GET /api/zwei-faktor": "verboten",
  "PUT /api/zwei-faktor": "verboten",
  "GET /api/tokens": "verboten",
  "POST /api/tokens": "verboten",
  "POST /api/tokens/:id/widerrufen": "verboten",
  "GET /api/loeschungen": "verboten",
  "POST /api/loeschungen/:id/bestaetigen": "verboten",
  "DELETE /api/loeschungen/:id": "verboten",
  "GET /api/sperren": "verboten",
  "POST /api/sperren": "verboten",
  "POST /api/sperren/:id/aufheben": "verboten",
  "GET /api/fristen/uebersicht": "verboten",
  "GET /api/workflows": "verboten",
  "GET /api/workflows/laeufe": "verboten",
  "POST /api/workflows": "verboten",
  "POST /api/workflows/reihenfolge": "verboten",
  "POST /api/workflows/:id/:schalter{aktivieren|deaktivieren}": "verboten",
  "DELETE /api/workflows/:id": "verboten",
  "POST /api/dokumente/zusammenfuegen": "verboten",
  "POST /api/tags": "verboten",
  "PATCH /api/tags/:id": "verboten",
  "DELETE /api/tags/:id": "verboten",
  "POST /api/dokumenttypen": "verboten",
  "PATCH /api/dokumenttypen/:id": "verboten",
  "DELETE /api/dokumenttypen/:id": "verboten",
  "POST /api/korrespondenten": "verboten",
  "PATCH /api/korrespondenten/:id": "verboten",
  "DELETE /api/korrespondenten/:id": "verboten",
  "POST /api/korrespondenten/:id/zusammenfuehren": "verboten",
  "POST /api/felder": "verboten",
  "PATCH /api/felder/:id": "verboten",
  "DELETE /api/felder/:id": "verboten",
  "POST /api/mails": "verboten",
  "GET /api/regeln": "verboten",
  "POST /api/regeln": "verboten",
  "POST /api/regeln/:id/:schalter{aktivieren|deaktivieren}": "verboten",
  "GET /api/quellen": "verboten",
  "POST /api/quellen": "verboten",
  "POST /api/quellen/:id/abrufen": "verboten",
  "GET /api/quellen/:id/ordner": "verboten",
  "POST /api/quellen/:id/aktion": "verboten",
  "GET /api/quellen/:id/aktionen": "verboten",
  "POST /api/quellen/:id/:schalter{aktivieren|deaktivieren}": "verboten",
  "GET /api/einstellungen": "verboten",
  "POST /api/einstellungen": "verboten",
  "GET /api/verfahrensdoku": "verboten",
  "GET /api/export": "verboten",
  "GET /api/zeitstempel": "verboten",
  "GET /api/zeitstempel/:id/token": "verboten",
  "GET /api/pruefung": "verboten",
  "GET /api/betrieb": "verboten",
  "GET /api/mcp": "verboten",
  "DELETE /api/mcp": "verboten",
  "POST /api/mcp": "verboten",
  "GET /api/webhooks": "verboten",
  "POST /api/webhooks": "verboten",
  "POST /api/webhooks/:id/aktivieren": "verboten",
  "POST /api/webhooks/:id/deaktivieren": "verboten",
  "GET /api/oauth": "verboten",
  "GET /api/oauth/:anbieter/start": "verboten",
  "GET /api/oauth/rueckkehr": "verboten",
  "GET /api/paperless/quellen": "verboten",
  "POST /api/paperless/quellen": "verboten",
  "POST /api/paperless/quellen/:id/starten": "verboten",
  "POST /api/paperless/export": "verboten",
  "GET /api/paperless/importe": "verboten",
  "GET /api/paperless/importe/:id/fehler": "verboten",
  "POST /api/paperless/importe/:id/abbrechen": "verboten",
  "GET /api/paperless/zuordnungen": "verboten",
  "POST /api/paperless/zuordnungen": "verboten",
  "DELETE /api/paperless/zuordnungen/:id": "verboten",
};

/** Alle registrierten Routen außer Middleware, als „METHODE /pfad“ */
function registriert(): string[] {
  const umgebung = {
    db: {},
    speicher: {},
    auth: { options: { baseURL: "http://localhost:3000" }, handler: () => new Response() },
    // Mit Oberfläche, damit auch die Routen der statischen Auslieferung (server/http/statisch.ts) hier stehen
    oberflaeche: "/gibt-es-nicht",
  } as unknown as AppUmgebung;
  const app = createApp(umgebung);
  return [...new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`))];
}

/** Ein aufrufbarer Pfad: :id ist das Dokument, :nr die erste Seite, alle anderen Parameter zufällige IDs */
const pfadMit = (muster: string, id: string) =>
  muster
    .replace(":id", id)
    .replace(":nr", "1")
    .replace(/:schalter\{[^}]+\}/, "aktivieren")
    .replace(/:[a-z]+/g, () => randomUUID());

describe("Routen und Mitarbeiter", () => {
  it("kennt jede registrierte Route", () => {
    const neu = registriert().filter((r) => !(r in ROUTEN));
    const weg = Object.keys(ROUTEN).filter((r) => !registriert().includes(r));
    // Eine neue Route hier einordnen und, wenn ein Mitarbeiter sie braucht, in server/zugang/mitarbeiter.ts zulassen
    expect({ neu, weg }).toEqual({ neu: [], weg: [] });
  });
});

describe.skipIf(!testDatenbankUrl)("Routen und Mitarbeiter gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let bearbeiter: string;
  let leser: string;
  let draussen: string;
  let drin: string;

  const anfrage = (methode: string, pfad: string, cookie: string) =>
    t.anfrage(
      pfad,
      methode === "GET" || methode === "HEAD"
        ? { method: methode }
        : { method: methode, headers: { "content-type": "application/json" }, body: "{}" },
      cookie,
    );

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const tag = async (name: string) =>
      (
        (await (
          await t.anfrage(
            "/api/tags",
            { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) },
            inhaber,
          )
        ).json()) as { id: string }
      ).id;
    const projekt = await tag("Projekt X");
    const personal = await tag("Personal");
    const hoch = async (name: string, tagId: string) => {
      const form = new FormData();
      form.append("datei", new File([new TextEncoder().encode(`%PDF-1.7\n% ${name}\n`)], `${name}.pdf`));
      const { id } = (await (await t.anfrage("/api/dokumente", { method: "POST", body: form }, inhaber)).json()) as {
        id: string;
      };
      await t.anfrage(
        `/api/dokumente/${id}/ordnung`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tagsHinzu: [tagId] }),
        },
        inhaber,
      );
      return id;
    };
    drin = await hoch("projekt", projekt);
    draussen = await hoch("personal", personal);
    const sichtbereich = { tags: [projekt] };
    bearbeiter = await zugangAnlegen(t, inhaber, "bearbeiter@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich,
    });
    leser = await zugangAnlegen(t, inhaber, "leser@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich,
    });
  });
  afterAll(() => t?.aufraeumen());

  const dokumentRouten = Object.entries(ROUTEN)
    .filter(([, art]) => art === "dokument")
    .map(([r]) => r);
  const verboten = Object.entries(ROUTEN)
    .filter(([, art]) => art === "verboten")
    .map(([r]) => r);

  it.each(dokumentRouten)("%s: ein Dokument außerhalb des Sichtbereichs gibt es nicht", async (route) => {
    const [methode, muster] = route.split(" ") as [string, string];
    for (const cookie of [bearbeiter, leser]) {
      const res = await anfrage(methode, pfadMit(muster, draussen), cookie);
      // Entweder nicht gefunden, oder der Aufruf ist für Mitarbeiter ganz verboten; nie der Inhalt
      expect([403, 404]).toContain(res.status);
    }
    // Der Inhaber erreicht die Route mit demselben Dokument (seine Antwort hängt von der Route ab, nur nicht 403)
    expect((await anfrage(methode, pfadMit(muster, draussen), inhaber)).status).not.toBe(403);
  });

  it.each(dokumentRouten)(
    "%s: dasselbe mit einem sichtbaren Dokument ist kein „nicht gefunden“ der Middleware",
    async (route) => {
      const [methode, muster] = route.split(" ") as [string, string];
      const res = await anfrage(methode, pfadMit(muster, drin), bearbeiter);
      const body = res.status === 404 ? ((await res.json()) as { fehler?: string }) : {};
      // Eine Route darf 404 aus eigenem Grund antworten (kein PDF, keine Mail), aber nicht wegen des Sichtbereichs
      if (res.status === 404) expect(body.fehler).not.toBe("Nicht gefunden");
    },
  );

  it.each(verboten)("%s: für Mitarbeiter verboten", async (route) => {
    const [methode, muster] = route.split(" ") as [string, string];
    for (const cookie of [bearbeiter, leser])
      expect((await anfrage(methode, pfadMit(muster, drin), cookie)).status).toBe(403);
  });
});
