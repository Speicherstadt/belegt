import { VERSION } from "./gemeinsam.ts";

/**
 * OpenAPI 3.1 für die Aufrufe, die Programme mit einem API-Token erreichen. Von Hand geschrieben, damit es kurz und
 * lesbar bleibt; der Test openapi.test.ts prüft, dass jeder Pfad als Route existiert.
 */

const uuid = { type: "string", format: "uuid" } as const;
const datum = { type: "string", format: "date" } as const;
const fehler = {
  description: "Fehler",
  content: { "application/json": { schema: { type: "object", properties: { fehler: { type: "string" } } } } },
};
const idParam = { name: "id", in: "path", required: true, schema: uuid } as const;
const art = {
  type: "string",
  enum: ["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige", "freiwillig", "frei"],
} as const;

const dokument = {
  type: "object",
  required: ["id", "sha256", "groesse", "mimeType", "quelle", "eingegangenAm"],
  properties: {
    id: uuid,
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    groesse: { type: "integer", description: "Bytes" },
    mimeType: { type: "string" },
    dateiname: { type: ["string", "null"] },
    quelle: { type: "string", enum: ["upload", "mail", "ordner", "api"] },
    eingegangenAm: { type: "string", format: "date-time" },
  },
} as const;

const json = (schema: object) => ({ "application/json": { schema } });

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Belegt",
    version: VERSION,
    description:
      "Dokumentenarchiv mit GoBD-Modus. Programme melden sich mit `Authorization: Bearer belegt_…` an (API-Token mit dem Recht lesen oder schreiben). Webhooks melden `dokument.aufgenommen`, `dokument.eingeordnet` und `dokument.geloescht` als JSON `{id, art, dokumentId, zeitpunkt}`, signiert in `X-Belegt-Signatur: sha256=<HMAC-SHA256 des Rumpfs>`.",
  },
  components: {
    securitySchemes: { token: { type: "http", scheme: "bearer" } },
    schemas: { Dokument: dokument },
  },
  security: [{ token: [] }],
  paths: {
    "/api/ich": {
      get: { summary: "Wer angemeldet ist", responses: { "200": { description: "Zugang" }, "401": fehler } },
    },
    "/api/dokumente": {
      get: {
        summary: "Dokumente, neueste zuerst",
        parameters: [
          { name: "suche", in: "query", schema: { type: "string" }, description: "Volltext (deutsch)" },
          {
            name: "gruppe",
            in: "query",
            schema: {
              type: "string",
              enum: ["alle", "offen", "pflicht", "freiwillig", "frei", "loeschbar", "geloescht"],
            },
          },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          "200": {
            description: "Liste",
            content: json({ type: "array", items: { $ref: "#/components/schemas/Dokument" } }),
          },
        },
      },
      post: {
        summary: "Original aufnehmen (Recht schreiben)",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["datei"],
                properties: { datei: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          "201": { description: "Aufgenommen", content: json({ $ref: "#/components/schemas/Dokument" }) },
          "413": fehler,
        },
      },
    },
    "/api/dokumente/{id}": {
      get: {
        summary: "Ein Dokument mit Einordnung und Löschung",
        parameters: [idParam],
        responses: { "200": { description: "Dokument" }, "404": fehler },
      },
    },
    "/api/dokumente/{id}/datei": {
      get: {
        summary: "Das Original, geprüft gegen seinen Hash",
        parameters: [idParam],
        responses: {
          "200": { description: "Datei", content: { "application/octet-stream": {} } },
          "409": fehler,
          "410": fehler,
        },
      },
    },
    "/api/dokumente/{id}/ansicht": {
      get: {
        summary: "Ansicht einer Office-Datei als PDF, aus dem Original abgeleitet (mit VORSCHAU_URL)",
        parameters: [idParam],
        responses: {
          "200": { description: "PDF", content: { "application/pdf": {} } },
          "404": fehler,
          "410": fehler,
        },
      },
    },
    "/api/dokumente/{id}/freigabe": {
      post: {
        summary:
          "Link für „Öffnen mit …“ (OEFFNEN_MIT_URL): Adresse der App mit einem Link auf das Original, 10 Minuten gültig",
        parameters: [idParam],
        responses: { "201": { description: "url, gueltigBis" }, "404": fehler, "410": fehler },
      },
    },
    "/api/freigabe/{token}": {
      get: {
        summary: "Öffentlich, nur mit dem Link: das Original",
        security: [],
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Datei", content: { "application/octet-stream": {} } },
          "404": fehler,
          "409": fehler,
          "410": fehler,
        },
      },
    },
    "/api/dokumente/{id}/einordnung": {
      post: {
        summary: "Einordnen (Recht schreiben); die Frist rechnet Belegt nach § 147 AO",
        parameters: [idParam],
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["art", "entstanden"],
            properties: {
              art,
              entstanden: datum,
              freiwilligBis: datum,
              titel: { type: "string", maxLength: 300 },
              korrespondent: { type: "string", maxLength: 300 },
            },
          }),
        },
        responses: { "201": { description: "Einordnung" }, "400": fehler, "409": fehler },
      },
    },
    "/api/dokumente/{id}/mail": {
      get: {
        summary: "Mail zum Dokument",
        parameters: [idParam],
        responses: { "200": { description: "Mail" }, "404": fehler },
      },
    },
    "/api/dokumente/{id}/inhalt": {
      get: {
        summary:
          "Gelesener Inhalt: Kopfdaten einer E-Rechnung (Beträge in Cent) und Länge des Texts; null, solange nicht gelesen",
        parameters: [idParam],
        responses: { "200": { description: "Inhalt oder null" }, "404": fehler },
      },
    },
    "/api/dokumente/{id}/verlauf": {
      get: {
        summary: "Einträge des Audit-Logs und Siegel",
        parameters: [idParam],
        responses: { "200": { description: "Verlauf" }, "404": fehler },
      },
    },
    "/api/mails": {
      post: {
        summary: "Mails aufnehmen, .eml oder MBOX (Recht schreiben)",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["datei"],
                properties: { datei: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Neu und doppelt (Dokument-IDs)",
            content: json({
              type: "object",
              properties: { neu: { type: "array", items: uuid }, doppelt: { type: "array", items: uuid } },
            }),
          },
        },
      },
    },
  },
} as const;
