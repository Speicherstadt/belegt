import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFehler, api, type Quelle } from "../lib/api.ts";
import { MailboxEdit, MailboxEditForm, passwortNoetig, quelleAenderung } from "./MailboxEdit.tsx";

const quelle: Quelle = {
  id: "q1",
  name: "Postfach",
  host: "imap.example.org",
  port: 993,
  tls: true,
  benutzer: "anna@example.org",
  ordner: "INBOX",
  art: "imap",
  oauth: null,
  letzteUid: 0,
  letzterAbruf: null,
  letzterFehler: null,
  aktiv: true,
  aktion: "keine",
  aktionZiel: null,
  aktionZielPfad: null,
  aktionZielPapierkorb: false,
  loeschenWarteStunden: 24,
  loeschenNachSperre: false,
  loeschenBestaetigtVon: null,
  loeschenBestaetigtAm: null,
};

/** Das Formular, wie der Browser es senden würde: Ausgangswerte, darüber die Änderungen */
const formular = (aenderungen: Record<string, string | null> = {}, q: Quelle = quelle) => {
  const f = new FormData();
  const werte: Record<string, string | null> = {
    name: q.name,
    host: q.host,
    port: String(q.port),
    tls: q.tls ? "on" : null,
    benutzer: q.benutzer,
    passwort: "",
    ordner: q.ordner,
    ...aenderungen,
  };
  for (const [k, v] of Object.entries(werte)) if (v !== null) f.set(k, v);
  return f;
};

const zeigen = (q: Quelle = quelle, inhaber = true) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MailboxEdit quelle={q} inhaber={inhaber} />
    </QueryClientProvider>,
  );
const zeigenFormular = (q: Quelle = quelle) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MailboxEditForm quelle={q} fertig={() => {}} />
    </QueryClientProvider>,
  );

describe("Postfach ändern: was gesendet wird", () => {
  it("sendet nichts, wenn nichts geändert ist", () => {
    expect(quelleAenderung(quelle, formular())).toEqual({});
  });

  it("sendet nur die geänderten Felder", () => {
    expect(quelleAenderung(quelle, formular({ name: "Rechnungen", port: "143", tls: null }))).toEqual({
      name: "Rechnungen",
      port: 143,
      tls: false,
    });
  });

  it("sendet ein leeres Passwort nicht, ein ausgefülltes schon", () => {
    expect(quelleAenderung(quelle, formular({ passwort: "" }))).not.toHaveProperty("passwort");
    expect(quelleAenderung(quelle, formular({ passwort: "neu-und-geheim" }))).toEqual({ passwort: "neu-und-geheim" });
  });

  it("ändert bei OAuth nur Name und Ordner", () => {
    const oauth: Quelle = { ...quelle, oauth: "google" };
    expect(quelleAenderung(oauth, formular({ name: "Neu", ordner: "Belege", host: "evil.example" }, oauth))).toEqual({
      name: "Neu",
      ordner: "Belege",
    });
  });
});

describe("Postfach ändern: Passwort Pflicht", () => {
  it("verlangt das Passwort, sobald Server, Port oder Benutzer abweichen, sonst nicht", () => {
    expect(passwortNoetig(quelle, formular())).toBe(false);
    expect(passwortNoetig(quelle, formular({ name: "Neu", ordner: "Belege" }))).toBe(false);
    const abweichungen: Record<string, string>[] = [
      { host: "anders.example.org" },
      { port: "143" },
      { benutzer: "bert@example.org" },
    ];
    for (const a of abweichungen) expect(passwortNoetig(quelle, formular(a)), JSON.stringify(a)).toBe(true);
  });

  it("verlangt das Passwort beim Abschalten von TLS, nicht beim Einschalten", () => {
    expect(passwortNoetig(quelle, formular({ tls: null }))).toBe(true);
    const ohneTls: Quelle = { ...quelle, tls: false };
    expect(passwortNoetig(ohneTls, formular({ tls: "on" }, ohneTls))).toBe(false);
  });

  it("verlangt bei OAuth nie ein Passwort", () => {
    const oauth: Quelle = { ...quelle, oauth: "google" };
    expect(passwortNoetig(oauth, formular({ host: "x.example.org" }, oauth))).toBe(false);
  });
});

describe("Postfach ändern: Formular", () => {
  it("lässt das Passwortfeld leer, nennt den Hinweis und verhindert Autofill", () => {
    const html = zeigenFormular();
    const feld = /<input[^>]*name="passwort"[^>]*>/.exec(html)![0];
    expect(feld).toContain('autoComplete="new-password"');
    expect(feld).not.toContain("value=");
    expect(feld).not.toContain("required");
    expect(html).toContain("Leer lassen, um es zu behalten.");
  });

  it("stellt „Abbrechen“ und „Speichern“ rechtsbündig", () => {
    expect(zeigenFormular()).toMatch(/justify-end[^"]*"><button[^>]*>Abbrechen/);
  });

  it("belegt die übrigen Felder vor und stellt „Abbrechen“ vor „Speichern“", () => {
    const html = zeigenFormular();
    expect(html).toContain('value="imap.example.org"');
    expect(html).toContain('value="anna@example.org"');
    const knoepfe = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((k) => k[1]);
    expect(knoepfe).toEqual(["Abbrechen", "Speichern"]);
  });

  it("bietet bei OAuth weder Server noch Benutzer noch Passwort an", () => {
    const html = zeigenFormular({ ...quelle, oauth: "microsoft" });
    for (const n of ["host", "port", "benutzer", "passwort"]) expect(html).not.toContain(`name="${n}"`);
    expect(html).toContain('name="name"');
    expect(html).toContain('name="ordner"');
    expect(html).toContain("Microsoft 365");
  });
});

describe("Postfach entfernen: Rückfrage", () => {
  it("fragt mit Namen und sagt, was bleibt und dass es sich nicht rückgängig machen lässt", () => {
    const html = zeigen();
    expect(html).toContain("Postfach „Postfach“ entfernen?");
    expect(html).toContain("Bereits archivierte Mails bleiben im Archiv.");
    expect(html).toContain("nicht rückgängig");
  });

  it("zeigt „Ändern“ und „Entfernen“ nur dem Inhaber", () => {
    expect(zeigen(quelle, false)).not.toContain("Entfernen");
    expect(zeigen(quelle, true)).toMatch(/<button[^>]*>Entfernen<\/button>/);
  });
});

describe("Postfach: Aufrufe", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: Response) => {
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("ändert per PATCH mit genau den übergebenen Feldern", async () => {
    const fetchMock = stub(new Response(JSON.stringify(quelle)));
    await api.quelleAendern("q1", { name: "Neu" });
    const [pfad, init] = fetchMock.mock.calls[0]!;
    expect(pfad).toBe("/api/quellen/q1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"name":"Neu"}');
  });

  it("entfernt per DELETE", async () => {
    const fetchMock = stub(new Response(null, { status: 204 }));
    await api.quelleEntfernen("q1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/quellen/q1");
    expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
  });

  it("reicht den Servertext bei 409 weiter", async () => {
    stub(new Response('{"fehler":"Es liegen offene Löschaktionen vor."}', { status: 409 }));
    const fehler = await api.quelleEntfernen("q1").catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(ApiFehler);
    expect(fehler).toMatchObject({ status: 409, message: "Es liegen offene Löschaktionen vor." });
  });
});
