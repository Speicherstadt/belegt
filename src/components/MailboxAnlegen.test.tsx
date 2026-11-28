import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiFehler, api, type Quelle } from "../lib/api.ts";
import { MailboxAnlegen } from "./MailboxAnlegen.tsx";
import { oauthStart } from "./MailboxAnlegenTeile.tsx";
import { QuelleEintrag, RueckmeldungZeile } from "./Mailboxes.tsx";

// Der Link ins Eingang braucht einen Router; hier zählt nur sein Ziel
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

type Grund = NonNullable<ApiFehler["grund"]>;
const fehler = (grund?: Grund, details?: string) =>
  new ApiFehler(422, "Der Server sagt nein.", undefined, undefined, false, grund, details);

const zeigen = (f: ApiFehler | null = null, laeuft = false, anbieter: ("google" | "microsoft")[] = []) =>
  renderToStaticMarkup(
    <MailboxAnlegen anbieter={anbieter} laeuft={laeuft} fehler={f} onAbsenden={() => {}} onAbbrechen={() => {}} />,
  );

/** Namen der Felder mit aria-invalid */
const ungueltig = (html: string) =>
  [...html.matchAll(/<(?:input|select)[^>]*>/g)]
    .map((t) => t[0])
    .filter((t) => t.includes('aria-invalid="true"'))
    .map((t) => /name="([^"]+)"/.exec(t)![1]);

