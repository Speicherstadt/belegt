import { z } from "zod";
import type { Angemeldet } from "../auth.ts";
import { aufnehmen, laden, listen, type Umgebung } from "../dokumente/dokumente.ts";
import { aktuelle, EinordnungEingabe, einordnen, Gruppe } from "../einordnung/einordnung.ts";
import { akteur, heute, MAX_UPLOAD } from "../http/gemeinsam.ts";
import { inhaltZu, textZu } from "../inhalt/inhalt.ts";
import { fuerDokument, regelVerletzt } from "../loeschung/loeschung.ts";
import { mailZuDokument } from "../mail/import.ts";

/**
 * Werkzeuge für KI-Assistenten (MCP). Sie rufen dieselben Module wie die HTTP-Schnittstelle und haben dieselben
 * Rechte wie das Token: lesen sucht und liest, schreiben nimmt zusätzlich auf und ordnet ein. Löschen gibt es nicht.
 */

/** Fehler, den der Assistent sehen soll (isError im Ergebnis), statt eines Protokollfehlers */
export const werkzeugFehler = (meldung: string) => Object.assign(new Error(meldung), { fuerAssistent: true as const });
export const istWerkzeugFehler = (err: unknown): err is Error =>
  err instanceof Error && (err as { fuerAssistent?: boolean }).fuerAssistent === true;

export interface Werkzeug {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: false; idempotentHint: boolean; openWorldHint: false };
  schreibt: boolean;
  eingabe: z.ZodType;
  ausfuehren: (umgebung: Umgebung, nutzer: Angemeldet, eingabe: never) => Promise<unknown>;
}

const Id = z.uuid();

async function dokumentOderFehler(umgebung: Umgebung, id: string) {
  const d = await laden(umgebung.db, id);
  if (!d) throw werkzeugFehler("Kein Dokument mit dieser ID");
  return d;
}

