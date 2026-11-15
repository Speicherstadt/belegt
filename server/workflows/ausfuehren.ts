import { sql } from "drizzle-orm";
import { type Ausloeser, bedingungenErfuellt, brauchtText, type DokumentMerkmale } from "../../shared/workflows.ts";
import { mitAkteur, type Tx } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { notizen, webhookEreignisse, workflowLaeufe } from "../db/schema.ts";
import { aktuelle, einordnenIn } from "../einordnung/einordnung.ts";
import { LESBAR } from "../inhalt/inhalt.ts";
import { ocrVerfuegbar } from "../inhalt/ocr.ts";
import { mailZuDokument } from "../mail/import.ts";
import { aenderungAnwenden } from "../ordnung/zuordnung.ts";
import { type Aktion, type Workflow, workflowsListen } from "./workflows.ts";

/*
 * Führt Workflows im Worker aus (docs/workflows.md). Auslöser sind die Ereignisse, die Postgres für Webhooks schreibt
 * (dokument.aufgenommen → eingang, dokument.eingeordnet → eingeordnet), ab dem Anlegen des Workflows. Je Workflow und
 * Dokument läuft er genau einmal: das Ergebnis steht in workflow_laeufe (nur anhängen, eindeutig je Paar), ein zweiter
 * Lauf findet nichts mehr. Die Aktionen eines Workflows und sein Lauf sind eine Transaktion mit dem Akteur
 * workflow:<Name>; scheitert eine Aktion, ist nichts davon geschehen und der Fehler steht im Lauf. Gelöschte Dokumente
 * bearbeitet kein Workflow.
 */

const BILDER = ["image/jpeg", "image/png", "image/webp"];
const ARRAY = (werte: string[]) =>
  sql`array[${sql.join(
    werte.map((w) => sql`${w}`),
    sql`, `,
  )}]::text[]`;
const geloescht = sql`exists (select 1 from loeschungen l where l.dokument_id = e.dokument_id and l.bestaetigt_am is not null)`;

interface Ereignis {
  id: number;
  dokumentId: string;
  ausloeser: Ausloeser;
  zeitpunkt: Date;
}

/** Ereignisse, für die noch mindestens ein aktiver Workflow aussteht, älteste zuerst */
async function offeneEreignisse(db: Datenbank, stapel: number): Promise<Ereignis[]> {
  const zeilen = await db.execute<{ id: string; dokument_id: string; art: string; zeitpunkt: Date }>(sql`
    select e.id, e.dokument_id, e.art, e.zeitpunkt from webhook_ereignisse e
     where e.art in ('dokument.aufgenommen', 'dokument.eingeordnet')
       and not ${geloescht}
       and exists (select 1 from workflows w
                    where w.aktiv and w.erstellt_am <= e.zeitpunkt
                      and w.ausloeser = case e.art when 'dokument.aufgenommen' then 'eingang' else 'eingeordnet' end
                      and not exists (select 1 from workflow_laeufe l
                                       where l.workflow_id = w.id and l.dokument_id = e.dokument_id))
     order by e.id limit ${stapel}`);
  return [...zeilen].map((z) => ({
    id: Number(z.id),
    dokumentId: z.dokument_id,
    ausloeser: z.art === "dokument.aufgenommen" ? "eingang" : "eingeordnet",
    zeitpunkt: new Date(z.zeitpunkt),
  }));
}

/** Ob der Text eines Dokuments gelesen ist oder es keinen gibt, den der Worker liest */
async function textBereit(db: Datenbank, dokumentId: string, ocr: boolean): Promise<boolean> {
  const [z] = await db.execute<{ bereit: boolean }>(sql`
    select not (d.mime_type = any(${ARRAY(LESBAR)}) or (${ocr} and d.mime_type = any(${ARRAY(BILDER)})))
           or exists (select 1 from inhalte i where i.dokument_id = d.id) as bereit
      from dokumente d where d.id = ${dokumentId}`);
  return z?.bereit ?? false;
}

