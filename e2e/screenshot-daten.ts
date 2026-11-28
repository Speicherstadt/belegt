import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { POSTFACH_PASSWORT } from "./postfach-zugang.ts";
import { type Brief, brief, CII } from "./screenshot-brief.ts";

/*
 * Erfundene Daten für die Bilder in README und Doku (e2e/screenshots.ts): Firmen, Briefe als echte PDFs, eine
 * ZUGFeRD-Rechnung, Mails, Ordnung, Workflows, Zugänge und die Angaben zum Betrieb.
 */

const UBL = readFileSync(new URL("../server/inhalt/beispiele/ubl.xml", import.meta.url), "utf8");
const json = (data: unknown) => ({ data });

type Anfragen = Page["request"];

const MUSTERBANK = { absender: "Musterbank eG", anschrift: "Marktplatz 1 · 12345 Musterstadt" };

/**
 * Die Dokumente in der Reihenfolge des Eingangs. Ohne einordnung bleiben sie im Eingang; tags und typ nach Namen
 * (ordnungAnlegen), loeschen beantragt die Löschung (Frist abgelaufen, die zweite Person fehlt noch).
 */
const DOKUMENTE: {
  datei: string;
  brief: Brief;
  efaktura?: boolean;
  einordnung?: object;
  ordnung?: { tags?: string[]; typ?: string; betrag?: string };
  loeschen?: boolean;
}[] = [
  {
    datei: "Stadtwerke-Rechnung-Oktober.pdf",
    brief: {
      absender: "Stadtwerke Musterstadt",
      anschrift: "Am Wasserturm 3 · 12345 Musterstadt",
      titel: "Rechnung Strom Oktober 2026",
      datum: "31.10.2026",
      zeilen: ["Kundennummer 40 18 22 7", "Abrechnungszeitraum 01.10.2026 bis 31.10.2026"],
      posten: [
        ["Arbeitspreis 236 kWh", "70,80 €"],
        ["Grundpreis", "13,40 €"],
      ],
      summe: "84,20 €",
    },
    einordnung: {
      art: "beleg",
      entstanden: "2026-10-31",
      titel: "Strom Oktober",
      korrespondent: "Stadtwerke Musterstadt",
    },
    ordnung: { betrag: "84,20" },
  },
  {
    datei: "HK-2026-1187.pdf",
    efaktura: true,
    brief: {
      absender: "Holzhandel Kranich GmbH",
      anschrift: "Sägewerkstraße 12 · 23456 Beispielfeld",
      titel: "Rechnung HK-2026-1187",
      datum: "03.11.2026",
      zeilen: ["Lieferung vom 28.10.2026, Lieferschein 7781", "Zahlbar innerhalb von 14 Tagen ohne Abzug."],
      posten: [
        ["Eiche Leimholz 40 mm, 6 Platten", "780,00 €"],
        ["Buche Kantholz, 24 lfm", "312,00 €"],
        ["Lieferung", "148,00 €"],
        ["Umsatzsteuer 19 %", "235,60 €"],
      ],
      summe: "1.475,60 €",
    },
  },
  {
    datei: "Mietvertrag-Werkstatt.pdf",
    brief: {
      absender: "Hausverwaltung Lindenhof",
      anschrift: "Lindenallee 8 · 12345 Musterstadt",
      titel: "Mietvertrag Gewerberaum",
      datum: "01.03.2024",
      zeilen: [
        "Mietgegenstand: Werkstatt und Büro, Erdgeschoss, 180 m²",
        "Mietbeginn 01.03.2024, Laufzeit zehn Jahre",
        "Monatliche Miete 1.950,00 € zuzüglich Nebenkosten",
      ],
    },
    einordnung: {
      art: "freiwillig",
      entstanden: "2024-03-01",
      freiwilligBis: "2034-02-28",
      titel: "Mietvertrag Werkstatt",
      korrespondent: "Hausverwaltung Lindenhof",
    },
    ordnung: { tags: ["Fixkosten", "Büro"], typ: "Vertrag" },
  },
  {
    datei: "Angebot-Hobelbank.pdf",
    brief: {
      absender: "Maschinenbau Petersen KG",
      anschrift: "Hafenstraße 40 · 34567 Nordhafen",
      titel: "Angebot 2026-311: Hobelbank mit Zubehör",
      datum: "15.09.2026",
      zeilen: ["Vielen Dank für Ihre Anfrage. Gerne bieten wir an:"],
      posten: [
        ["Hobelbank Buche 2,10 m", "1.890,00 €"],
        ["Werkzeugschrank", "640,00 €"],
      ],
      summe: "2.530,00 €",
    },
    einordnung: {
      art: "geschaeftsbrief",
      entstanden: "2026-09-15",
      titel: "Angebot Hobelbank",
      korrespondent: "Maschinenbau Petersen KG",
    },
    ordnung: { tags: ["Büro"] },
  },
  {
    datei: "Police-Betriebshaftpflicht.pdf",
    brief: {
      absender: "Nordlicht Versicherung AG",
      anschrift: "Deichweg 2 · 45678 Küstenstadt",
      titel: "Versicherungsschein Betriebshaftpflicht",
      datum: "02.01.2026",
      zeilen: ["Versicherungsnummer BH-55 210 88", "Versicherungsbeginn 01.01.2026, jährliche Verlängerung"],
    },
    einordnung: {
      art: "freiwillig",
      entstanden: "2026-01-02",
      freiwilligBis: "2032-12-31",
      titel: "Betriebshaftpflicht",
      korrespondent: "Nordlicht Versicherung AG",
    },
    ordnung: { typ: "Vertrag" },
  },
  {
    datei: "Kontoauszug-2026-10.pdf",
    brief: {
      ...MUSTERBANK,
      titel: "Kontoauszug 10/2026",
      datum: "31.10.2026",
      zeilen: ["Geschäftskonto DE00 1234 5678 0000 4711 00"],
      posten: [
        ["Hausverwaltung Lindenhof, Miete Oktober", "-1.950,00 €"],
        ["Stadtwerke, Abschlag Strom", "-84,20 €"],
        ["Tischlerei Auftrag 2026-14, Zahlung", "4.200,00 €"],
      ],
    },
    einordnung: {
      art: "beleg",
      entstanden: "2026-10-31",
      titel: "Kontoauszug Oktober",
      korrespondent: "Musterbank eG",
    },
  },
  {
    datei: "Scan-Tankquittung.pdf",
    brief: {
      absender: "Tankstelle am Ring",
      anschrift: "Ringstraße 90 · 12345 Musterstadt",
      titel: "Quittung",
      datum: "05.11.2026",
      zeilen: ["Diesel 48,2 l"],
      posten: [["Diesel", "81,46 €"]],
      summe: "81,46 €",
    },
  },
  {
    datei: "Scan-Bewirtung.pdf",
    brief: {
      absender: "Gasthaus Zur Linde",
      anschrift: "Dorfplatz 4 · 12345 Musterstadt",
      titel: "Bewirtungsbeleg",
      datum: "06.11.2026",
      zeilen: ["Anlass: Besprechung Auftrag Ladenbau", "Teilnehmer: A. Muster, J. Beispiel"],
      posten: [["2 Mittagstische, Getränke", "54,80 €"]],
      summe: "54,80 €",
    },
  },
  {
    datei: "Kontoauszug-2016-05.pdf",
    brief: {
      ...MUSTERBANK,
      titel: "Kontoauszug 05/2016",
      datum: "31.05.2016",
      zeilen: ["Geschäftskonto DE00 1234 5678 0000 4711 00"],
    },
    einordnung: {
      art: "beleg",
      entstanden: "2016-05-31",
      titel: "Kontoauszug Mai 2016",
      korrespondent: "Musterbank eG",
    },
    loeschen: true,
  },
];

