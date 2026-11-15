import { VERSION } from "./gemeinsam.ts";
import { feldwert, listenParameter, ordnungPfade, ordnungsFelder } from "./openapi-ordnung.ts";
import { paperlessPfade } from "./openapi-paperless.ts";

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
  required: ["id", "asn", "sha256", "groesse", "mimeType", "quelle", "eingegangenAm"],
  properties: {
    id: uuid,
    asn: { type: "integer", description: "Archivnummer, fortlaufend in der Reihenfolge des Eingangs" },
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    groesse: { type: "integer", description: "Bytes" },
    mimeType: { type: "string" },
    dateiname: { type: ["string", "null"] },
    quelle: { type: "string", enum: ["upload", "mail", "ordner", "api", "abgeleitet", "import"] },
    eingegangenAm: { type: "string", format: "date-time" },
    vorschaubild: { type: "boolean", description: "Nur in der Liste: ob es ein Vorschaubild gibt" },
    ...ordnungsFelder,
  },
} as const;

const json = (schema: object) => ({ "application/json": { schema } });

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Belegt",
    version: VERSION,
    description:
      "Dokumentenarchiv mit GoBD-Modus. Programme melden sich mit `Authorization: Bearer belegt_…` an (API-Token mit dem Recht lesen oder schreiben); Tokens legt nur der Inhaber an, sie sehen alle Dokumente. Mitarbeiter mit Sichtbereich bekommen keine Tokens und erreichen dieselben Pfade nur mit ihrer Sitzung, für Dokumente außerhalb ihres Sichtbereichs mit `404`. Webhooks melden `dokument.aufgenommen`, `dokument.eingeordnet`, `dokument.geloescht` und `dokument.workflow` (von einem Workflow, dann mit `workflow`: seinem Namen) als JSON `{id, art, dokumentId, zeitpunkt}`, signiert in `X-Belegt-Signatur: sha256=<HMAC-SHA256 des Rumpfs>`.",
  },
  components: {
    securitySchemes: { token: { type: "http", scheme: "bearer" } },
    schemas: { Dokument: dokument, Feldwert: feldwert },
  },
  security: [{ token: [] }],
  paths: {
    "/api/ich": {
      get: {
        summary: "Wer angemeldet ist",
        description: "id, email, role; beim Prüfer zeitraum, beim Mitarbeiter recht und sichtbereich",
        responses: { "200": { description: "Zugang" }, "401": fehler },
      },
    },
    "/api/dokumente": {
      get: {
        summary: "Dokumente, neueste zuerst",
        parameters: [
          {
            name: "suche",
            in: "query",
            schema: { type: "string" },
            description: "Volltext (deutsch); „ASN 123“ oder eine bloße Zahl findet auch die Archivnummer",
          },
          {
            name: "gruppe",
            in: "query",
            schema: {
              type: "string",
              enum: ["alle", "offen", "pflicht", "freiwillig", "frei", "loeschbar", "geloescht"],
            },
          },
          {
            name: "sortierung",
            in: "query",
            schema: { type: "string", enum: ["neu", "alt", "titel", "entstanden", "frist"], default: "neu" },
            description:
              "neu: zuletzt eingegangen zuerst; alt: zuerst eingegangen; titel: Titel oder Dateiname; entstanden: Tag der Entstehung, neueste zuerst; frist: Fristende, das nächste zuerst",
          },
          { name: "seite", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "proSeite", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 200 },
            description: "Anderer Name für proSeite",
          },
          ...listenParameter,
        ],
        responses: {
          "200": {
            description: "Eine Seite der Liste",
            headers: {
              "X-Gesamt": { description: "Zahl aller Treffer über alle Seiten", schema: { type: "integer" } },
            },
            content: json({ type: "array", items: { $ref: "#/components/schemas/Dokument" } }),
          },
          "400": fehler,
        },
      },
      post: {
        summary: "Original aufnehmen (Recht schreiben)",
        parameters: [
          {
            name: "trennen",
            in: "query",
            schema: { type: "string", enum: ["1"] },
            description:
              "Ein PDF an Trennblättern teilen; jedes Teil wird ein eigenes Dokument. Antwort dann `{dokumente: [...]}`",
          },
        ],
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
            description: "Aufgenommen; mit trennen=1 alle Teile",
            content: json({
              oneOf: [
                { $ref: "#/components/schemas/Dokument" },
                {
                  type: "object",
                  properties: { dokumente: { type: "array", items: { $ref: "#/components/schemas/Dokument" } } },
                },
              ],
            }),
          },
          "413": fehler,
        },
      },
    },
    "/api/trennblatt.pdf": {
      get: {
        summary: "Trennblatt zum Ausdrucken (QR-Code und Code 128 mit TRENNBLATT_CODE)",
        responses: { "200": { description: "PDF", content: { "application/pdf": {} } } },
      },
    },
    "/api/dokumente/{id}": {
      get: {
        summary: "Ein Dokument mit Einordnung, Löschung, Tags, Dokumenttyp und Feldwerten (felder)",
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
    "/api/dokumente/{id}/archivfassung": {
      get: {
        summary:
          "Durchsuchbares PDF eines Scans (PDF/A-2b, Bild mit unsichtbarem Text aus der Texterkennung), aus dem Original abgeleitet; maßgeblich bleibt das Original",
        parameters: [idParam],
        responses: {
          "200": { description: "PDF", content: { "application/pdf": {} } },
          "404": fehler,
          "410": fehler,
        },
      },
    },
    "/api/dokumente/{id}/vorschaubild": {
      get: {
        summary: "Vorschaubild der ersten Seite (JPEG, 300 px breit), aus dem Original oder seiner Ansicht abgeleitet",
        parameters: [idParam],
        responses: {
          "200": { description: "JPEG", content: { "image/jpeg": {} } },
          "404": fehler,
          "410": fehler,
        },
      },
    },
    "/api/dokumente/{id}/ableitungen": {
      get: {
        summary:
          "Woraus das Dokument abgeleitet ist (aus) und was daraus abgeleitet wurde (daraus): Seiten gedreht, entfernt, geteilt oder zusammengefügt",
        parameters: [idParam],
        responses: {
          "200": {
            description:
              "aus und daraus: je dokumentId, dateiname, titel, asn, operation, parameter, position, akteur, erstelltAm, geloescht",
          },
          "404": fehler,
        },
      },
    },
    "/api/dokumente/{id}/aehnliche": {
      get: {
        summary: "Bis zu fünf ähnliche Dokumente aus dem Volltext, ohne gelöschte",
        parameters: [idParam],
        responses: {
          "200": { description: "Liste mit id, asn, dateiname, titel, mimeType, vorschaubild" },
          "404": fehler,
        },
      },
    },
    "/api/dokumente/{id}/notizen": {
      get: {
        summary: "Notizen zum Dokument, älteste zuerst, ohne zurückgezogene",
        parameters: [idParam],
        responses: { "200": { description: "Liste mit id, text, erstelltVon, erstelltAm" }, "404": fehler },
      },
      post: {
        summary: "Notiz schreiben (Recht schreiben); lässt sich danach nicht ändern",
        parameters: [idParam],
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["text"],
            properties: { text: { type: "string", minLength: 1, maxLength: 5000 } },
          }),
        },
        responses: { "201": { description: "Notiz" }, "400": fehler, "404": fehler, "409": fehler },
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
    "/api/dokumente/{id}/links": {
      get: {
        summary: "Nur der Inhaber mit Sitzung: gültige geteilte Links des Dokuments mit Zahl und Zeit der Abrufe",
        parameters: [idParam],
        responses: {
          "200": { description: "id, erstelltVon, erstelltAm, gueltigBis, abrufe, letzterAbruf" },
          "403": fehler,
        },
      },
      post: {
        summary: "Nur der Inhaber mit Sitzung: Link auf das Original für 1, 7 oder 30 Tage; den Link gibt es nur hier",
        parameters: [idParam],
        requestBody: {
          required: true,
          content: json({ type: "object", required: ["tage"], properties: { tage: { enum: [1, 7, 30] } } }),
        },
        responses: {
          "201": { description: "id, url, gueltigBis" },
          "400": fehler,
          "403": fehler,
          "404": fehler,
          "410": fehler,
        },
      },
    },
    "/api/dokumente/{id}/links/{link}/widerrufen": {
      post: {
        summary: "Nur der Inhaber mit Sitzung: geteilten Link widerrufen",
        parameters: [idParam, { name: "link", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "ok" }, "403": fehler, "404": fehler },
      },
    },
    "/api/geteilt/{token}": {
      get: {
        summary: "Öffentlich, nur mit dem geteilten Link: das Original als Download; jeder Abruf wird festgehalten",
        security: [],
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Datei", content: { "application/octet-stream": {} } },
          "404": { description: "Link ungültig, abgelaufen oder widerrufen (Text)" },
          "409": { description: "Datei fehlt oder verändert (Text)" },
          "410": { description: "Dokument gelöscht (Text)" },
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
        summary: "Einträge des Audit-Logs (auch Tags, Dokumenttyp, Feldwerte mit detail) und Siegel",
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
    ...ordnungPfade,
    ...paperlessPfade,
  },
} as const;
