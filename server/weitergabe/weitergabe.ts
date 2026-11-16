import { and, eq, sql } from "drizzle-orm";
import { entschluesseln } from "../crypto.ts";
import { mitAkteur } from "../db/akteur.ts";
import { weitergaben, workflowGeheimnisse, workflows } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import type { Aktion } from "../workflows/workflows.ts";

/*
 * Workflow-Aktion „Original an Adresse senden“ (docs/workflows.md#original-an-adresse-senden): Der Workflow merkt die
 * Weitergabe vor (server/workflows/ausfuehren.ts), der Worker sendet das Original als multipart/form-data mit
 * Wiederholung. Erfolg ist eine Antwort 2xx; einer Weiterleitung folgt er nicht (wie die Webhooks,
 * server/webhooks/webhooks.ts: nur http und https, redirect manual, Zeitlimit), damit eine Antwort des Empfängers das
 * Original nicht an eine andere Adresse lenkt. Je Dokument und Aktion höchstens ein erfolgreicher Versand: eine Zeile in
 * weitergaben, die Postgres nach dem Erfolg festhält. Der Wert der Kopfzeile steht nie in Log, Audit-Log oder Fehler.
 */

type Senden = Extract<Aktion, { art: "senden" }>;
export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

export const AKTEUR = "system:weitergabe";

/** Minuten bis zum nächsten Versuch nach dem n-ten Fehlschlag; danach gibt Belegt auf (zusammen etwa zwei Tage) */
export const WARTEN_MINUTEN = [1, 5, 15, 60, 180, 360, 720, 1440];

/**
 * Ob ein erneuter Versuch etwas ändern kann: ohne Antwort, bei Zeitüberschreitung, „zu früh“, zu vielen Anfragen und
 * Fehlern des Empfängers ja; eine Weiterleitung oder eine Ablehnung der Anfrage (4xx) bleibt, wie sie ist
 */
export const voruebergehend = (status: number | null) =>
  status === null || status === 408 || status === 425 || status === 429 || status >= 500;

/** Was ein Platzhalter einsetzen kann */
export interface Angaben {
  id: string;
  asn: number;
  dateiname: string | null;
  titel: string | null;
  /** Tag der Entstehung aus der Einordnung, sonst der des Eingangs (JJJJ-MM-TT) */
  datum: string;
  eingang: string;
  art: string | null;
  korrespondent: string | null;
  dokumenttyp: string | null;
  url: string;
}

/** {titel}, {asn}, {datum} … durch die Angaben des Dokuments ersetzen; Unbekanntes bleibt stehen */
export function platzhalterErsetzen(text: string, a: Angaben): string {
  const werte: Record<string, string> = {
    id: a.id,
    asn: String(a.asn),
    dateiname: a.dateiname ?? "",
    titel: a.titel ?? a.dateiname ?? "",
    datum: a.datum,
    eingang: a.eingang,
    art: a.art ?? "",
    korrespondent: a.korrespondent ?? "",
    dokumenttyp: a.dokumenttyp ?? "",
    url: a.url,
  };
  return text.replace(/\{([a-z]+)\}/g, (ganz, name: string) => werte[name] ?? ganz);
}

async function angaben(db: Umgebung["db"], dokumentId: string, basisUrl: string) {
  const [z] = await db.execute<{
    id: string;
    sha256: string;
    asn: string;
    dateiname: string | null;
    titel: string | null;
    entstanden: string | null;
    eingang: string;
    art: string | null;
    korrespondent: string | null;
    dokumenttyp: string | null;
    geloescht: boolean;
  }>(sql`
    select d.id, d.sha256, a.nummer as asn, d.dateiname, e.titel, e.entstanden::text as entstanden, e.art,
           (d.eingegangen_am at time zone 'Europe/Berlin')::date::text as eingang,
           (select k.name from dokument_korrespondenten dk join korrespondenten k on k.id = dk.korrespondent_id
             where dk.dokument_id = d.id) as korrespondent,
           (select ty.name from dokument_dokumenttypen dd join dokumenttypen ty on ty.id = dd.dokumenttyp_id
             where dd.dokument_id = d.id) as dokumenttyp,
           exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null) as geloescht
      from dokumente d join archivnummern a on a.dokument_id = d.id
      left join lateral (select * from einordnungen x where x.dokument_id = d.id
                          order by x.erstellt_am desc, x.id desc limit 1) e on true
     where d.id = ${dokumentId}`);
  if (!z) return null;
  return {
    sha256: z.sha256,
    geloescht: z.geloescht,
    angaben: {
      id: z.id,
      asn: Number(z.asn),
      dateiname: z.dateiname,
      titel: z.titel,
      datum: z.entstanden ?? z.eingang,
      eingang: z.eingang,
      art: z.art,
      korrespondent: z.korrespondent,
      dokumenttyp: z.dokumenttyp,
      url: new URL(`/dokumente/${z.id}`, basisUrl).href,
    } satisfies Angaben,
  };
}