const anlegen = async (r: Anfragen, pfad: string, body: object) =>
  ((await (await r.post(pfad, json(body))).json()) as { id: string }).id;

const hochladen = async (r: Anfragen, name: string, buffer: Buffer, mimeType = "application/pdf") =>
  (await (await r.post("/api/dokumente", { multipart: { datei: { name, mimeType, buffer } } })).json()) as {
    id: string;
  };

/** Tags, Dokumenttypen und Felder; zurück die IDs nach Namen */
async function ordnungAnlegen(r: Anfragen) {
  const tags: Record<string, string> = {};
  for (const [name, farbe] of [
    ["Steuer 2026", "blau"],
    ["Fixkosten", "gruen"],
    ["Büro", "violett"],
    ["Material", "orange"],
  ] as const)
    tags[name] = await anlegen(r, "/api/tags", { name, farbe });
  const typen: Record<string, string> = {};
  for (const [name, vorgabeArt] of [
    ["Rechnung", "beleg"],
    ["Vertrag", null],
    ["Kontoauszug", "beleg"],
  ])
    typen[name as string] = await anlegen(r, "/api/dokumenttypen", { name, vorgabeArt });
  const betrag = await anlegen(r, "/api/felder", { name: "Betrag", typ: "betrag" });
  await anlegen(r, "/api/felder", { name: "Fällig am", typ: "datum" });
  return { tags, typen, betrag };
}

type Ordnung = Awaited<ReturnType<typeof ordnungAnlegen>>;

async function workflowsAnlegen(r: Anfragen, { tags, typen }: Ordnung) {
  await r.post(
    "/api/workflows",
    json({
      name: "Stadtwerke als Fixkosten",
      ausloeser: "eingang",
      bedingungen: { textEnthaelt: "Stadtwerke Musterstadt" },
      aktionen: [
        { art: "tagsHinzu", tags: [tags.Fixkosten, tags["Steuer 2026"]] },
        { art: "dokumenttyp", dokumenttyp: typen.Rechnung },
      ],
    }),
  );
  await r.post(
    "/api/workflows",
    json({
      name: "Rechnungen an die Buchhaltung",
      ausloeser: "eingeordnet",
      bedingungen: { tags: [tags["Steuer 2026"]] },
      aktionen: [
        {
          art: "senden",
          url: "https://buchhaltung.example/api/belege",
          dateifeld: "datei",
          kopfzeile: { name: "Authorization", wert: "Bearer e2e-token" },
          felder: [{ name: "titel", wert: "{titel}" }],
        },
      ],
    }),
  );
}

