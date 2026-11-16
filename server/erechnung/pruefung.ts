import { eq, sql } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import { erechnungPruefungen } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { speicherbar } from "../inhalt/erechnung.ts";
import { eRechnungXmlImKind } from "../inhalt/inhalt.ts";

/*
 * E-Rechnungen prüfen mit dem Validator der KoSIT (https://github.com/itplr-kosit/validator, docs/daemon.md) und der
 * Konfiguration für XRechnung (https://github.com/itplr-kosit/validator-configuration-xrechnung, scenarios.xml: XRechnung
 * in UBL und CII, dazu EN 16931 ohne XRechnung, also auch ZUGFeRD und Factur-X ab dem Profil EN 16931). Der Validator
 * läuft als eigener Dienst (VALIDATOR_URL, deploy/validator) und bekommt das XML im Rumpf eines POST; er antwortet mit
 * einem Prüfbericht (VARL, http://www.xoev.de/de/validator/varl/1) und dem Status 200 (annehmbar) oder 406 (nicht
 * annehmbar). Das Ergebnis ist abgeleitet wie Text und Ansicht: Es geht mit der bestätigten Löschung.
 */

export interface Meldung {
  stufe: "fehler" | "warnung";
  /** Regel oder Schema-Fehler, etwa BR-CO-15 oder cvc-complex-type.2.4.a */
  code: string | null;
  text: string;
}

export interface Pruefung {
  gueltig: boolean;
  /** Erkanntes Szenario, etwa „EN16931 XRechnung (UBL Invoice)“; null, wenn keins passte */
  szenario: string | null;
  fehler: number;
  warnungen: number;
  /** Die ersten Fehler und Warnungen, gekürzt */
  meldungen: Meldung[];
}

/** So viele Meldungen und Zeichen je Meldung werden gespeichert; der Validator kann Hunderte liefern */
const MAX_MELDUNGEN = 20;
const MAX_TEXT = 300;
/** Größer liest Belegt keinen Prüfbericht; er enthält die Erklärung als HTML, bleibt aber weit darunter */
const MAX_BERICHT = 32 * 1024 * 1024;

/** Der Dienst ist gerade nicht da: nichts festhalten, im nächsten Lauf wieder (wie beim Vorschau-Dienst) */
const nichtErreichbar = (meldung: string) => Object.assign(new Error(meldung), { nichtErreichbar: true });
const istNichtErreichbar = (err: unknown) => err instanceof Error && "nichtErreichbar" in err;

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
  isArray: (name) => ["message", "validationStepResult"].includes(name),
});

type Knoten = Record<string, unknown>;
const knoten = (k: unknown): Knoten => (k && typeof k === "object" ? (k as Knoten) : {});
const kurz = (t: unknown) =>
  speicherbar(
    String(t ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, MAX_TEXT);

/** Alle message-Elemente unter einem Knoten, in der Reihenfolge des Berichts */
function meldungenIn(k: unknown): Knoten[] {
  if (Array.isArray(k)) return k.flatMap(meldungenIn);
  if (!k || typeof k !== "object") return [];
  return Object.entries(k as Knoten).flatMap(([name, wert]) =>
    name === "message" ? (wert as Knoten[]) : name.startsWith("@") ? [] : meldungenIn(wert),
  );
}

/**
 * Liest den Prüfbericht des Validators: Annahme oder Ablehnung (assessment/accept oder reject), das Szenario und die
 * Meldungen der Stufen error und warning; null, wenn es kein Bericht ist
 */
export function berichtLesen(xml: string): Pruefung | null {
  let wurzel: Knoten;
  try {
    wurzel = parser.parse(xml) as Knoten;
  } catch {
    return null;
  }
  const bericht = knoten(wurzel.report);
  const bewertung = knoten(bericht.assessment);
  if (!("accept" in bewertung) && !("reject" in bewertung)) return null;
  const szenario = knoten(knoten(bericht.scenarioMatched).scenario).name;
  const alle = meldungenIn(bericht.scenarioMatched).map((m) => ({
    stufe: m["@level"] === "error" ? ("fehler" as const) : m["@level"] === "warning" ? ("warnung" as const) : null,
    code: m["@code"] ? kurz(m["@code"]) : null,
    text: kurz(typeof m === "object" ? m["#text"] : m),
  }));
  const relevant = alle.filter((m): m is Meldung => m.stufe !== null);
  const kein = "noScenarioMatched" in bericht;
  return {
    gueltig: "accept" in bewertung,
    szenario: typeof szenario === "string" ? kurz(szenario) : null,
    fehler: relevant.filter((m) => m.stufe === "fehler").length + (kein ? 1 : 0),
    warnungen: relevant.filter((m) => m.stufe === "warnung").length,
    meldungen: [
      ...(kein
        ? [{ stufe: "fehler" as const, code: null, text: "Kein passendes Prüfszenario: weder XRechnung noch EN 16931" }]
        : []),
      ...relevant,
    ].slice(0, MAX_MELDUNGEN),
  };
}

export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

/** Der Rumpf der Antwort als Text, höchstens MAX_BERICHT Bytes; darüber bricht das Lesen ab */
async function begrenztLesen(res: Response): Promise<string> {
  const zuGross = () => nichtErreichbar("Antwort des Validators zu groß");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BERICHT) throw zuGross();
  const teile: Uint8Array[] = [];
  let laenge = 0;
  for await (const teil of res.body ?? []) {
    laenge += teil.length;
    if (laenge > MAX_BERICHT) {
      await res.body?.cancel().catch(() => {});
      throw zuGross();
    }
    teile.push(teil);
  }
  return Buffer.concat(teile).toString("utf8");
}

