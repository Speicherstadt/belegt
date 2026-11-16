import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AUSLOESER, WORKFLOW_QUELLEN } from "../../shared/workflows.ts";
import { verschluesseln } from "../crypto.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { workflowGeheimnisse, workflows } from "../db/schema.ts";
import { ARTEN } from "../einordnung/einordnung.ts";
import { konflikt } from "../ordnung/ordnung.ts";
import { aenderungPruefen } from "../ordnung/zuordnung.ts";

/*
 * Workflows anlegen, schalten, ordnen und löschen (docs/workflows.md). Nur der Inhaber; jede Änderung im Audit-Log.
 * Ausgeführt werden sie im Worker (ausfuehren.ts). Regeln schlagen vor, Workflows handeln: Eine Einordnung als Aktion
 * gibt es nur, wenn der Inhaber sie ausdrücklich wählt (ausdruecklich: true, Postgres prüft es mit).
 */

const Id = z.uuid();
const Text = (max: number) => z.string().trim().min(1).max(max);
const Datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Bedingungen = z
  .object({
    quellen: z.array(z.enum(WORKFLOW_QUELLEN)).max(6).optional(),
    dateinameEnthaelt: Text(200).optional(),
    betreffEnthaelt: Text(200).optional(),
    absender: Text(320).optional(),
    domain: Text(253).optional(),
    anhangTyp: Text(100).optional(),
    textEnthaelt: Text(200).optional(),
    mimeTyp: z
      .string()
      .trim()
      .regex(/^[a-z0-9.+-]+\/([a-z0-9.+-]+|\*)$/i)
      .optional(),
    tags: z.array(Id).min(1).max(20).optional(),
    dokumenttyp: z.union([Id, z.literal("ohne")]).optional(),
    korrespondent: z.union([Id, z.literal("ohne")]).optional(),
    postfach: Text(200).optional(),
    unterordner: Text(500).optional(),
  })
  .strict();

/** Kopfzeilen, die der Versand selbst setzt oder die die Verbindung betreffen; die Anmeldung braucht keine davon */
const VERBOTENE_KOPFZEILEN = new Set([
  "host",
  "content-type",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "expect",
  "te",
  "trailer",
  "keep-alive",
  "proxy-authorization",
  "cookie",
]);

/**
 * „Original an Adresse senden“ (server/weitergabe/): multipart/form-data an url, das Original im Feld dateifeld, dazu
 * feste Felder mit Platzhaltern und eine Kopfzeile für die Anmeldung. Der Wert der Kopfzeile kommt nur beim Anlegen
 * herein; gespeichert ist er verschlüsselt in workflow_geheimnisse, in aktionen steht nur gesetzt: true.
 */
export const Senden = z
  .object({
    art: z.literal("senden"),
    // Zugangsdaten gehören in die Kopfzeile, nicht in die Adresse: die steht im Klartext in aktionen und im Audit-Log
    url: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .refine((u) => !new URL(u).username && !new URL(u).password, "Zugangsdaten nicht in die Adresse"),
    dateifeld: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.[\]-]{1,100}$/),
    kopfzeile: z
      .object({
        name: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,100}$/)
          .refine((n) => !VERBOTENE_KOPFZEILEN.has(n.toLowerCase()), "Diese Kopfzeile setzt Belegt selbst"),
        /**
         * Nur beim Anlegen; danach nie mehr in einer Antwort. Ohne Steuerzeichen außer Tab (field-value, RFC 9110
         * Abschnitt 5.5): CR und LF schleusten Kopfzeilen ein, und fetch lehnte den Wert bei jedem Versuch ab
         */
        wert: z
          .string()
          .min(1)
          .max(4000)
          // biome-ignore lint/suspicious/noControlCharactersInRegex: gerade Steuerzeichen sind verboten
          .regex(/^[^\u0000-\u0008\u000a-\u001f\u007f]+$/, "Keine Zeilenumbrüche oder Steuerzeichen")
          .optional(),
        gesetzt: z.literal(true).optional(),
      })
      .optional(),
    felder: z
      .array(
        z.object({
          name: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_.[\]-]{1,100}$/),
          wert: z.string().max(2000),
        }),
      )
      .max(20)
      .default([]),
  })
  .refine((a) => !a.kopfzeile || !!a.kopfzeile.wert, { message: "Die Kopfzeile braucht einen Wert" });