/** Die Dokumente aus DOKUMENTE, dazu die XRechnung; zurück die IDs nach Dateiname */
async function dokumenteAnlegen(r: Anfragen, { tags, typen, betrag }: Ordnung) {
  const ids: Record<string, string> = {};
  for (const d of DOKUMENTE) {
    const pdf = await brief(d.brief, d.efaktura ? { name: "factur-x.xml", xml: CII } : undefined);
    const { id } = await hochladen(r, d.datei, pdf);
    ids[d.datei] = id;
    if (d.einordnung) await r.post(`/api/dokumente/${id}/einordnung`, json(d.einordnung));
    const o = d.ordnung;
    if (o)
      await r.post(
        `/api/dokumente/${id}/ordnung`,
        json({
          tagsHinzu: (o.tags ?? []).map((t) => tags[t]),
          ...(o.typ ? { dokumenttyp: typen[o.typ] } : {}),
          ...(o.betrag ? { felder: [{ feldId: betrag, wert: o.betrag }] } : {}),
        }),
      );
    if (d.loeschen) await r.post(`/api/dokumente/${id}/loeschung`, json({}));
    // Die XRechnung kommt nach dem Kontoauszug von Oktober, vor den Scans
    if (d.datei === "Kontoauszug-2026-10.pdf") {
      const x = await hochladen(r, "xrechnung-2026-77.xml", Buffer.from(UBL), "application/xml");
      await r.post(`/api/dokumente/${x.id}/ordnung`, json({ tagsHinzu: [tags.Material], dokumenttyp: typen.Rechnung }));
    }
  }
  return ids;
}

/** Mail, Postfach, Sperre, Einladungen für Prüfer und Steuerberatung, Angaben zum Betrieb */
async function betriebAnlegen(r: Anfragen) {
  const eml = [
    "From: Buchhaltung Kranich <rechnung@holzhandel-kranich.example>",
    "To: anna@example.org",
    "Subject: Ihre Rechnung HK-2026-1187",
    "Message-ID: <screenshot-1@holzhandel-kranich.example>",
    "Date: Tue, 3 Nov 2026 09:12:00 +0100",
    "",
    "Guten Tag, anbei die Rechnung zur Lieferung vom 28.10.",
    "",
  ].join("\r\n");
  await r.post("/api/mails", {
    multipart: { datei: { name: "rechnung.eml", mimeType: "message/rfc822", buffer: Buffer.from(eml) } },
  });
  await r.post(
    "/api/quellen",
    json({
      name: "Buchhaltung",
      // Ein Host unter .test: e2e/server.ts bildet ihn nach, sonst bestünde die Prüfung beim Anlegen nicht
      host: "imap.muster-werkstatt.test",
      benutzer: "buchhaltung@muster-werkstatt.example",
      passwort: POSTFACH_PASSWORT,
    }),
  );
  await r.post("/api/sperren", json({ grund: "Außenprüfung 2023", von: "2023-01-01", bis: "2023-12-31" }));
  await r.post("/api/einladungen", json({ rolle: "pruefer", zeitraum: { von: "2023-01-01", bis: "2023-12-31" } }));
  await r.post("/api/einladungen", json({ rolle: "steuerberatung" }));
  await r.post(
    "/api/einstellungen",
    json({
      firma: "Muster Werkstatt GmbH",
      anschrift: "Musterweg 1, 12345 Musterstadt",
      verantwortlich: "Anna Muster",
      aufsicht: false,
      datensicherung: "Täglich verschlüsselt auf ein zweites Gerät, monatlich Wiederherstellung geprüft.",
      papierbelege: "Papier wird nach dem Scannen ein Jahr aufbewahrt.",
      ergaenzungen: "",
      rechtsform: "GmbH",
      aufbewahrungsort: "Server und Sicherungen im Büro in Musterstadt, Deutschland.",
      serverbetrieb: "Anna Muster betreibt den Server selbst und spielt Updates monatlich ein.",
      schluesselablage: "Im Tresor des Büros.",
    }),
  );
}

/** Legt alles an und wartet, bis der E2E-Server die Inhalte gelesen hat (Text, E-Rechnungen, Vorschaubilder) */
export async function vorbereiten(page: Page) {
  const r = page.request;
  const ordnung = await ordnungAnlegen(r);
  await workflowsAnlegen(r, ordnung);
  const ids = await dokumenteAnlegen(r, ordnung);
  await betriebAnlegen(r);
  await expect
    .poll(async () => (await (await r.get("/api/dokumente?suche=Leimholz")).json()).length, { timeout: 30_000 })
    .toBe(1);
  return {
    holz: { id: ids["HK-2026-1187.pdf"] as string },
    steuer: ordnung.tags["Steuer 2026"],
    material: ordnung.tags.Material,
    rechnung: ordnung.typen.Rechnung,
    betrag: ordnung.betrag,
  };
}