/**
 * Schickt das XML an den Validator. Antwortet er nicht, mit 429 oder 5xx, ist das vorübergehend (nichtErreichbar);
 * 400 und 422 (das XML lässt sich nicht verarbeiten) sind ein Befund der Datei.
 */
export async function beimDienstPruefen(
  xml: string,
  url: string,
  { abfragen = fetch, zeitlimit = 120_000 }: { abfragen?: Abfragen; zeitlimit?: number } = {},
): Promise<Pruefung> {
  let res: Response;
  try {
    res = await abfragen(url, {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: xml,
      redirect: "manual",
      signal: AbortSignal.timeout(zeitlimit),
    });
  } catch {
    throw nichtErreichbar("Validator nicht erreichbar");
  }
  if (res.status === 429 || res.status >= 500) throw nichtErreichbar(`Validator antwortet ${res.status}`);
  const text = await begrenztLesen(res);
  if (res.status === 400 || res.status === 422) {
    return {
      gueltig: false,
      szenario: null,
      fehler: 1,
      warnungen: 0,
      meldungen: [{ stufe: "fehler", code: null, text: "Das XML lässt sich nicht verarbeiten" }],
    };
  }
  const pruefung = berichtLesen(text);
  if (!pruefung || (res.status !== 200 && res.status !== 406))
    throw nichtErreichbar(`Unerwartete Antwort des Validators (${res.status})`);
  return pruefung;
}

/**
 * Prüft E-Rechnungen, die gelesen und noch nicht geprüft sind (nicht gelöscht). Ist der Dienst nicht da, endet der Lauf
 * ohne Eintrag und versucht es beim nächsten wieder; Dokumente, die vor dem Einschalten kamen, prüft er nachträglich.
 */
export async function erechnungenPruefen(
  { db, speicher }: Umgebung,
  url: string,
  { stapel = 10, abfragen }: { stapel?: number; abfragen?: Abfragen } = {},
): Promise<{ geprueft: number; ungueltig: number; meldung?: string }> {
  const offen = await db.execute<{ id: string; sha256: string; mime_type: string }>(sql`
    select d.id, d.sha256, d.mime_type from dokumente d join inhalte i on i.dokument_id = d.id
     where i.erechnung is not null
       and not exists (select 1 from erechnung_pruefungen p where p.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am limit ${stapel}`);
  let geprueft = 0;
  let ungueltig = 0;
  for (const d of offen) {
    let pruefung: Pruefung;
    try {
      const bytes = await speicher.laden(d.sha256).catch(() => {
        throw nichtErreichbar("Speicher nicht erreichbar");
      });
      const xml = await eRechnungXmlImKind(new Uint8Array(bytes), d.mime_type).catch(() => null);
      pruefung = xml
        ? await beimDienstPruefen(xml, url, { abfragen })
        : {
            gueltig: false,
            szenario: null,
            fehler: 1,
            warnungen: 0,
            meldungen: [{ stufe: "fehler", code: null, text: "Das XML der E-Rechnung lässt sich nicht lesen" }],
          };
    } catch (err) {
      if (istNichtErreichbar(err)) return { geprueft, ungueltig, meldung: (err as Error).message };
      throw err;
    }
    await db
      .insert(erechnungPruefungen)
      .values({ dokumentId: d.id, ...pruefung })
      .onConflictDoNothing();
    geprueft++;
    if (!pruefung.gueltig) ungueltig++;
  }
  return { geprueft, ungueltig };
}

/** Die Prüfung einer E-Rechnung, null ohne (keine E-Rechnung, noch nicht geprüft oder ohne Validator) */
export async function pruefungZu(db: Umgebung["db"], dokumentId: string) {
  const [p] = await db
    .select({
      gueltig: erechnungPruefungen.gueltig,
      szenario: erechnungPruefungen.szenario,
      fehler: erechnungPruefungen.fehler,
      warnungen: erechnungPruefungen.warnungen,
      meldungen: erechnungPruefungen.meldungen,
      geprueftAm: erechnungPruefungen.geprueftAm,
    })
    .from(erechnungPruefungen)
    .where(eq(erechnungPruefungen.dokumentId, dokumentId));
  return p ? { ...p, meldungen: p.meldungen as Meldung[], geprueftAm: p.geprueftAm.toISOString() } : null;
}