export const Aktion = z.discriminatedUnion("art", [
  z.object({ art: z.literal("tagsHinzu"), tags: z.array(Id).min(1).max(50) }),
  z.object({ art: z.literal("tagsWeg"), tags: z.array(Id).min(1).max(50) }),
  z.object({ art: z.literal("dokumenttyp"), dokumenttyp: Id }),
  z.object({ art: z.literal("korrespondent"), korrespondent: Id }),
  z.object({ art: z.literal("feld"), feldId: Id, wert: z.unknown() }),
  z
    .object({
      art: z.literal("einordnen"),
      /** Art der Aufbewahrung; bestimmt die Frist */
      als: z.enum(ARTEN),
      /** Tag der Entstehung: der des Eingangs oder das Datum einer erkannten E-Rechnung (sonst Eingang) */
      entstanden: z.enum(["eingang", "erechnung"]),
      freiwilligBis: Datum.optional(),
      titel: z.string().trim().max(300).optional(),
      korrespondent: z.string().trim().max(300).optional(),
      /** Der Inhaber hat ausdrücklich gewählt, dass dieser Workflow ohne Bestätigung einordnet */
      ausdruecklich: z.literal(true),
    })
    .refine((a) => a.als !== "freiwillig" || !!a.freiwilligBis, { message: "freiwillig braucht freiwilligBis" }),
  z.object({ art: z.literal("webhook") }),
  z.object({ art: z.literal("notiz"), text: Text(5000) }),
  Senden,
]);
export type Aktion = z.infer<typeof Aktion>;
export type Bedingungen = z.infer<typeof Bedingungen>;

export const WorkflowEingabe = z.object({
  name: Text(100),
  ausloeser: z.enum(AUSLOESER),
  bedingungen: Bedingungen.default({}),
  aktionen: z.array(Aktion).min(1).max(20),
  anhalten: z.boolean().default(false),
});

export const Reihenfolge = z.object({ ids: z.array(Id).min(1).max(200) });

export type Workflow = typeof workflows.$inferSelect & { bedingungen: Bedingungen; aktionen: Aktion[] };

/** Tags, Dokumenttyp, Korrespondent und Felder der Aktionen gibt es, Feldwerte passen; sonst ein Konflikt */
async function aktionenPruefen(db: Datenbank, aktionen: Aktion[]) {
  await db.transaction(async (tx) => {
    for (const a of aktionen) {
      if (a.art === "tagsHinzu") await aenderungPruefen(tx, { tagsHinzu: a.tags, tagsWeg: [], felder: [] });
      if (a.art === "tagsWeg") await aenderungPruefen(tx, { tagsHinzu: [], tagsWeg: a.tags, felder: [] });
      if (a.art === "dokumenttyp")
        await aenderungPruefen(tx, { tagsHinzu: [], tagsWeg: [], felder: [], dokumenttyp: a.dokumenttyp });
      if (a.art === "korrespondent")
        await aenderungPruefen(tx, { tagsHinzu: [], tagsWeg: [], felder: [], korrespondent: a.korrespondent });
      if (a.art === "feld") {
        if (a.wert === null || a.wert === undefined || a.wert === "") throw konflikt("Feldwert fehlt");
        await aenderungPruefen(tx, { tagsHinzu: [], tagsWeg: [], felder: [{ feldId: a.feldId, wert: a.wert }] });
      }
    }
  });
}

export async function workflowsListen(db: Datenbank): Promise<Workflow[]> {
  return (await db
    .select()
    .from(workflows)
    .orderBy(asc(workflows.reihenfolge), asc(workflows.erstelltAm), asc(workflows.id))) as Workflow[];
}

/** Fehler, den die Route als 503 meldet: ohne BELEGT_SCHLUESSEL lässt sich der Wert einer Kopfzeile nicht speichern */
export const ohneSchluessel = () => Object.assign(new Error("BELEGT_SCHLUESSEL fehlt"), { ohneSchluessel: true });

/**
 * Legt einen Workflow an, am Ende der Reihenfolge; wirft einen Konflikt bei unbekanntem Tag, Typ oder Feld. Werte von
 * Kopfzeilen (Aktion senden) gehen verschlüsselt nach workflow_geheimnisse, in aktionen bleibt nur ihr Name.
 */
