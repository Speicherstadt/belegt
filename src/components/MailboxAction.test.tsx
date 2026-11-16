import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Quelle } from "../lib/api.ts";
import { Formular } from "./MailboxAction.tsx";

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
  aktion: "loeschen",
  aktionZiel: null,
  aktionZielPfad: null,
  aktionZielPapierkorb: false,
  loeschenWarteStunden: 24,
  loeschenNachSperre: true,
  loeschenBestaetigtVon: "nutzer:anna@example.org",
  loeschenBestaetigtAm: "2026-11-01T10:00:00Z",
};

const zeigen = (client: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Formular quelle={quelle} fertig={() => {}} />
    </QueryClientProvider>,
  );
const speichern = (html: string) => /<button type="submit"[^>]*>/.exec(html)![0];

describe("Aktion nach dem Abholen: Formular", () => {
  it("speichert Löschen erst, wenn bekannt ist, ob es „erst nach Sperre“ gibt; sonst fiele die Sperre still weg", () => {
    const html = zeigen(new QueryClient());
    expect(html).not.toContain('name="sperre"');
    expect(speichern(html)).toContain('disabled=""');
  });

  it("zeigt mit S3 „erst nach Sperre“ mit dem bisherigen Wert und lässt speichern", () => {
    const client = new QueryClient();
    client.setQueryData(["quelle-aktionen", "q1"], {
      stand: { offen: 0, erledigt: 0, entfallen: 0, fehlgeschlagen: 0 },
      eintraege: [],
      objektsperre: true,
    });
    const html = zeigen(client);
    expect(html).toMatch(/<input type="checkbox"[^>]*name="sperre" checked=""/);
    expect(speichern(html)).not.toContain('disabled=""');
  });

  it("sagt beim Löschen, dass der erste Abruf und ein neu nummerierter Ordner alle archivierten Mails betreffen", () => {
    const html = zeigen(new QueryClient());
    const hinweis = /<p role="note"[^>]*>(.*?)<\/p>/.exec(html)![1]!;
    expect(hinweis).toContain("ersten Abruf");
    expect(hinweis).toContain("UIDVALIDITY");
  });
});