const lesend = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const WERKZEUGE: Werkzeug[] = [
  {
    name: "dokumente_suchen",
    title: "Dokumente suchen",
    description:
      "Sucht im Archiv, neueste zuerst. suche geht über den Volltext (deutsch; Wortgruppen in Anführungszeichen, Ausschluss mit Minus) aus Dateiname, Einordnung, Mail, PDF-Text und E-Rechnung. gruppe: offen (noch nicht eingeordnet), pflicht, freiwillig, frei, loeschbar, geloescht.",
    inputSchema: {
      type: "object",
      properties: {
        suche: { type: "string" },
        gruppe: { type: "string", enum: Gruppe.options },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
    annotations: lesend,
    schreibt: false,
    eingabe: z.object({
      suche: z.string().max(500).optional(),
      gruppe: Gruppe.optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    ausfuehren: async ({ db }, _n, e: { suche?: string; gruppe?: z.infer<typeof Gruppe>; limit: number }) =>
      (await listen(db, { suche: e.suche, gruppe: e.gruppe, limit: e.limit, heute: heute() })).map((d) => ({
        id: d.id,
        dateiname: d.dateiname,
        typ: d.mimeType,
        eingang: d.eingegangenAm.toISOString(),
        art: d.art,
        titel: d.titel,
        aufbewahrenBis: d.fristBis,
      })),
  },
  {
    name: "dokument_lesen",
    title: "Dokument lesen",
    description:
      "Angaben zu einem Dokument: Datei, Hash, Einordnung mit Frist, Löschung, Kopf der Mail und erkannte E-Rechnung (Beträge in Cent).",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    annotations: lesend,
    schreibt: false,
    eingabe: z.object({ id: Id }),
    ausfuehren: async (umgebung, _n, e: { id: string }) => {
      const d = await dokumentOderFehler(umgebung, e.id);
      const [einordnung, loeschung, mail, inhalt] = await Promise.all([
        aktuelle(umgebung.db, d.id),
        fuerDokument(umgebung.db, d.id),
        mailZuDokument(umgebung.db, d.id),
        inhaltZu(umgebung.db, d.id),
      ]);
      return {
        ...d,
        einordnung,
        loeschung,
        mail: mail && {
          von: mail.von,
          an: mail.an,
          betreff: mail.betreff,
          gesendetAm: mail.gesendetAm,
          anhaenge: mail.anhaenge,
          ausMail: mail.ausMail,
        },
        erechnung: inhalt?.erechnung ?? null,
      };
    },
  },
  {
    name: "dokument_text",
    title: "Text eines Dokuments",
    description:
      "Text eines Dokuments: bei einer Mail ihr Text, bei einem PDF der gelesene Text (in Stücken: von und laenge in Zeichen). Leer bei Bildern; maßgeblich bleibt das Original.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", format: "uuid" },
        von: { type: "integer", minimum: 0, default: 0 },
        laenge: { type: "integer", minimum: 1, maximum: 50000, default: 20000 },
      },
    },
    annotations: lesend,
    schreibt: false,
    eingabe: z.object({
      id: Id,
      von: z.number().int().min(0).default(0),
      laenge: z.number().int().min(1).max(50_000).default(20_000),
    }),
    ausfuehren: async (umgebung, _n, e: { id: string; von: number; laenge: number }) => {
      const d = await dokumentOderFehler(umgebung, e.id);
      const mail = await mailZuDokument(umgebung.db, d.id);
      if (mail && !mail.ausMail)
        return { text: mail.text.slice(e.von, e.von + e.laenge), von: e.von, gesamt: mail.text.length };
      return (
        (await textZu(umgebung.db, d.id, e.von, e.laenge)) ?? {
          text: "",
          von: e.von,
          gesamt: 0,
          hinweis: "Noch nicht gelesen oder ohne Text",
        }
      );
    },
  },
  {
    name: "dokument_aufnehmen",
    title: "Dokument aufnehmen",
    description:
      "Nimmt eine Datei unverändert ins Archiv auf (inhalt als Base64, höchstens 100 MB). Danach liegt sie im Eingang und wartet auf die Einordnung. Braucht ein Token mit dem Recht schreiben.",
    inputSchema: {
      type: "object",
      required: ["dateiname", "inhalt"],
      properties: {
        dateiname: { type: "string", maxLength: 300 },
        inhalt: { type: "string", contentEncoding: "base64" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    schreibt: true,
    eingabe: z.object({
      dateiname: z.string().trim().min(1).max(300),
      inhalt: z.base64().max(Math.ceil((MAX_UPLOAD * 4) / 3)),
    }),
    ausfuehren: async (umgebung, nutzer, e: { dateiname: string; inhalt: string }) => {
      const bytes = new Uint8Array(Buffer.from(e.inhalt, "base64"));
      if (!bytes.byteLength) throw werkzeugFehler("Die Datei ist leer");
      return aufnehmen(umgebung, { bytes, dateiname: e.dateiname, quelle: "api", akteur: akteur(nutzer) });
    },
  },
  {
    name: "dokument_einordnen",
    title: "Dokument einordnen",
    description:
      "Ordnet ein Dokument ein; die Frist rechnet Belegt nach § 147 AO. art: buecher, zoll, beleg (Buchungsbeleg), geschaeftsbrief, sonstige, freiwillig (mit freiwilligBis), frei. entstanden: Tag der Entstehung, des Empfangs oder Versands (JJJJ-MM-TT). Eine neue Einordnung ersetzt die alte nicht, beide bleiben. Braucht ein Token mit dem Recht schreiben.",
    inputSchema: {
      type: "object",
      required: ["id", "art", "entstanden"],
      properties: {
        id: { type: "string", format: "uuid" },
        art: {
          type: "string",
          enum: ["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige", "freiwillig", "frei"],
        },
        entstanden: { type: "string", format: "date" },
        freiwilligBis: { type: "string", format: "date" },
        titel: { type: "string", maxLength: 300 },
        korrespondent: { type: "string", maxLength: 300 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    schreibt: true,
    eingabe: EinordnungEingabe.extend({ id: Id }),
    ausfuehren: async (umgebung, nutzer, e: z.infer<typeof EinordnungEingabe> & { id: string }) => {
      const { id, ...eingabe } = e;
      const d = await dokumentOderFehler(umgebung, id);
      try {
        return await einordnen(umgebung.db, d.id, eingabe, akteur(nutzer));
      } catch (err) {
        const meldung = regelVerletzt(err);
        if (meldung) throw werkzeugFehler(meldung);
        // fristende lehnt etwa einen Tag ab, den es nicht gibt; Datenbankfehler gehen nicht mit ihrem Text hinaus
        if (err instanceof Error && !("code" in err) && !("cause" in err && err.cause))
          throw werkzeugFehler(err.message);
        throw err;
      }
    },
  },
];