export async function workflowAnlegen(
  db: Datenbank,
  eingabe: z.infer<typeof WorkflowEingabe>,
  akteur: string,
  schluessel?: Buffer,
) {
  await aktionenPruefen(db, eingabe.aktionen);
  const geheim = eingabe.aktionen.flatMap((a, position) =>
    a.art === "senden" && a.kopfzeile?.wert ? [{ position, wert: a.kopfzeile.wert }] : [],
  );
  if (geheim.length && !schluessel) throw ohneSchluessel();
  const aktionen = eingabe.aktionen.map((a) =>
    a.art === "senden" && a.kopfzeile
      ? { ...a, kopfzeile: { name: a.kopfzeile.name, ...(a.kopfzeile.wert ? { gesetzt: true as const } : {}) } }
      : a,
  );
  const [neu] = await mitAkteur(db, akteur, async (tx) => {
    const [letzte] = await tx.execute<{ n: number | null }>(sql`select max(reihenfolge) as n from workflows`);
    const zeilen = await tx
      .insert(workflows)
      .values({ ...eingabe, aktionen, reihenfolge: (letzte?.n ?? -1) + 1 })
      .returning();
    for (const g of geheim)
      await tx.insert(workflowGeheimnisse).values({
        workflowId: zeilen[0]!.id,
        position: g.position,
        ciphertext: verschluesseln(schluessel!, Buffer.from(g.wert)),
      });
    return zeilen;
  });
  return neu as Workflow;
}

export async function workflowSchalten(db: Datenbank, id: string, aktiv: boolean, akteur: string) {
  const [w] = await mitAkteur(db, akteur, (tx) =>
    tx.update(workflows).set({ aktiv }).where(eq(workflows.id, id)).returning(),
  );
  return (w as Workflow | undefined) ?? null;
}

/** Löscht einen Workflow; seine Läufe bleiben im Protokoll */
export async function workflowLoeschen(db: Datenbank, id: string, akteur: string) {
  const weg = await mitAkteur(db, akteur, (tx) =>
    tx.delete(workflows).where(eq(workflows.id, id)).returning({ id: workflows.id }),
  );
  return weg.length > 0;
}

/** Reihenfolge nach ids; unbekannte IDs sind ein Fehler (false). Nur geänderte Plätze kommen ins Audit-Log */
export async function workflowsOrdnen(db: Datenbank, ids: string[], akteur: string) {
  const eindeutig = [...new Set(ids)];
  return mitAkteur(db, akteur, async (tx) => {
    const da = await tx
      .select({ id: workflows.id, reihenfolge: workflows.reihenfolge })
      .from(workflows)
      .where(inArray(workflows.id, eindeutig));
    if (da.length !== eindeutig.length) return false;
    const bisher = new Map(da.map((w) => [w.id, w.reihenfolge]));
    for (const [platz, id] of eindeutig.entries())
      if (bisher.get(id) !== platz) await tx.update(workflows).set({ reihenfolge: platz }).where(eq(workflows.id, id));
    return true;
  });
}

export interface Lauf {
  id: string;
  workflowId: string;
  workflowName: string;
  dokumentId: string;
  asn: number;
  dateiname: string | null;
  ausloeser: string;
  ergebnis: "ausgefuehrt" | "trifft_nicht" | "angehalten" | "fehler";
  aktionen: unknown;
  fehler: string | null;
  zeitpunkt: string;
}

/** Die letzten Läufe, die etwas getan haben oder scheiterten (ohne „trifft nicht“ und „angehalten“), neueste zuerst */
export async function laeufeListen(db: Datenbank, { limit = 50, alle = false } = {}): Promise<Lauf[]> {
  const zeilen = await db.execute<{
    id: string;
    workflow_id: string;
    workflow_name: string;
    dokument_id: string;
    asn: string;
    dateiname: string | null;
    ausloeser: string;
    ergebnis: Lauf["ergebnis"];
    aktionen: unknown;
    fehler: string | null;
    zeitpunkt: Date;
  }>(sql`
    select l.*, a.nummer as asn, d.dateiname
      from workflow_laeufe l
      join dokumente d on d.id = l.dokument_id
      join archivnummern a on a.dokument_id = d.id
     where ${alle} or l.ergebnis in ('ausgefuehrt', 'fehler')
     order by l.zeitpunkt desc, l.id desc
     limit ${limit}`);
  return [...zeilen].map((z) => ({
    id: z.id,
    workflowId: z.workflow_id,
    workflowName: z.workflow_name,
    dokumentId: z.dokument_id,
    asn: Number(z.asn),
    dateiname: z.dateiname,
    ausloeser: z.ausloeser,
    ergebnis: z.ergebnis,
    aktionen: z.aktionen,
    fehler: z.fehler,
    zeitpunkt: new Date(z.zeitpunkt).toISOString(),
  }));
}

/** Aktive Workflows für die Verfahrensdokumentation, in ihrer Reihenfolge */
export async function aktiveWorkflows(db: Datenbank): Promise<Workflow[]> {
  return (await workflowsListen(db)).filter((w) => w.aktiv);
}