describe("Postfach anlegen: Fehler der Prüfung", () => {
  const faelle: [Grund, string, string, string | undefined][] = [
    ["anmeldung", "Die Anmeldung wurde abgelehnt.", "Passwort neu eingeben", "passwort"],
    ["server", "Der Server ist nicht erreichbar.", "Server prüfen", "host"],
    ["ordner", "Den Ordner gibt es nicht.", "Ordner ändern", "ordner"],
    ["zeit", "Die Prüfung hat zu lange gedauert.", "Erneut versuchen", undefined],
    ["unbekannt", "Das Postfach konnte nicht geprüft werden.", "Erneut versuchen", undefined],
  ];

  it.each(faelle)(
    "%s: Meldung in drei Teilen mit role=alert, Knopf und markiertem Feld",
    (grund, titel, knopf, feld) => {
      const html = zeigen(fehler(grund, "roh: 535 AUTH"));
      expect(html).toMatch(/<div[^>]*role="alert"[^>]*tabindex="-1"/i);
      expect(html).toContain(titel);
      expect(html).toContain("Gespeichert ist nichts, deine Eingaben stehen noch da.");
      expect(html).toMatch(new RegExp(`<button type="button"[^>]*>${knopf}</button>`));
      expect(ungueltig(html)).toEqual(feld ? [feld] : []);
      // Der Titel der Meldung wird am Feld mitgelesen
      const titelId = /<p id="([^"]+)"[^>]*>/.exec(html)![1];
      if (feld) expect(new RegExp(`<(?:input|select)[^>]*name="${feld}"[^>]*>`).exec(html)![0]).toContain(titelId);
    },
  );

  it("zeigt den Rohtext nur unter „Details“, nie im Titel", () => {
    const html = zeigen(fehler("anmeldung", "roh: 535 AUTH"));
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Details<\/summary><pre[^>]*>roh: 535 AUTH<\/pre>/);
    expect(html.indexOf("roh: 535 AUTH")).toBeGreaterThan(html.indexOf("Details"));
  });

  it("nimmt ohne Status (Netz) „unbekannt“ mit „Erneut versuchen“", () => {
    const html = zeigen({ message: "Failed to fetch" } as ApiFehler);
    expect(html).toContain("Das Postfach konnte nicht geprüft werden.");
    expect(html).toContain("Erneut versuchen");
  });

  it("400: „Angaben unvollständig“, Feld markiert, Knopf springt ins Feld, kein „Erneut versuchen“", () => {
    const f = new ApiFehler(400, "Ungültige Quelle", undefined, undefined, false, undefined, "Too small", "name");
    const html = zeigen(f);
    expect(html).toContain("Angaben unvollständig");
    expect(html).toContain("Bei „Name“ stimmt etwas nicht.");
    expect(html).toContain("Prüfe das markierte Feld.");
    expect(html).toMatch(/<button type="button"[^>]*>Zum Feld<\/button>/);
    expect(html).not.toContain("Erneut versuchen");
    expect(ungueltig(html)).toEqual(["name"]);
    expect(html).toMatch(/<pre[^>]*>Too small<\/pre>/);
  });

  it("400 mit „tls“ nennt das Feld, ohne bekanntes Feld steht ein Satz ohne Feldnamen", () => {
    const mit = (feld?: string) =>
      zeigen(new ApiFehler(400, "Ungültige Quelle", undefined, undefined, false, undefined, "x", feld));
    expect(mit("tls")).toContain("Bei „TLS“ stimmt etwas nicht.");
    for (const html of [mit(), mit("unbekannt")]) {
      expect(html).toContain("Eine Angabe passt nicht.");
      expect(html).not.toContain("Bei „");
    }
  });

  it("503: „Postfach nicht gespeichert“ ohne Knopf, ohne markiertes Feld, Rohtext unter Details", () => {
    const html = zeigen(new ApiFehler(503, "BELEGT_SCHLUESSEL fehlt auf dem Server"));
    expect(html).toContain("Postfach nicht gespeichert");
    expect(html).toContain("Belegt kann gerade keine Postfächer anlegen.");
    expect(html).toContain("Wende dich an die Person, die Belegt betreibt.");
    expect(html).not.toMatch(/<button type="button"[^>]*>(Erneut|Zum)/);
    expect(ungueltig(html)).toEqual([]);
    expect(html).toMatch(/<pre[^>]*>BELEGT_SCHLUESSEL fehlt auf dem Server<\/pre>/);
  });

  it("stürzt bei einer 400-Antwort mit details als Array nicht ab und zeigt die erste Meldung", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ fehler: "Ungültige Eingabe", details: [{ path: ["host"], message: "Zu lang" }] }),
            { status: 400 },
          ),
      ),
    );
    const f = await api.quelleAnlegen({} as never).catch((e: unknown) => e as ApiFehler);
    vi.unstubAllGlobals();
    expect(() => zeigen(f as ApiFehler)).not.toThrow();
    expect(zeigen(f as ApiFehler)).toMatch(/<pre[^>]*>Zu lang<\/pre>/);
    expect(ungueltig(zeigen(f as ApiFehler))).toEqual(["host"]);
  });

  it("begrenzt die Felder wie der Server (Name 200, Server 253, Benutzer 320, Passwort 1000, Ordner 200)", () => {
    const html = zeigen();
    const grenze = (name: string) =>
      new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)![0].match(/maxLength="(\d+)"/)?.[1];
    expect(["name", "host", "benutzer", "passwort", "ordner"].map(grenze)).toEqual([
      "200",
      "253",
      "320",
      "1000",
      "200",
    ]);
  });

  it("zeigt ohne Fehler keine Meldung und keine markierten Felder", () => {
    const html = zeigen();
    expect(html).not.toContain('role="alert"');
    expect(ungueltig(html)).toEqual([]);
  });
});

describe("Postfach anlegen: Prüfung läuft", () => {
  it("setzt aria-busy am Knopf (nicht disabled), sperrt Felder und „Abbrechen“ und nennt den Grund", () => {
    const html = zeigen(null, true);
    const knopf = /<button[^>]*type="submit"[^>]*>/.exec(html)![0];
    expect(knopf).toContain('aria-busy="true"');
    expect(knopf).not.toContain("disabled");
    expect(html).toContain("Läuft …");
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Abbrechen<\/button>/);
    expect(html).toMatch(/<p id="[^"]+" role="status"[^>]*>Belegt prüft die Verbindung\./);
  });

  it("zeigt ohne Lauf „Postfach anlegen“ und keine Statuszeile", () => {
    const html = zeigen();
    expect(html).toContain("Postfach anlegen");
    expect(html).not.toContain("Belegt prüft die Verbindung. Das");
    expect(/<button[^>]*type="submit"[^>]*>/.exec(html)![0]).toContain('aria-busy="false"');
  });
});