/** Was die Bedingungen prüfen; den Text nur, wenn eine ihn braucht */
async function merkmale(db: Datenbank | Tx, dokumentId: string, mitText: boolean): Promise<DokumentMerkmale | null> {
  const [d] = await db.execute<{
    quelle: string;
    dateiname: string | null;
    mime_type: string;
    tags: string[];
    dokumenttyp: string | null;
    korrespondent: string | null;
    herkunft: string | null;
    text: string | null;
  }>(sql`
    select d.quelle, d.dateiname, d.mime_type,
           array(select dt.tag_id::text from dokument_tags dt where dt.dokument_id = d.id) as tags,
           (select dd.dokumenttyp_id::text from dokument_dokumenttypen dd where dd.dokument_id = d.id) as dokumenttyp,
           (select dk.korrespondent_id::text from dokument_korrespondenten dk where dk.dokument_id = d.id) as korrespondent,
           (select a.actor from audit_log a where a.table_name = 'dokumente' and a.row_id = d.id::text
               and a.action = 'INSERT' order by a.seq limit 1) as herkunft,
           case when ${mitText} then concat_ws(' ', (select i.text from inhalte i where i.dokument_id = d.id),
                                                 (select m.text from mails m where m.dokument_id = d.id)) end as text
      from dokumente d where d.id = ${dokumentId}`);
  if (!d) return null;
  const mail = await mailZuDokument(db as Datenbank, dokumentId);
  return {
    quelle: d.quelle,
    dateiname: d.dateiname,
    mimeType: d.mime_type,
    mail: mail
      ? { absender: mail.von, betreff: mail.betreff, anhangTypen: mail.anhaenge.map((a) => a.mimeType) }
      : null,
    text: d.text,
    tags: d.tags,
    dokumenttyp: d.dokumenttyp,
    korrespondent: d.korrespondent,
    herkunft: d.herkunft,
  };
}

/** Tag der Entstehung für eine Einordnung durch einen Workflow: Eingang oder Datum der E-Rechnung */
async function entstehung(tx: Tx, dokumentId: string, quelle: "eingang" | "erechnung"): Promise<string> {
  const [z] = await tx.execute<{ eingang: string; rechnung: string | null }>(sql`
    select (d.eingegangen_am at time zone 'Europe/Berlin')::date::text as eingang,
           (select i.erechnung ->> 'datum' from inhalte i where i.dokument_id = d.id) as rechnung
      from dokumente d where d.id = ${dokumentId}`);
  const rechnung = z?.rechnung;
  return quelle === "erechnung" && rechnung && /^\d{4}-\d{2}-\d{2}$/.test(rechnung) ? rechnung : z!.eingang;
}

const leer = { tagsHinzu: [], tagsWeg: [], felder: [] };

/** Eine Aktion in der Transaktion des Workflows; gibt zurück, was geschah (für das Protokoll) */
async function aktionAusfuehren(tx: Tx, w: Workflow, dokumentId: string, a: Aktion): Promise<Record<string, unknown>> {
  switch (a.art) {
    case "tagsHinzu":
      await aenderungAnwenden(tx, dokumentId, { ...leer, tagsHinzu: a.tags });
      return { art: a.art, tags: a.tags };
    case "tagsWeg":
      await aenderungAnwenden(tx, dokumentId, { ...leer, tagsWeg: a.tags });
      return { art: a.art, tags: a.tags };
    case "dokumenttyp":
      await aenderungAnwenden(tx, dokumentId, { ...leer, dokumenttyp: a.dokumenttyp });
      return { art: a.art, dokumenttyp: a.dokumenttyp };
    case "korrespondent":
      await aenderungAnwenden(tx, dokumentId, { ...leer, korrespondent: a.korrespondent });
      return { art: a.art, korrespondent: a.korrespondent };
    case "feld":
      await aenderungAnwenden(tx, dokumentId, { ...leer, felder: [{ feldId: a.feldId, wert: a.wert }] });
      return { art: a.art, feldId: a.feldId };
    case "einordnen": {
      // Nur im Eingang: eine Einordnung durch einen Menschen ersetzt kein Workflow
      if (await aktuelle(tx, dokumentId)) return { art: a.art, uebersprungen: "schon eingeordnet" };
      const e = await einordnenIn(tx, dokumentId, {
        art: a.als,
        entstanden: await entstehung(tx, dokumentId, a.entstanden),
        freiwilligBis: a.freiwilligBis,
        titel: a.titel,
        korrespondent: a.korrespondent,
      });
      return { art: a.art, als: a.als, entstanden: e.entstanden, fristBis: e.fristBis };
    }
    case "webhook":
      await tx.insert(webhookEreignisse).values({ art: "dokument.workflow", dokumentId, workflow: w.name });
      return { art: a.art };
    case "notiz":
      await tx.insert(notizen).values({ dokumentId, text: a.text, erstelltVon: `workflow:${w.name}` });
      return { art: a.art };
  }
}

