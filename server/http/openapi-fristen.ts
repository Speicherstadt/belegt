/*
 * OpenAPI für die Fristvorschau beim Einordnen (docs/fristen.md): Sitzung von Inhaber oder Steuerberatung, Mitarbeiter
 * mit dem Recht bearbeiten und Tokens mit dem Recht lesen erreichen sie auch.
 */

const datum = { type: "string", format: "date" } as const;
const art = {
  type: "string",
  enum: ["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige", "freiwillig", "frei"],
} as const;
const json = (schema: object) => ({ "application/json": { schema } });
const fehler = {
  description: "Fehler",
  content: json({ type: "object", properties: { fehler: { type: "string" } } }),
};

export const fristenPfade = {
  "/api/fristen/vorschau": {
    get: {
      summary: "Frist vor dem Einordnen",
      description:
        "Rechnet wie das Einordnen, ohne etwas zu speichern; ob das Institut unter Aufsicht steht, liest der Server aus den Einstellungen. Mitarbeiter mit dem Recht bearbeiten und API-Tokens erreichen sie auch, ohne gesperrt.",
      parameters: [
        { name: "art", in: "query", required: true, schema: art },
        { name: "entstanden", in: "query", required: true, schema: datum },
        {
          name: "freiwilligBis",
          in: "query",
          schema: datum,
          description: "Nur bei freiwillig nötig; ein leerer Wert zählt als fehlend",
        },
      ],
      responses: {
        "200": {
          description: "Die Frist",
          content: json({
            type: "object",
            required: ["bis", "grund", "jahre"],
            properties: {
              bis: { type: ["string", "null"], format: "date", description: "Letzter Tag der Aufbewahrung" },
              grund: { type: "string", enum: ["gesetz", "freiwillig", "keine"] },
              jahre: { type: ["integer", "null"], description: "Gesetzliche Jahre; null bei freiwillig und frei" },
              gesperrt: {
                type: "boolean",
                description:
                  "Ob entstanden in einer offenen Sperre liegt; fehlt bei Mitarbeitern und API-Tokens, nur mit Sitzung von Inhaber oder Steuerberatung",
              },
            },
          }),
        },
        "400": fehler,
        "401": fehler,
      },
    },
  },
} as const;
