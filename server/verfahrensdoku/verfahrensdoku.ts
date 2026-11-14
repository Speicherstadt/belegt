import { sql } from "drizzle-orm";
import { type Aufbewahrungsart, gesetzlicheJahre } from "../../shared/fristen.ts";
import type { Datenbank } from "../db/client.ts";
import { pruefen } from "../dokumente/dokumente.ts";
import { sperrenListen } from "../einordnung/einordnung.ts";
import { laden as einstellungenLaden } from "../einstellungen/einstellungen.ts";
import { listen as quellenListen } from "../mail/abruf.ts";
import { listen as regelnListen } from "../mail/regeln.ts";
import { listen as zugaengeListen } from "../zugang/einladungen.ts";

/**
 * Verfahrensdokumentation (GoBD Rz. 151 ff.): allgemeine Beschreibung, Anwender-, System- und Betriebsdokumentation.
 * Was Belegt tut, steht hier aus dem Code und dem aktuellen Stand der Datenbank; was nur der Betrieb wissen kann
 * (Firma, Verantwortliche, Datensicherung, Scannen), kommt aus den Einstellungen. Fehlt davon etwas, nennt das
 * Dokument die Lücke, statt sie zu füllen. Der Text ist Deutsch, weil er für die deutsche Finanzverwaltung ist.
 */

export interface Abschnitt {
  titel: string;
  absaetze: string[];
  liste?: string[];
  /** Angaben, die der Betrieb noch machen muss */
  luecken?: string[];
}

export interface Verfahrensdoku {
  stand: string;
  abschnitte: Abschnitt[];
  vollstaendig: boolean;
}

const ART: Record<Aufbewahrungsart, string> = {
  buecher: "Bücher, Aufzeichnungen, Inventare, Jahresabschlüsse (§ 147 Abs. 1 Nr. 1 AO)",
  zoll: "Unterlagen nach dem Zollkodex der Union (§ 147 Abs. 1 Nr. 4a AO)",
  beleg: "Buchungsbelege (§ 147 Abs. 1 Nr. 4 AO)",
  geschaeftsbrief: "Empfangene und abgesandte Handels- und Geschäftsbriefe (§ 147 Abs. 1 Nr. 2 und 3 AO)",
  sonstige: "Sonstige für die Besteuerung bedeutsame Unterlagen (§ 147 Abs. 1 Nr. 5 AO)",
  freiwillig: "Freiwillig aufbewahrt, mit selbst gewählter Frist",
  frei: "Frei abgelegt, ohne Frist",
};

const ROLLE: Record<string, string> = { inhaber: "Inhaber", steuerberatung: "Steuerberatung", pruefer: "Prüfer" };

const tag = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

async function zahlen(db: Datenbank) {
  const [z] = await db.execute<{ dokumente: string; geloescht: string; mails: string; seq: string | null }>(sql`
    select (select count(*) from dokumente) as dokumente,
           (select count(*) from loeschungen where bestaetigt_am is not null) as geloescht,
           (select count(*) from mails) as mails,
           (select seq from audit_chain where id = 1) as seq`);
  return {
    dokumente: Number(z?.dokumente ?? 0),
    geloescht: Number(z?.geloescht ?? 0),
    mails: Number(z?.mails ?? 0),
    seq: z?.seq ? Number(z.seq) : 0,
  };
}

