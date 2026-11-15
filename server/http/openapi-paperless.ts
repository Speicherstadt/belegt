/*
 * OpenAPI für den Umzug aus Paperless-ngx (docs/umzug.md): nur der Inhaber mit Sitzung, kein API-Token.
 */

const uuid = { type: "string", format: "uuid" } as const;
const json = (schema: object) => ({ "application/json": { schema } });
const fehler = {
  description: "Fehler",
  content: json({ type: "object", properties: { fehler: { type: "string" } } }),
};
const idParam = { name: "id", in: "path", required: true, schema: uuid } as const;
const nurInhaber = "Nur der Inhaber mit Sitzung";

const lauf = {
  type: "object",
  properties: {
    id: uuid,
    art: { type: "string", enum: ["api", "export"] },
    status: { type: "string", enum: ["wartet", "laeuft", "fertig", "abgebrochen", "fehler"] },
    gesamt: { type: ["integer", "null"] },
    uebernommen: {
      type: "integer",
      description: "Übernommen, auch schon vorhandene und aus früheren Läufen der Quelle",
    },
    doppelt: { type: "integer" },
    fehler: { type: "integer" },
    meldung: { type: ["string", "null"] },
    hinweise: { type: "array", items: { type: "string" } },
  },
} as const;

export const paperlessPfade = {
  "/api/paperless/quellen": {
    get: {
      summary: `${nurInhaber}: Instanzen von Paperless-ngx (ohne Token)`,
      responses: { "200": { description: "Liste" }, "403": fehler },
    },
    post: {
      summary: `${nurInhaber}: Instanz verbinden; das Token liegt danach nur verschlüsselt in der Datenbank`,
      requestBody: {
        required: true,
        content: json({
          type: "object",
          required: ["name", "url", "token"],
          properties: { name: { type: "string" }, url: { type: "string", format: "uri" }, token: { type: "string" } },
        }),
      },
      responses: { "201": { description: "Quelle ohne Token" }, "400": fehler, "403": fehler, "503": fehler },
    },
  },
  "/api/paperless/quellen/{id}/starten": {
    post: {
      summary: `${nurInhaber}: Import über die API starten; überspringt, was frühere Läufe der Quelle übernommen haben`,
      parameters: [idParam],
      responses: { "201": { description: "Lauf", content: json(lauf) }, "404": fehler, "409": fehler },
    },
  },
  "/api/paperless/export": {
    post: {
      summary: `${nurInhaber}: ZIP aus document_exporter --zip hochladen (Körper ist die Datei, Name in ?name=); der Worker importiert`,
      parameters: [{ name: "name", in: "query", schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
      responses: { "201": { description: "Lauf", content: json(lauf) }, "400": fehler, "413": fehler, "503": fehler },
    },
  },
  "/api/paperless/importe": {
    get: {
      summary: `${nurInhaber}: Läufe, neueste zuerst, mit Stand`,
      responses: { "200": { description: "Läufe", content: json({ type: "array", items: lauf }) }, "403": fehler },
    },
  },
  "/api/paperless/importe/{id}/fehler": {
    get: {
      summary: `${nurInhaber}: Fehler eines Laufs mit Paperless-ID, Titel und Grund`,
      parameters: [idParam],
      responses: { "200": { description: "Fehler" }, "403": fehler },
    },
  },
  "/api/paperless/importe/{id}/abbrechen": {
    post: {
      summary: `${nurInhaber}: Lauf abbrechen; ein laufender hört nach dem aktuellen Dokument auf`,
      parameters: [idParam],
      responses: { "200": { description: "ok" }, "404": fehler },
    },
  },
  "/api/paperless/zuordnungen": {
    get: {
      summary: `${nurInhaber}: Zuordnungen Dokumenttyp oder Tag → Art`,
      responses: { "200": { description: "Liste" } },
    },
    post: {
      summary: `${nurInhaber}: Zuordnung anlegen; passende Dokumente ordnet der Import gleich ein`,
      requestBody: {
        required: true,
        content: json({
          type: "object",
          required: ["art", "name", "zielArt"],
          properties: {
            art: { type: "string", enum: ["dokumenttyp", "tag"] },
            name: { type: "string" },
            zielArt: { type: "string", enum: ["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige", "frei"] },
          },
        }),
      },
      responses: { "201": { description: "Zuordnung" }, "400": fehler, "409": fehler },
    },
  },
  "/api/paperless/zuordnungen/{id}": {
    delete: {
      summary: `${nurInhaber}: Zuordnung entfernen`,
      parameters: [idParam],
      responses: { "200": { description: "ok" }, "404": fehler },
    },
  },
} as const;
