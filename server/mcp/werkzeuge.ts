import { z } from "zod";
import type { Angemeldet } from "../auth.ts";
import { aufnehmen, laden, listen, type Umgebung } from "../dokumente/dokumente.ts";
import { aktuelle, EinordnungEingabe, einordnen, Gruppe } from "../einordnung/einordnung.ts";
import { akteur, heute, MAX_UPLOAD } from "../http/gemeinsam.ts";
import { inhaltZu, textZu } from "../inhalt/inhalt.ts";
import { fuerDokument, regelVerletzt } from "../loeschung/loeschung.ts";
import { mailZuDokument } from "../mail/import.ts";
import { NotizEingabe, notizAnlegen, notizenZu } from "../notizen/notizen.ts";
import { dokumenttypenListen, felderListen, istKonflikt, tagsListen } from "../ordnung/ordnung.ts";
import { Aenderung, ordnungZu, sammeln } from "../ordnung/zuordnung.ts";

/**
 * Werkzeuge für KI-Assistenten (MCP). Sie rufen dieselben Module wie die HTTP-Schnittstelle und haben dieselben
 * Rechte wie das Token: lesen sucht und liest (auch Notizen), schreiben nimmt zusätzlich auf, ordnet ein, setzt Tags,
 * Dokumenttyp und Feldwerte und schreibt Notizen. Tags, Dokumenttypen und Felder anlegen kann ein Token nicht, löschen auch nicht.
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

/** substr in Postgres rechnet in integer */
const MAX_VON = 2_000_000_000;