export async function verfahrensdoku(
  db: Datenbank,
  { abrufMinuten, version, jetzt = new Date() }: { abrufMinuten: number; version: string; jetzt?: Date },
): Promise<Verfahrensdoku> {
  const [e, zugaenge, quellen, regeln, sperren, z, befunde] = await Promise.all([
    einstellungenLaden(db),
    zugaengeListen(db),
    quellenListen(db),
    regelnListen(db),
    sperrenListen(db),
    zahlen(db),
    pruefen(db),
  ]);
  const fehlt = (wert: string, was: string) => (wert ? [] : [was]);

  const abschnitte: Abschnitt[] = [
    {
      titel: "1. Allgemeine Beschreibung",
      absaetze: [
        `${e.firma || "Der Betrieb"} archiviert steuerlich relevante Unterlagen elektronisch mit Belegt ${version}, einem selbst betriebenen Dokumentenarchiv. Archiviert werden hochgeladene Dateien, E-Mails mit ihren Anhängen und abgerufene Postfächer.`,
        e.anschrift ? `Anschrift: ${e.anschrift}` : "",
        e.verantwortlich ? `Verantwortlich für das Archiv: ${e.verantwortlich}` : "",
        `Stand des Archivs: ${z.dokumente} Dokumente, davon ${z.mails} Mails und ${z.geloescht} nach Ablauf der Frist gelöscht; ${z.seq} Einträge im Protokoll.`,
      ].filter(Boolean),
      luecken: [
        ...fehlt(e.firma, "Name des Betriebs"),
        ...fehlt(e.anschrift, "Anschrift"),
        ...fehlt(e.verantwortlich, "verantwortliche Person"),
      ],
    },
    {
      titel: "2. Erfassung",
      absaetze: [
        "Jede Datei wird unverändert übernommen. Belegt berechnet beim Eingang den SHA-256 und speichert die Datei unter diesem Wert; den Dateityp erkennt es am Inhalt. Eine zweite Aufnahme derselben Datei legt ein weiteres Dokument an, schreibt die Datei aber nicht neu.",
        "E-Mails werden als Original (.eml) archiviert, jeder Anhang zusätzlich als eigenes Dokument mit Verweis auf seine Mail. Eine Mail, deren Inhalt schon archiviert ist, wird nicht doppelt aufgenommen.",
        quellen.length
          ? `Postfächer werden alle ${abrufMinuten} Minuten nur lesend abgerufen (IMAP); Belegt löscht und verschiebt dort nichts. Die Zugangsdaten liegen verschlüsselt (AES-256-GCM).`
          : "Es ist kein Postfach für den automatischen Abruf eingerichtet.",
      ],
      liste: [
        ...quellen.map(
          (q) =>
            `Postfach „${q.name}“: ${q.benutzer} auf ${q.host}, Ordner ${q.ordner}${q.aktiv ? "" : " (deaktiviert)"}`,
        ),
        ...regeln.map(
          (r) =>
            `Regel „${r.name}“ schlägt vor: ${ART[r.art as Aufbewahrungsart] ?? r.art}${r.aktiv ? "" : " (deaktiviert)"}`,
        ),
      ],
    },
    {
      titel: "3. Einordnung und Aufbewahrung",
      absaetze: [
        "Jedes Dokument wird von einer berechtigten Person eingeordnet; Regeln machen nur Vorschläge. Aus Art und Tag der Entstehung rechnet Belegt die Frist nach § 147 Abs. 3 und 4 AO: Sie beginnt mit dem Schluss des Kalenderjahres. Eine spätere Einordnung ersetzt die frühere nicht, beide bleiben erhalten; es gilt die neueste.",
        e.aufsicht
          ? "Der Betrieb ist Kredit- oder Wertpapierinstitut oder steht unter Versicherungsaufsicht; Buchungsbelege werden deshalb zehn Jahre aufbewahrt (Art. 97 § 19a Abs. 3 EGAO)."
          : "Buchungsbelege werden acht Jahre aufbewahrt (§ 147 Abs. 3 AO in der Fassung ab 2025, Art. 97 § 19a EGAO).",
        sperren.some((s) => !s.aufgehobenAm)
          ? "Aktive Sperren (etwa wegen einer Außenprüfung oder eines Rechtsstreits) verhindern das Löschen der Dokumente ihres Zeitraums, auch nach Ablauf der Frist (Ablaufhemmung, § 147 Abs. 3 Satz 5 AO)."
          : "Sperren wegen einer Außenprüfung oder eines Rechtsstreits verhindern das Löschen der Dokumente ihres Zeitraums; derzeit ist keine aktiv.",
      ],
      liste: [
        ...(Object.keys(ART) as Aufbewahrungsart[]).map((a) => {
          const jahre = a === "beleg" ? gesetzlicheJahre(a, { aufsicht: e.aufsicht }) : gesetzlicheJahre(a);
          return `${ART[a]}: ${jahre ? `${jahre} Jahre` : "keine gesetzliche Frist"}`;
        }),
        ...sperren.filter((s) => !s.aufgehobenAm).map((s) => `Sperre „${s.grund}“ für ${s.von} bis ${s.bis}`),
      ],
    },
    {
      titel: "4. Unveränderbarkeit und Nachvollziehbarkeit",
      absaetze: [
        "Die Unveränderbarkeit liegt in der Datenbank (PostgreSQL), nicht nur in der Anwendung: Dokumente, Einordnungen, Mails und Löschnachweise sind ab dem Einfügen versiegelt, Ändern, Löschen und Leeren der Tabellen lehnt die Datenbank ab.",
        "Jede Änderung an protokollierten Tabellen schreibt die Datenbank in ein Protokoll, das nur anwächst. Jeder Eintrag enthält den SHA-256 seines Vorgängers (Hash-Kette); Akteur und Zeitpunkt stehen in jedem Eintrag.",
        "Die Prüfung unter „Prüfung“ rechnet Kette, Kopf und Siegel nach und vergleicht auf Wunsch jede Datei mit ihrem Hash.",
        befunde.length
          ? `Bei Erstellung dieses Dokuments meldete die Prüfung ${befunde.length} Befunde.`
          : "Bei Erstellung dieses Dokuments meldete die Prüfung von Kette und Siegeln keine Befunde.",
      ],
    },
    {
      titel: "5. Löschung",
      absaetze: [
        "Gelöscht wird nur auf Antrag und nur, was eingeordnet ist, dessen Frist abgelaufen ist und das keine Sperre betrifft. Wegen möglicher Ablaufhemmung bestätigt eine zweite Person jede Löschung; nur frei Abgelegtes, das nie anders eingeordnet war, wird sofort gelöscht. Die Datenbank prüft diese Regeln selbst.",
        "Nach der Löschung bleibt der Nachweis: Hash, Einordnung, Antrag und Bestätigung mit Personen und Zeitpunkten. Nur die Datei wird entfernt.",
      ],
    },
    {
      titel: "6. Zugriff",
      absaetze: [
        "Zugänge entstehen nur über Einladung durch den Inhaber. Nur der Inhaber schreibt; die Steuerberatung liest und kann Löschungen als zweite Person bestätigen; Prüfer lesen nur Dokumente ihres Zeitraums (Z1) und können sie als Datenträger nach dem Beschreibungsstandard exportieren (Z3).",
      ],
      liste: zugaenge.zugaenge.map(
        (u) =>
          `${u.email}: ${ROLLE[u.rolle] ?? u.rolle}${u.zeitraumVon && u.zeitraumBis ? `, Zeitraum ${u.zeitraumVon} bis ${u.zeitraumBis}` : ""}, seit ${tag(new Date(u.erstelltAm))}`,
      ),
    },
    {
      titel: "7. Betrieb und Datensicherung",
      absaetze: [
        "Belegt läuft als Server mit PostgreSQL-Datenbank und einem Verzeichnis für die Dateien; der Abruf der Postfächer läuft in einem eigenen Prozess.",
        e.datensicherung,
      ].filter(Boolean),
      luecken: fehlt(
        e.datensicherung,
        "Beschreibung der Datensicherung (wie, wohin, wie oft, wer die Wiederherstellung prüft)",
      ),
    },
    {
      titel: "8. Scannen von Papierbelegen",
      absaetze: e.scannen
        ? [e.scannen]
        : ["Für gescannte Papierbelege beschreibt der Betrieb hier Ablauf, Kontrolle und den Umgang mit dem Papier."],
      luecken: fehlt(
        e.scannen,
        "Ablauf beim Scannen (wer scannt, wer prüft, was mit dem Papier geschieht) oder der Hinweis, dass nicht gescannt wird",
      ),
    },
    ...(e.ergaenzungen ? [{ titel: "9. Ergänzungen", absaetze: e.ergaenzungen.split(/\n{2,}/) }] : []),
  ];

  return {
    stand: tag(jetzt),
    abschnitte,
    vollstaendig: abschnitte.every((a) => !a.luecken?.length),
  };
}
