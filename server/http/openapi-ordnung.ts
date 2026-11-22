/*
 * OpenAPI für Tags, Dokumenttypen, Korrespondenten, eigene Felder, die Sammelbearbeitung und den ZIP-Download (docs/ordnung.md); nur, was ein API-Token
 * erreicht: lesen und zuweisen, nicht anlegen.
 */

const uuid = { type: "string", format: "uuid" } as const;
const datum = { type: "string", format: "date" } as const;
const json = (schema: object) => ({ "application/json": { schema } });
const fehler = {
  description: "Fehler",
  content: json({ type: "object", properties: { fehler: { type: "string" } } }),
};
const idParam = { name: "id", in: "path", required: true, schema: uuid } as const;
const art = {
  type: "string",
  enum: ["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige", "freiwillig", "frei"],
} as const;

export const tagKurz = {
  type: "object",
  required: ["id", "name", "farbe"],
  properties: {
    id: uuid,
    name: { type: "string" },
    farbe: { type: "string", enum: ["grau", "rot", "orange", "gelb", "gruen", "tuerkis", "blau", "violett", "rosa"] },
  },
} as const;

export const feldwert = {
  description: "text, auswahl, link: Text; zahl: ganze Zahl; betrag: ganze Cent; datum: JJJJ-MM-TT; ja_nein: boolean",
  oneOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }],
} as const;

export const ordnungsFelder = {
  tags: { type: "array", items: tagKurz },
  dokumenttyp: {
    oneOf: [
      { type: "null" },
      {
        type: "object",
        properties: { id: uuid, name: { type: "string" }, vorgabeArt: { oneOf: [art, { type: "null" }] } },
      },
    ],
  },
  korrespondent: {
    description: "Korrespondent aus der Liste mit seinem heutigen Namen",
    oneOf: [{ type: "null" }, { type: "object", properties: { id: uuid, name: { type: "string" } } }],
  },
} as const;

const ordnung = {
  type: "object",
  properties: {
    ...ordnungsFelder,
    felder: {
      type: "array",
      items: {
        type: "object",
        properties: {
          feldId: uuid,
          name: { type: "string" },
          typ: { type: "string", enum: ["text", "zahl", "betrag", "datum", "ja_nein", "auswahl", "link"] },
          wert: feldwert,
        },
      },
    },
  },
} as const;

const aenderung = {
  tagsHinzu: { type: "array", items: uuid, maxItems: 50 },
  tagsWeg: { type: "array", items: uuid, maxItems: 50 },
  dokumenttyp: { oneOf: [uuid, { type: "null" }], description: "null entfernt den Dokumenttyp" },
  korrespondent: {
    oneOf: [uuid, { type: "null" }],
    description: "ID aus der Liste; null entfernt den Korrespondenten",
  },
  felder: {
    type: "array",
    maxItems: 50,
    items: {
      type: "object",
      required: ["feldId", "wert"],
      properties: {
        feldId: uuid,
        wert: {
          description: "null entfernt den Wert; ein Betrag auch als Text in deutscher Schreibweise („1.234,56“)",
          oneOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }, { type: "null" }],
        },
      },
    },
  },
} as const;

export const listenParameter = [
  {
    name: "tag",
    in: "query",
    schema: { type: "array", items: uuid },
    style: "form",
    explode: true,
    description: "Nur Dokumente mit allen genannten Tags (tagModus alle) oder mindestens einem (tagModus einer)",
  },
  {
    name: "tagModus",
    in: "query",
    schema: { type: "string", enum: ["alle", "einer"], default: "alle" },
  },
  {
    name: "dokumenttyp",
    in: "query",
    schema: { type: "string" },
    description:
      "ID eines Dokumenttyps oder „ohne“. Dazu je Feld: feld.<id>=gesetzt, feld.<id>.enthaelt, feld.<id>.von, feld.<id>.bis",
  },
  {
    name: "korrespondent",
    in: "query",
    schema: { type: "string" },
    description: "ID eines Korrespondenten aus der Liste oder „ohne“",
  },
  ...(["entstandenVon", "entstandenBis", "eingegangenVon", "eingegangenBis"] as const).map((name) => ({
    name,
    in: "query" as const,
    schema: { type: "string" as const, format: "date" as const },
    description: "Tag der Entstehung oder des Eingangs (Europe/Berlin), Grenze eingeschlossen",
  })),
] as const;

const liste = (summary: string) => ({
  get: { summary, responses: { "200": { description: "Liste" } } },
});

export const ordnungPfade = {
  "/api/tags": liste("Tags mit Name, Farbe und Anzahl der Dokumente"),
  "/api/dokumenttypen": liste("Dokumenttypen mit Vorgabe-Art"),
  "/api/korrespondenten": liste("Korrespondenten mit Zuordnungsregel und Anzahl der Dokumente"),
  "/api/felder": liste("Eigene Felder mit Typ und Optionen"),
  "/api/dokumente/{id}/ordnung": {
    post: {
      summary: "Tags, Dokumenttyp, Korrespondent und Feldwerte eines Dokuments setzen (Recht schreiben)",
      parameters: [idParam],
      requestBody: { required: true, content: json({ type: "object", properties: aenderung }) },
      responses: {
        "200": { description: "Der neue Stand", content: json(ordnung) },
        "400": fehler,
        "404": fehler,
        "409": fehler,
      },
    },
  },
  "/api/dokumente/zip": {
    get: {
      summary: "Mehrere Originale als ZIP unter lesbaren Namen (ASN-Tag-Titel); nur sichtbare, höchstens 200 und 2 GB",
      parameters: [
        {
          name: "ids",
          in: "query",
          required: true,
          description: "Dokument-IDs, mit Komma getrennt",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "ZIP", content: { "application/zip": {} } },
        "400": fehler,
        "404": fehler,
        "413": fehler,
      },
    },
  },
  "/api/dokumente/sammeln": {
    post: {
      summary: "Sammelbearbeitung in einer Transaktion (Recht schreiben); scheitert ein Dokument, gilt keines",
      requestBody: {
        required: true,
        content: json({
          type: "object",
          required: ["ids"],
          properties: {
            ids: { type: "array", items: uuid, minItems: 1, maxItems: 500 },
            ...aenderung,
            einordnung: {
              type: "object",
              required: ["art", "entstanden"],
              properties: {
                art,
                entstanden: { oneOf: [datum, { type: "string", enum: ["eingang"] }] },
                freiwilligBis: datum,
                titel: { type: "string", maxLength: 300 },
                korrespondent: { type: "string", maxLength: 300 },
                nurOffene: { type: "boolean", default: true, description: "schon eingeordnete überspringen" },
              },
            },
          },
        }),
      },
      responses: {
        "200": {
          description: "Alles geändert",
          content: json({
            type: "object",
            properties: {
              ok: { type: "boolean" },
              ergebnisse: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: uuid,
                    ok: { type: "boolean" },
                    eingeordnet: { type: "boolean" },
                    fehler: { type: "string" },
                  },
                },
              },
            },
          }),
        },
        "400": fehler,
        "409": {
          description: "Nichts geändert; ergebnisse nennt den Grund je Dokument (oder fehler bei unbekanntem Tag)",
        },
      },
    },
  },
} as const;
