import { afterEach, describe, expect, it, vi } from "vitest";
import type { Eintrag } from "../lib/api.ts";
import { demoServer, liste } from "./antworten.ts";
import type { Aufnahme } from "./aufnahme.ts";

const eintrag = (asn: number, titel: string, tags: string[] = [], typ?: string): Eintrag => ({
  id: `d${asn}`,
  asn,
  sha256: "",
  groesse: 1,
  mimeType: "application/pdf",
  dateiname: `${titel}.pdf`,
  quelle: "upload",
  eingegangenAm: "2026-11-23T10:00:00Z",
  art: null,
  fristBis: null,
  titel,
  tags: tags.map((id) => ({ id, name: `Tag ${id}`, farbe: "grau" })),
  dokumenttyp: typ ? { id: typ, name: "Rechnung" } : null,
  korrespondent: null,
  vorschaubild: false,
  seiten: null,
  ausschnitt: null,
});

const AUFNAHME: Aufnahme = {
  stand: "2026-11-23T10:00:00Z",
  listen: {
    alle: [eintrag(1, "Strom Oktober", ["a"]), eintrag(2, "Holz Rechnung", ["a", "b"], "t"), eintrag(3, "Miete")],
    offen: [eintrag(3, "Miete")],
  },
  antworten: {
    "/api/ich": { status: 200, json: { role: "inhaber" } },
    "/api/dokumente/d2/datei?ansicht=1": { status: 200, typ: "application/pdf", datei: "abc.pdf" },
  },
};

const lesen = async (res: Response) => ({
  status: res.status,
  gesamt: res.headers.get("x-gesamt"),
  titel: ((await res.json()) as Eintrag[]).map((e) => e.titel),
});

describe("Liste der Dokumente in der Demo", () => {
  it("liefert die Gruppe, neueste zuerst, mit der Gesamtzahl", async () => {
    expect(await lesen(liste(AUFNAHME, new URLSearchParams("gruppe=alle")))).toEqual({
      status: 200,
      gesamt: "3",
      titel: ["Miete", "Holz Rechnung", "Strom Oktober"],
    });
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("gruppe=offen")))).titel).toEqual(["Miete"]);
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("gruppe=pflicht")))).gesamt).toBe("0");
  });

  it("sucht in Titel und Tags und filtert nach Tags und Typ", async () => {
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("suche=rechnung")))).titel).toEqual(["Holz Rechnung"]);
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("tag=a&tag=b")))).titel).toEqual(["Holz Rechnung"]);
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("tag=a&tag=b&tagModus=einer")))).gesamt).toBe("2");
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("tagNicht=b")))).titel).toEqual(["Miete", "Strom Oktober"]);
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("ohneTags=1")))).titel).toEqual(["Miete"]);
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("dokumenttyp=t")))).titel).toEqual(["Holz Rechnung"]);
  });

  it("blättert und sortiert", async () => {
    const seite2 = await lesen(liste(AUFNAHME, new URLSearchParams("proSeite=2&seite=2&sortierung=alt")));
    expect(seite2).toEqual({ status: 200, gesamt: "3", titel: ["Miete"] });
    expect((await lesen(liste(AUFNAHME, new URLSearchParams("sortierung=titel")))).titel).toEqual([
      "Holz Rechnung",
      "Miete",
      "Strom Oktober",
    ]);
  });
});

describe("Server der Demo", () => {
  const server = demoServer(
    AUFNAHME,
    (d) => `/assets/${d}`,
    () => "In der Demo nicht möglich",
  );
  afterEach(() => vi.unstubAllGlobals());

  it("antwortet aus der Aufnahme, egal in welcher Reihenfolge die Parameter stehen", async () => {
    const res = await server.beantworten("GET", new URL("http://x/api/ich"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "inhaber" });
  });

  it("lehnt Schreiben ab und kennt Unbekanntes nicht", async () => {
    const schreiben = await server.beantworten("POST", new URL("http://x/api/tags"));
    expect(schreiben.status).toBe(403);
    expect(await schreiben.json()).toEqual({ fehler: "In der Demo nicht möglich" });
    expect((await server.beantworten("GET", new URL("http://x/api/unbekannt"))).status).toBe(404);
  });

  it("liefert Dateien aus der Aufnahme mit ihrem Typ und lenkt Adressen dorthin um", async () => {
    const fetch = vi.fn(async () => new Response("PDF"));
    vi.stubGlobal("fetch", fetch);
    const res = await server.beantworten("GET", new URL("http://x/api/dokumente/d2/datei?ansicht=1"));
    expect(fetch).toHaveBeenCalledWith("/assets/abc.pdf");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("PDF");
    expect(server.adresse("/api/dokumente/d2/datei?ansicht=1")).toBe("/assets/abc.pdf");
    expect(server.adresse("/api/dokumente/d9/datei")).toBe("/api/dokumente/d9/datei");
  });
});
