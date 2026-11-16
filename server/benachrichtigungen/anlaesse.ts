import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { backupStand } from "../betrieb/backup.ts";
import type { Datenbank } from "../db/client.ts";
import { pruefen } from "../dokumente/dokumente.ts";
import type { Anlaesse, Anlass } from "./einstellungen.ts";

/*
 * Was gemeldet wird, je Anlass (docs/betrieb.md#benachrichtigungen). Datensparsam: Zahlen, Namen von Postfächern und
 * Workflows, die der Inhaber selbst vergeben hat, Archivnummern; nie Titel, Dateinamen, Absender oder Text von Dokumenten.
 * Jede Meldung trägt einen Zustand: Dieselbe Meldung im selben Zustand geht höchstens einmal je Abstand hinaus
 * (benachrichtigen.ts), ein neuer Zustand sofort.
 */

export interface Meldung {
  anlass: Anlass;
  zustand: string;
  betreff: string;
  zeilen: string[];
  /** Seite von Belegt, auf die der Link zeigt */
  pfad: string;
  /** Nur diese Empfänger statt der eingestellten (Löschanträge an die, die bestätigen dürfen) */
  empfaenger?: string[];
  /** Abstand für dieselbe Meldung im selben Zustand, Vorgabe ein Tag */
  abstandStunden?: number;
}

export interface Lage {
  jetzt: Date;
  /** Heutiger Tag in Deutschland, JJJJ-MM-TT */
  heute: string;
  /** Die tägliche Prüfung der Kette ist fällig (der Worker entscheidet) */
  kettePruefen: boolean;
}