/** Die Anfrage: das Original im Dateifeld, die festen Felder mit eingesetzten Platzhaltern, die Kopfzeile */
export function anfrageBauen(
  aktion: Senden,
  bytes: Uint8Array,
  a: Angaben,
  kopfwert: string | null,
): { url: string; init: RequestInit } {
  const form = new FormData();
  for (const f of aktion.felder) form.append(f.name, platzhalterErsetzen(f.wert, a));
  form.append(aktion.dateifeld, new File([new Uint8Array(bytes)], a.dateiname ?? `ASN-${a.asn}`));
  const headers: Record<string, string> = {};
  if (aktion.kopfzeile && kopfwert) headers[aktion.kopfzeile.name] = kopfwert;
  return { url: aktion.url, init: { method: "POST", body: form, headers, redirect: "manual" } };
}

/** Meldung eines Fehlers ohne Anfrage oder Kopfzeilen, gekürzt */
const meldung = (err: unknown) =>
  (err instanceof Error ? `${err.name === "TimeoutError" ? "Zeitüberschreitung: " : ""}${err.message}` : "Fehler")
    .split("\n")[0]!
    .slice(0, 300);

/** Fällige Weitergaben holen und für zehn Minuten vormerken, damit ein zweiter Lauf sie nicht zugleich sendet */
async function faellige(db: Umgebung["db"], stapel: number) {
  return mitAkteur(db, AKTEUR, async (tx) => {
    const zeilen = await tx.execute<{
      id: string;
      workflow_id: string;
      position: number;
      dokument_id: string;
      versuche: number;
    }>(sql`
      select id, workflow_id, position, dokument_id, versuche from weitergaben
       where stand = 'offen' and naechster_versuch <= now()
       order by naechster_versuch, id limit ${stapel} for update skip locked`);
    for (const z of zeilen)
      await tx
        .update(weitergaben)
        .set({ naechsterVersuch: sql`now() + interval '10 minutes'` })
        .where(eq(weitergaben.id, z.id));
    return [...zeilen];
  });
}

async function festhalten(db: Umgebung["db"], id: string, werte: Partial<typeof weitergaben.$inferInsert>) {
  await mitAkteur(db, AKTEUR, (tx) => tx.update(weitergaben).set(werte).where(eq(weitergaben.id, id)));
}

/** Der Wert der Kopfzeile einer Aktion, entschlüsselt; null ohne */
async function kopfwertZu(db: Umgebung["db"], schluessel: Buffer, workflowId: string, position: number) {
  const [g] = await db
    .select({ ciphertext: workflowGeheimnisse.ciphertext })
    .from(workflowGeheimnisse)
    .where(and(eq(workflowGeheimnisse.workflowId, workflowId), eq(workflowGeheimnisse.position, position)));
  return g ? entschluesseln(schluessel, g.ciphertext).toString() : null;
}

/**
 * Ein Lauf über die fälligen Weitergaben: senden, Ergebnis festhalten, bei einem vorübergehenden Fehler später wieder
 * (WARTEN_MINUTEN), sonst aufgeben. Gelöschte Dokumente und gelöschte Workflows entfallen.
 */