describe("Postfach anlegen: OAuth", () => {
  it("zeigt ohne Anbieter keinen OAuth-Teil", () => {
    const html = zeigen();
    expect(html).not.toContain("Mit deinem Konto verbinden");
    expect(html).not.toContain("Mit Zugangsdaten verbinden");
  });

  it("zeigt „Ordner: INBOX“ mit „Ändern“ und gibt den Ordner an den Start-Link", () => {
    const html = zeigen(null, false, ["google"]);
    expect(html).toContain("Ordner: INBOX");
    expect(html).toMatch(/<button[^>]*>Ändern<\/button>/);
    expect(html).toContain("/api/oauth/google/start?name=Google&amp;ordner=INBOX");
  });

  it("hängt den geänderten Ordner an, bei leerem Feld entfällt er", () => {
    expect(oauthStart("microsoft", " Belege 2025 ")).toBe(
      "/api/oauth/microsoft/start?name=Microsoft%20365&ordner=Belege%202025",
    );
    expect(oauthStart("google", "   ")).toBe("/api/oauth/google/start?name=Google");
  });
});

describe("Rückmeldung über der Liste", () => {
  it("zeigt nach dem Anlegen role=status mit Link zum Eingang", () => {
    const html = renderToStaticMarkup(<RueckmeldungZeile rueckmeldung={{ art: "angelegt", name: "Rechnungen" }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Postfach „Rechnungen“ angelegt. Erster Abruf läuft, neue Mails erscheinen im Eingang.");
    expect(html).toMatch(/<a href="\/eingang"[^>]*>Zum Eingang<\/a>/);
  });

  it("zeigt nach der Rückkehr vom Anbieter denselben Link, bei Fehlschlag role=alert ohne Link", () => {
    expect(renderToStaticMarkup(<RueckmeldungZeile rueckmeldung={{ art: "verbunden" }} />)).toContain("Zum Eingang");
    const fehlschlag = renderToStaticMarkup(<RueckmeldungZeile rueckmeldung={{ art: "fehler" }} />);
    expect(fehlschlag).toContain('role="alert"');
    expect(fehlschlag).not.toContain("Zum Eingang");
  });
});

describe("Listeneintrag", () => {
  const quelle = {
    id: "q1",
    name: "Rechnungen",
    host: "imap.example.org",
    port: 993,
    benutzer: "anna@example.org",
    ordner: "INBOX",
    art: "imap",
    oauth: null,
    letzterAbruf: null,
    letzterFehler: null,
    aktion: "keine",
  } as Quelle;
  const eintrag = (q: Quelle) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <QuelleEintrag q={q} schreiben inhaber abrufenGesperrt={false} onAbrufen={() => {}} nachEntfernen={() => {}} />
      </QueryClientProvider>,
    );

  it("zeigt ohne Abruf „Noch nicht abgerufen“, mit Fehler den Fehler", () => {
    expect(eintrag(quelle)).toContain("Noch nicht abgerufen");
    const html = eintrag({ ...quelle, letzterFehler: "Anmeldung abgelehnt" });
    expect(html).toContain("Fehler: Anmeldung abgelehnt");
  });

  it("macht „Jetzt abrufen“, „Ändern“, „Entfernen“ und „Aktion ändern“ mindestens 40 px (am Touch-Gerät 44 px) hoch", () => {
    const html = eintrag({ ...quelle, aktion: "keine" });
    for (const text of ["Jetzt abrufen", "Entfernen", "Ändern", "Aktion ändern"]) {
      const knopf = new RegExp(`<button[^>]*class="([^"]*)"[^>]*>${text}</button>`).exec(html);
      expect(knopf?.[1], text).toContain("h-10 pointer-coarse:h-11");
    }
  });
});