/** Fehler als Text für das Protokoll: Meldungen der Trigger und eigene, nie SQL mit Parametern */
function meldung(err: unknown): string {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const quelle = e?.code ? e : e?.cause;
  if (quelle?.code === "23514") return (quelle.message ?? "Nicht erlaubt").slice(0, 500);
  if (err instanceof Error && !("code" in err) && !(err.cause as unknown)) return err.message.slice(0, 500);
  return "Nicht möglich";
}

type Ergebnis = "ausgefuehrt" | "trifft_nicht" | "angehalten" | "fehler";

/** Führt einen zutreffenden Workflow aus: Aktionen und Lauf in einer Transaktion, sonst der Fehler als Lauf */
async function ausfuehren(db: Datenbank, w: Workflow, e: Ereignis): Promise<Ergebnis> {
  const lauf = { workflowId: w.id, workflowName: w.name, dokumentId: e.dokumentId, ausloeser: e.ausloeser };
  try {
    await mitAkteur(db, `workflow:${w.name}`, async (tx) => {
      const getan = [];
      for (const a of w.aktionen) getan.push(await aktionAusfuehren(tx, w, e.dokumentId, a));
      await tx.insert(workflowLaeufe).values({ ...lauf, ereignisId: e.id, ergebnis: "ausgefuehrt", aktionen: getan });
    });
    return "ausgefuehrt";
  } catch (err) {
    await protokollieren(db, w, { ...lauf, ereignisId: e.id, ergebnis: "fehler", fehler: meldung(err) });
    return "fehler";
  }
}

async function protokollieren(db: Datenbank, w: Workflow, lauf: typeof workflowLaeufe.$inferInsert) {
  await mitAkteur(db, `workflow:${w.name}`, (tx) => tx.insert(workflowLaeufe).values(lauf).onConflictDoNothing());
}

/**
 * Ein Lauf über die offenen Ereignisse. Je Ereignis gehen die ausstehenden Workflows seines Auslösers der Reihe nach
 * durch; trifft einer mit „anhalten“ zu, sind die folgenden „angehalten“. Braucht einer den Text und ist er noch nicht
 * gelesen, wartet das ganze Ereignis, damit Reihenfolge und Anhalten gelten.
 */
export async function workflowsAusfuehren(
  db: Datenbank,
  { stapel = 50, ocr = ocrVerfuegbar() }: { stapel?: number; ocr?: boolean } = {},
): Promise<{ ausgefuehrt: number; fehler: number; wartet: number }> {
  const zaehler = { ausgefuehrt: 0, fehler: 0, wartet: 0 };
  const aktive = (await workflowsListen(db)).filter((w) => w.aktiv);
  if (!aktive.length) return zaehler;
  const erledigt = new Set<string>();
  for (const e of await offeneEreignisse(db, stapel)) {
    const schluessel = `${e.dokumentId}:${e.ausloeser}`;
    if (erledigt.has(schluessel)) continue;
    erledigt.add(schluessel);
    const gelaufen = new Set(
      [
        ...(await db.execute<{ workflow_id: string }>(
          sql`select workflow_id from workflow_laeufe where dokument_id = ${e.dokumentId}`,
        )),
      ].map((z) => z.workflow_id),
    );
    const offen = aktive.filter(
      (w) => w.ausloeser === e.ausloeser && w.erstelltAm <= e.zeitpunkt && !gelaufen.has(w.id),
    );
    const mitText = offen.some((w) => brauchtText(w.bedingungen));
    if (mitText && !(await textBereit(db, e.dokumentId, ocr))) {
      zaehler.wartet++;
      continue;
    }
    let angehalten = false;
    for (const w of offen) {
      const lauf = { workflowId: w.id, workflowName: w.name, dokumentId: e.dokumentId, ausloeser: e.ausloeser };
      if (angehalten) {
        await protokollieren(db, w, { ...lauf, ereignisId: e.id, ergebnis: "angehalten" });
        continue;
      }
      // Je Workflow neu, denn ein früherer kann Tags oder den Dokumenttyp geändert haben
      const m = await merkmale(db, e.dokumentId, brauchtText(w.bedingungen));
      if (!m || !bedingungenErfuellt(w.bedingungen, m)) {
        await protokollieren(db, w, { ...lauf, ereignisId: e.id, ergebnis: "trifft_nicht" });
        continue;
      }
      const ergebnis = await ausfuehren(db, w, e);
      zaehler[ergebnis === "ausgefuehrt" ? "ausgefuehrt" : "fehler"]++;
      if (w.anhalten) angehalten = true;
    }
  }
  return zaehler;
}