export async function weitergeben(
  { db, speicher }: Umgebung,
  {
    schluessel,
    basisUrl,
    abfragen = fetch,
    stapel = 10,
    zeitlimit = 60_000,
  }: { schluessel: Buffer; basisUrl: string; abfragen?: Abfragen; stapel?: number; zeitlimit?: number },
): Promise<{ gesendet: number; fehler: number }> {
  let gesendet = 0;
  let fehler = 0;
  for (const z of await faellige(db, stapel)) {
    const [w] = await db.select().from(workflows).where(eq(workflows.id, z.workflow_id));
    const aktion = (w?.aktionen as Aktion[] | undefined)?.[z.position];
    const dok = await angaben(db, z.dokument_id, basisUrl);
    if (!w || aktion?.art !== "senden" || !dok || dok.geloescht) {
      await festhalten(db, z.id, {
        stand: "entfallen",
        fehler: !dok || dok.geloescht ? "Dokument gelöscht" : "Workflow gelöscht",
      });
      continue;
    }
    const versuche = z.versuche + 1;
    let status: number | null = null;
    let text: string | null = null;
    try {
      const bytes = new Uint8Array(await speicher.laden(dok.sha256));
      const kopfwert = await kopfwertZu(db, schluessel, w.id, z.position);
      const { url, init } = anfrageBauen(aktion, bytes, dok.angaben, kopfwert);
      const res = await abfragen(url, { ...init, signal: AbortSignal.timeout(zeitlimit) });
      status = res.status;
      await res.body?.cancel().catch(() => {});
      if (res.ok) {
        await festhalten(db, z.id, {
          stand: "gesendet",
          versuche,
          letzterVersuch: new Date(),
          httpStatus: status,
          fehler: null,
          gesendetAm: new Date(),
        });
        gesendet++;
        continue;
      }
      text = status >= 300 && status < 400 ? `Weiterleitung (${status}), nicht gefolgt` : `Antwort ${status}`;
    } catch (err) {
      text = meldung(err);
    }
    fehler++;
    const nochmal = voruebergehend(status) && versuche <= WARTEN_MINUTEN.length;
    await festhalten(db, z.id, {
      stand: nochmal ? "offen" : "fehlgeschlagen",
      versuche,
      letzterVersuch: new Date(),
      httpStatus: status,
      fehler: text,
      ...(nochmal ? { naechsterVersuch: new Date(Date.now() + WARTEN_MINUTEN[versuche - 1]! * 60_000) } : {}),
    });
  }
  return { gesendet, fehler };
}

export interface Weitergabe {
  id: string;
  workflowName: string;
  /** Host der Adresse, solange es den Workflow gibt */
  ziel: string | null;
  stand: "offen" | "gesendet" | "fehlgeschlagen" | "entfallen";
  versuche: number;
  letzterVersuch: string | null;
  naechsterVersuch: string | null;
  httpStatus: number | null;
  fehler: string | null;
  gesendetAm: string | null;
}

/** Die Weitergaben eines Dokuments, älteste zuerst */
export async function weitergabenZu(db: Umgebung["db"], dokumentId: string): Promise<Weitergabe[]> {
  const zeilen = await db
    .select({ w: weitergaben, aktionen: workflows.aktionen })
    .from(weitergaben)
    .leftJoin(workflows, eq(workflows.id, weitergaben.workflowId))
    .where(eq(weitergaben.dokumentId, dokumentId))
    .orderBy(weitergaben.erstelltAm, weitergaben.id);
  return zeilen.map(({ w, aktionen }) => {
    const a = (aktionen as Aktion[] | null)?.[w.position];
    return {
      id: w.id,
      workflowName: w.workflowName,
      ziel: a?.art === "senden" ? new URL(a.url).host : null,
      stand: w.stand as Weitergabe["stand"],
      versuche: w.versuche,
      letzterVersuch: w.letzterVersuch?.toISOString() ?? null,
      naechsterVersuch: w.stand === "offen" ? w.naechsterVersuch.toISOString() : null,
      httpStatus: w.httpStatus,
      fehler: w.fehler,
      gesendetAm: w.gesendetAm?.toISOString() ?? null,
    };
  });
}
