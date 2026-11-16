import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Löschen und Verschieben über imapflow: Ohne UIDPLUS (RFC 4315) schickt imapflow ein einfaches EXPUNGE, das alle als
 * \Deleted markierten Mails im Ordner entfernt, auch solche, die nie im Archiv waren (imapflow
 * dist/esm/commands/expunge.js; ohne MOVE emuliert commands/move.js das Verschieben mit COPY und messageDelete).
 */
const client = {
  capabilities: new Map<string, boolean | number>(),
  aufrufe: [] as string[],
};

vi.mock("imapflow", () => ({
  // biome-ignore lint/complexity/useArrowFunction: imapflow.ts ruft new ImapFlow(), eine Pfeilfunktion ist kein Konstruktor
  ImapFlow: vi.fn(function () {
    return {
      get capabilities() {
        return client.capabilities;
      },
      connect: async () => {},
      logout: async () => {},
      mailboxOpen: async () => ({ uidValidity: 7n }),
      messageDelete: async (range: string) => {
        client.aufrufe.push(`delete ${range}`);
        return true;
      },
      messageMove: async (range: string, ziel: string) => {
        client.aufrufe.push(`move ${range} ${ziel}`);
        return { path: "INBOX", destination: ziel };
      },
      messageFlagsAdd: async () => true,
    };
  }),
}));

const { imapOeffnen } = await import("./imapflow.ts");

const zugang = {
  host: "imap.example.org",
  port: 993,
  tls: true,
  benutzer: "anna@example.org",
  passwort: "geheim",
  ordner: "INBOX",
  schreiben: true,
};

describe("imapflow: Löschen und Verschieben nur über die UID", () => {
  beforeEach(() => {
    client.aufrufe = [];
  });

  it("löscht ohne UIDPLUS nicht, weil EXPUNGE auch andere als gelöscht markierte Mails entfernen würde", async () => {
    client.capabilities = new Map([["IMAP4rev1", true]]);
    const postfach = await imapOeffnen(zugang);
    await expect(postfach.bearbeiten!.loeschen(5)).rejects.toThrow(/UIDPLUS/);
    expect(client.aufrufe).toEqual([]);
  });

  it("verschiebt ohne MOVE und ohne UIDPLUS nicht (COPY und EXPUNGE)", async () => {
    client.capabilities = new Map([["IMAP4rev1", true]]);
    const postfach = await imapOeffnen(zugang);
    await expect(postfach.bearbeiten!.verschieben(5, "Archiv")).rejects.toThrow(/UIDPLUS/);
    expect(client.aufrufe).toEqual([]);
  });

  it("löscht und verschiebt mit UIDPLUS über die UID; mit MOVE auch ohne UIDPLUS", async () => {
    client.capabilities = new Map([["UIDPLUS", true]]);
    const postfach = await imapOeffnen(zugang);
    await postfach.bearbeiten!.loeschen(5);
    await postfach.bearbeiten!.verschieben(6, "Archiv");
    client.capabilities = new Map([["MOVE", true]]);
    await postfach.bearbeiten!.verschieben(7, "Archiv");
    expect(client.aufrufe).toEqual(["delete 5", "move 6 Archiv", "move 7 Archiv"]);
  });
});
