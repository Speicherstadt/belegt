import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { imapOeffnen } from "./imapflow.ts";
import { abrufFehler, bereinigen, GEHEIMNIS_MELDUNG, verbindungPruefen } from "./pruefen.ts";

/*
 * Echtes imapflow gegen einen lokalen TCP-Server, der jeden Befehl mit NO und dem Befehlstext beantwortet: So sieht
 * der Text aus, den imapflow aus responseText macht, samt der Maskierung von " und \ im Passwort.
 */
const echo = (s: net.Socket) => {
  sockets.add(s);
  s.write("* OK bereit\r\n");
  s.on("data", (d) => {
    const text = String(d);
    const tag = text.split(" ")[0];
    s.write(
      /CAPABILITY/.test(text) ? `* CAPABILITY IMAP4rev1\r\n${tag} OK\r\n` : `${tag} NO bad cmd: ${text.trim()}\r\n`,
    );
  });
};

let server: net.Server | undefined;
const sockets = new Set<net.Socket>();
afterEach(() => {
  for (const s of sockets) s.destroy();
  server?.close();
});

const starten = async (verhalten: (s: net.Socket) => void) => {
  server = net.createServer(verhalten);
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  return (server.address() as net.AddressInfo).port;
};

/** Antwortet auf jeden Befehl außer CAPABILITY mit der Zeile, die antwort aus dem Befehlstext macht */
const antwortet =
  (antwort: (tag: string, text: string) => string, caps = "") =>
  (s: net.Socket) => {
    sockets.add(s);
    s.write("* OK bereit\r\n");
    s.on("data", (d) => {
      const text = String(d);
      const tag = text.split(" ")[0]!;
      s.write(/CAPABILITY/.test(text) ? `* CAPABILITY IMAP4rev1 ${caps}\r\n${tag} OK\r\n` : antwort(tag, text.trim()));
    });
  };

describe("Prüfung mit imapflow gegen einen lokalen Server", () => {
  it("liefert ein Passwort mit Umlaut nicht in details, wenn der Server ohne Tag mit NO antwortet (latin1)", async () => {
    const port = await starten(antwortet((_, text) => `NO bad cmd: ${text}\r\n`));
    const passwort = "pässwört€x";
    const r = await verbindungPruefen(
      { name: "x", host: "127.0.0.1", port, tls: false, benutzer: "u", passwort, ordner: "INBOX", art: "imap" },
      imapOeffnen,
      { zeitMs: 4000 },
    );
    expect(r).toMatchObject({ ok: false, details: GEHEIMNIS_MELDUNG });
  });

  it.each(["u@example.org", "ab@example.org", "abc@example.org", "rechnung@gmail.com"])(
    "liefert das Access-Token nicht in der Meldung, wenn der Server die OAUTHBEARER-Zeile zurückgibt (%s)",
    async (benutzer) => {
      const port = await starten(
        antwortet((tag, text) => `${tag} NO bad cmd: ${text}\r\n`, "AUTH=OAUTHBEARER AUTH=XOAUTH2 SASL-IR"),
      );
      const token = "ya29.a0AfH6SMBx-realistisch_langes_Token_0123456789";
      const fehler = await imapOeffnen({
        host: "127.0.0.1",
        port,
        tls: false,
        benutzer,
        passwort: "",
        accessToken: token,
        ordner: "INBOX",
      }).catch((e: unknown) => e);
      expect(fehler).toBeInstanceOf(Error);
      // Die Zeile mit dem Token kommt tatsächlich zurück, nur eben kodiert
      expect(String((fehler as { responseText?: unknown }).responseText)).toContain("OAUTHBEARER");
      expect(abrufFehler(fehler, ["", token])).not.toContain("AUTHENTICATE");
      expect(bereinigen(fehler, ["", token])).toBe(GEHEIMNIS_MELDUNG);
    },
  );

  it('liefert das Passwort mit " und \\ nicht in details, auch wenn der Server den Befehl zurückgibt', async () => {
    server = net.createServer(echo);
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as net.AddressInfo;
    const passwort = 'pa"ss\\wort';
    const r = await verbindungPruefen(
      { name: "x", host: "127.0.0.1", port, tls: false, benutzer: "u", passwort, ordner: "INBOX", art: "imap" },
      imapOeffnen,
      { zeitMs: 4000 },
    );
    expect(r).toEqual({ ok: false, grund: "anmeldung", details: GEHEIMNIS_MELDUNG });
  });
});