const zeit = (d: Date | string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(
    new Date(d),
  );
const kurz = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const asnListe = (asns: number[], mehr: number) =>
  `ASN ${asns.join(", ")}${mehr > asns.length ? ` und ${mehr - asns.length} weitere` : ""}`;

const geloescht = sql`exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)`;

async function backup(db: Datenbank, { tage }: Anlaesse["backup"], { jetzt }: Lage): Promise<Meldung[]> {
  const stand = await backupStand(db, jetzt);
  const meldungen: Meldung[] = stand.fehlgeschlagen.map(({ art, lauf }) => ({
    anlass: "backup",
    zustand: `fehler:${art}:${lauf.am}`,
    betreff: art === "backup" ? "Belegt: Sicherung fehlgeschlagen" : "Belegt: Test-Restore fehlgeschlagen",
    zeilen: [
      `${art === "backup" ? "Die Sicherung" : "Der Test-Restore"} am ${zeit(lauf.am)} ist fehlgeschlagen.`,
      ...(lauf.meldung ? [`Meldung: ${lauf.meldung.slice(0, 300)}`] : []),
    ],
    pfad: "/",
  }));
  // Ohne jeden Lauf ist keine Sicherung eingerichtet; das sagt die Startseite, nicht täglich eine Mail
  const letztes = stand.letztesBackup?.am;
  const alt = letztes ? jetzt.getTime() - new Date(letztes).getTime() > tage * 86_400_000 : stand.zustand !== "keins";
  if (stand.zustand !== "keins" && alt)
    meldungen.push({
      anlass: "backup",
      zustand: `veraltet:${letztes ?? "nie"}`,
      betreff: "Belegt: keine aktuelle Sicherung",
      zeilen: [
        letztes
          ? `Das letzte erfolgreiche Backup war am ${zeit(letztes)}, vor mehr als ${tage} Tagen.`
          : "Es gibt noch kein erfolgreiches Backup.",
      ],
      pfad: "/",
    });
  return meldungen;
}

async function postfach(db: Datenbank, { tage }: Anlaesse["postfach"], { jetzt }: Lage): Promise<Meldung[]> {
  const grenze = new Date(jetzt.getTime() - tage * 86_400_000);
  const alt = await db.execute<{
    id: string;
    name: string;
    letzter_erfolg: Date | null;
    letzter_fehler: string | null;
  }>(
    sql`select id, name, letzter_erfolg, letzter_fehler from quellen
         where aktiv and coalesce(letzter_erfolg, erstellt_am) < ${grenze.toISOString()}::timestamptz order by name`,
  );
  const aktionen = await db.execute<{ id: string; name: string; anzahl: string }>(sql`
    select q.id, q.name, count(*) as anzahl from postfach_aktionen a join quellen q on q.id = a.quelle_id
     where a.ergebnis = 'fehler' and a.zeit > ${new Date(jetzt.getTime() - 86_400_000).toISOString()}::timestamptz
     group by q.id, q.name order by q.name`);
  return [
    ...[...alt].map(
      (q): Meldung => ({
        anlass: "postfach",
        zustand: `abruf:${q.id}`,
        betreff: `Belegt: Postfach „${q.name}“ nicht abgerufen`,
        zeilen: [
          q.letzter_erfolg
            ? `Das Postfach „${q.name}“ wurde seit ${zeit(q.letzter_erfolg)} nicht erfolgreich abgerufen.`
            : `Das Postfach „${q.name}“ wurde noch nie erfolgreich abgerufen.`,
          ...(q.letzter_fehler ? [`Letzter Fehler: ${q.letzter_fehler.slice(0, 300)}`] : []),
        ],
        pfad: "/quellen",
      }),
    ),
    ...[...aktionen].map(
      (q): Meldung => ({
        anlass: "postfach",
        zustand: `aktion:${q.id}`,
        betreff: `Belegt: Aktion im Postfach „${q.name}“ fehlgeschlagen`,
        zeilen: [`Im Postfach „${q.name}“ sind in den letzten 24 Stunden ${q.anzahl} Aktionen fehlgeschlagen.`],
        pfad: "/quellen",
      }),
    ),
  ];
}

async function kette(db: Datenbank, lage: Lage): Promise<Meldung[]> {
  if (!lage.kettePruefen) return [];
  const befunde = await pruefen(db);
  if (!befunde.length) return [];
  const arten = [...new Set(befunde.map((b) => `${b.art} in ${b.tabelle}`))].slice(0, 5);
  return [
    {
      anlass: "kette",
      zustand: `befunde:${kurz(JSON.stringify(befunde.map((b) => [b.art, b.tabelle, b.zeile, b.seq])))}`,
      betreff: "Belegt: Prüfung der Kette mit Befund",
      zeilen: [
        `Die tägliche Prüfung von Hash-Kette, Kopf und Siegeln meldet ${befunde.length} Befund${befunde.length > 1 ? "e" : ""}.`,
        `Betroffen: ${arten.join(", ")}.`,
      ],
      pfad: "/pruefung",
    },
  ];
}

/** Offene Löschanträge an jede Person, die sie als zweite bestätigen darf (Inhaber und Steuerberatung, nie der Antragsteller) */
async function loeschung(db: Datenbank): Promise<Meldung[]> {
  const offen = await db.execute<{ id: string; beantragt_von: string; asn: number }>(sql`
    select l.id, l.beantragt_von, a.nummer as asn from loeschungen l
      join archivnummern a on a.dokument_id = l.dokument_id
     where l.bestaetigt_am is null order by a.nummer`);
  if (!offen.length) return [];
  const personen = await db.execute<{ email: string }>(sql`
    select email from "user" where role in ('inhaber', 'steuerberatung') and entzogen_am is null order by email`);
  return [...personen].flatMap((p): Meldung[] => {
    const fuer = [...offen].filter((o) => o.beantragt_von !== `nutzer:${p.email}`);
    if (!fuer.length) return [];
    const asns = fuer.slice(0, 20).map((o) => Number(o.asn));
    return [
      {
        anlass: "loeschung",
        zustand: `${p.email}:${kurz(fuer.map((o) => o.id).join(","))}`,
        betreff: `Belegt: ${fuer.length} Löschantrag${fuer.length > 1 ? "e warten" : " wartet"} auf dich`,
        zeilen: [
          `${fuer.length} Löschantrag${fuer.length > 1 ? "e warten" : " wartet"} auf die Bestätigung durch eine zweite Person: ${asnListe(asns, fuer.length)}.`,
        ],
        pfad: "/fristen",
        empfaenger: [p.email],
      },
    ];
  });
}

/** Wöchentlich: Fristen, die in den nächsten 30 Tagen enden; Zustand ist die Kalenderwoche */
async function fristen(db: Datenbank, { heute }: Lage): Promise<Meldung[]> {
  const zeilen = await db.execute<{ asn: number; gesamt: string }>(sql`
    with f as (
      select a.nummer as asn from dokumente d
        join archivnummern a on a.dokument_id = d.id
        join lateral (select x.frist_bis from einordnungen x where x.dokument_id = d.id
                       order by x.erstellt_am desc, x.id desc limit 1) e on true
       where not ${geloescht} and e.frist_bis between ${heute}::date and ${heute}::date + 30
    ) select asn, count(*) over () as gesamt from f order by asn limit 20`);
  const gesamt = Number(zeilen[0]?.gesamt ?? 0);
  if (!gesamt) return [];
  const woche = await db.execute<{ woche: string }>(sql`select to_char(${heute}::date, 'IYYY-IW') as woche`);
  return [
    {
      anlass: "fristen",
      zustand: `woche:${woche[0]!.woche}`,
      betreff: `Belegt: ${gesamt} Frist${gesamt > 1 ? "en enden" : " endet"} in den nächsten 30 Tagen`,
      zeilen: [
        `In den nächsten 30 Tagen ${gesamt > 1 ? "enden die Fristen" : "endet die Frist"} von ${gesamt} Dokument${gesamt > 1 ? "en" : ""}: ${asnListe(
          zeilen.map((z) => Number(z.asn)),
          gesamt,
        )}.`,
        "Danach lassen sie sich löschen; gelöscht wird nur auf Antrag.",
      ],
      pfad: "/fristen",
      abstandStunden: 24 * 7,
    },
  ];
}

async function eingang(db: Datenbank, { anzahl }: Anlaesse["eingang"]): Promise<Meldung[]> {
  const [z] = await db.execute<{ offen: string }>(sql`
    select count(*) as offen from dokumente d
     where not exists (select 1 from einordnungen e where e.dokument_id = d.id) and not ${geloescht}`);
  const offen = Number(z?.offen ?? 0);
  if (offen <= anzahl) return [];
  return [
    {
      anlass: "eingang",
      zustand: `ueber:${anzahl}`,
      betreff: `Belegt: ${offen} Dokumente im Eingang`,
      zeilen: [`Im Eingang warten ${offen} Dokumente auf ihre Einordnung, mehr als ${anzahl}.`],
      pfad: "/eingang",
    },
  ];
}

/**
 * Fehlgeschlagene Workflows der letzten 24 Stunden, höchstens eine Mail am Tag; dazu Weitergaben (Aktion „Original an
 * Adresse senden“), bei denen Belegt aufgegeben hat
 */
async function workflow(db: Datenbank, { jetzt, heute }: Lage): Promise<Meldung[]> {
  const seit = new Date(jetzt.getTime() - 86_400_000).toISOString();
  const zeilen = await db.execute<{ name: string; anzahl: string }>(sql`
    select name, count(*) as anzahl from (
      select workflow_name as name from workflow_laeufe where ergebnis = 'fehler' and zeitpunkt > ${seit}::timestamptz
      union all
      select workflow_name from weitergaben where stand = 'fehlgeschlagen' and letzter_versuch > ${seit}::timestamptz
    ) f group by name order by name`);
  if (!zeilen.length) return [];
  const gesamt = [...zeilen].reduce((s, z) => s + Number(z.anzahl), 0);
  return [
    {
      anlass: "workflow",
      zustand: `tag:${heute}`,
      betreff: `Belegt: ${gesamt} Workflow-${gesamt > 1 ? "Läufe" : "Lauf"} fehlgeschlagen`,
      zeilen: [
        `In den letzten 24 Stunden ${gesamt > 1 ? "sind" : "ist"} ${gesamt} ${gesamt > 1 ? "Läufe" : "Lauf"} fehlgeschlagen:`,
        ...[...zeilen].map((z) => `- „${z.name}“: ${z.anzahl}`),
      ],
      pfad: "/workflows",
    },
  ];
}

/** Alle Meldungen der eingeschalteten Anlässe */
export async function meldungenSammeln(db: Datenbank, anlaesse: Anlaesse, lage: Lage): Promise<Meldung[]> {
  const teile = await Promise.all([
    anlaesse.backup.an ? backup(db, anlaesse.backup, lage) : [],
    anlaesse.postfach.an ? postfach(db, anlaesse.postfach, lage) : [],
    anlaesse.kette.an ? kette(db, lage) : [],
    anlaesse.loeschung.an ? loeschung(db) : [],
    anlaesse.fristen.an ? fristen(db, lage) : [],
    anlaesse.eingang.an ? eingang(db, anlaesse.eingang) : [],
    anlaesse.workflow.an ? workflow(db, lage) : [],
  ]);
  return teile.flat();
}