const lesend = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const WERKZEUGE: Werkzeug[] = [
  {
    name: "dokumente_suchen",
    title: "Dokumente suchen",
    description:
      "Sucht im Archiv, neueste zuerst. suche geht über den Volltext (deutsch; Wortgruppen in Anführungszeichen, Ausschluss mit Minus) aus Dateiname, Einordnung, Mail, PDF-Text, E-Rechnung, Tags, Dokumenttyp und Textfeldern; „ASN 123“ findet die Archivnummer. gruppe: offen (noch nicht eingeordnet), pflicht, freiwillig, frei, loeschbar, geloescht. Jeder Treffer mit asn, tags (Namen) und dokumenttyp.",
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
      (await listen(db, { suche: e.suche, gruppe: e.gruppe, limit: e.limit, heute: heute(), notizen: true })).map(
        (d) => ({
          id: d.id,
          asn: d.asn,
          dateiname: d.dateiname,
          typ: d.mimeType,
          eingang: d.eingegangenAm.toISOString(),
          art: d.art,
          titel: d.titel,
          aufbewahrenBis: d.fristBis,
          tags: d.tags.map((t) => t.name),
          dokumenttyp: d.dokumenttyp?.name ?? null,
        }),
      ),
  },
  {
    name: "dokument_lesen",
    title: "Dokument lesen",
    description:
      "Angaben zu einem Dokument: Archivnummer (asn), Datei, Hash, Einordnung mit Frist, Löschung, Tags, Dokumenttyp, eigene Felder (felder; Betrag in Cent), Kopf der Mail und erkannte E-Rechnung (Beträge in Cent).",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    annotations: lesend,
    schreibt: false,
    eingabe: z.object({ id: Id }),
    ausfuehren: async (umgebung, _n, e: { id: string }) => {
      const d = await dokumentOderFehler(umgebung, e.id);
      const [einordnung, loeschung, mail, inhalt, ordnung] = await Promise.all([
        aktuelle(umgebung.db, d.id),
        fuerDokument(umgebung.db, d.id),
        mailZuDokument(umgebung.db, d.id),
        inhaltZu(umgebung.db, d.id),
        ordnungZu(umgebung.db, d.id),
      ]);
      return {
        ...d,
        einordnung,
        loeschung,
        ...ordnung,
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
        von: { type: "integer", minimum: 0, maximum: MAX_VON, default: 0 },
        laenge: { type: "integer", minimum: 1, maximum: 50000, default: 20000 },
      },
    },
    annotations: lesend,
    schreibt: false,
    eingabe: z.object({
      id: Id,
      von: z.number().int().min(0).max(MAX_VON).default(0),
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
    name: "notizen_lesen",
    title: "Notizen eines Dokuments",
    description:
      "Die Notizen zu einem Dokument (Text, wer, wann), älteste zuerst; zurückgezogene fehlen. Notizen sind Anmerkungen, keine Unterlage.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    annotations: lesend,
    schreibt: false,
    eingabe: z.object({ id: Id }),
    ausfuehren: async (umgebung, _n, e: { id: string }) => {
      const d = await dokumentOderFehler(umgebung, e.id);
      return { notizen: await notizenZu(umgebung.db, d.id) };
    },
  },
  {
    name: "notiz_schreiben",
    title: "Notiz schreiben",
    description:
      "Schreibt eine Notiz zu einem Dokument (1 bis 5000 Zeichen). Notizen lassen sich nicht ändern; zurückziehen geht nur in der Oberfläche. Braucht ein Token mit dem Recht schreiben.",
    inputSchema: {
      type: "object",
      required: ["id", "text"],
      properties: { id: { type: "string", format: "uuid" }, text: { type: "string", maxLength: 5000 } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    schreibt: true,
    eingabe: NotizEingabe.extend({ id: Id }),
    ausfuehren: async (umgebung, nutzer, e: { id: string; text: string }) => {
      const d = await dokumentOderFehler(umgebung, e.id);
      try {
        return await notizAnlegen(umgebung.db, d.id, e.text, akteur(nutzer));
      } catch (err) {
        const meldung = regelVerletzt(err);
        if (meldung) throw werkzeugFehler(meldung);
        throw err;
      }
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
  {
    name: "ordnung_listen",
    title: "Tags, Dokumenttypen und Felder",
    description:
      "Alle Tags, Dokumenttypen und eigenen Felder mit ID, für dokument_ordnen. Felder mit typ (text, zahl, betrag in Cent, datum JJJJ-MM-TT, ja_nein, auswahl mit optionen, link).",
    inputSchema: { type: "object", properties: {} },
    annotations: lesend,
    schreibt: false,
    eingabe: z.object({}),
    ausfuehren: async ({ db }) => {
      const [t, typen, felder] = await Promise.all([tagsListen(db), dokumenttypenListen(db), felderListen(db)]);
      return {
        tags: t.map(({ id, name }) => ({ id, name })),
        dokumenttypen: typen.map(({ id, name }) => ({ id, name })),
        felder: felder.map(({ id, name, typ, optionen }) => ({ id, name, typ, optionen })),
      };
    },
  },
  {
    name: "dokument_ordnen",
    title: "Tags, Dokumenttyp und Feldwerte setzen",
    description:
      "Setzt an einem Dokument Tags (tagsHinzu, tagsWeg), den Dokumenttyp (ID, null entfernt) und Feldwerte (felder: feldId und wert; null entfernt, Betrag in Cent oder als „1.234,56“). Nur vorhandene Tags, Typen und Felder (ordnung_listen); anlegen kann das Werkzeug nichts. Jede Änderung steht im Audit-Log. Antwort: der neue Stand. Braucht ein Token mit dem Recht schreiben.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", format: "uuid" },
        tagsHinzu: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 50 },
        tagsWeg: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 50 },
        dokumenttyp: { type: ["string", "null"], format: "uuid" },
        felder: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            required: ["feldId", "wert"],
            properties: {
              feldId: { type: "string", format: "uuid" },
              wert: { type: ["string", "integer", "boolean", "null"] },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    schreibt: true,
    // Wie POST /api/dokumente/:id/ordnung, ohne Einordnung (dafür gibt es dokument_einordnen)
    eingabe: z.intersection(z.object({ id: Id }), Aenderung),
    ausfuehren: async (umgebung, nutzer, e: Aenderung & { id: string }) => {
      const { id, einordnung: _ohne, ...aenderung } = e;
      // Die Einordnung setzt dokument_einordnen; bleibt ohne sie nichts übrig, wäre ein Erfolg irreführend
      if (
        !aenderung.tagsHinzu.length &&
        !aenderung.tagsWeg.length &&
        !aenderung.felder.length &&
        aenderung.dokumenttyp === undefined
      )
        throw werkzeugFehler("Keine Änderung: tagsHinzu, tagsWeg, dokumenttyp oder felder angeben");
      const d = await dokumentOderFehler(umgebung, id);
      try {
        const r = await sammeln(umgebung.db, [d.id], aenderung, akteur(nutzer));
        const ergebnis = r.ergebnisse[0];
        if (!r.ok) throw werkzeugFehler(ergebnis?.ok === false ? ergebnis.fehler : "Nicht möglich");
      } catch (err) {
        if (istKonflikt(err)) throw werkzeugFehler(err.message);
        throw err;
      }
      return ordnungZu(umgebung.db, d.id);
    },
  },
];
