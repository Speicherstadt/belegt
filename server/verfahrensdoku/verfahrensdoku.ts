import { sql } from "drizzle-orm";
import { type Aufbewahrungsart, gesetzlicheJahre } from "../../shared/fristen.ts";
import type { Datenbank } from "../db/client.ts";
import { pruefen } from "../dokumente/dokumente.ts";
import { sperrenListen } from "../einordnung/einordnung.ts";
import { laden as einstellungenLaden } from "../einstellungen/einstellungen.ts";
import { geteiltZahlen } from "../freigabe/teilen.ts";
import { listen as quellenListen } from "../mail/abruf.ts";
import { listen as regelnListen } from "../mail/regeln.ts";
import { listen as zeitstempelListen } from "../zeitstempel/zeitstempel.ts";
import { listen as zugaengeListen } from "../zugang/einladungen.ts";
import { listen as tokensListen } from "../zugang/tokens.ts";

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
  {
    abrufMinuten,
    version,
    jetzt = new Date(),
    objektsperre = false,
    kiModell,
    eingangsordner = false,
    trennblattCode = "BELEGT-TRENNER",
  }: {
    abrufMinuten: number;
    version: string;
    jetzt?: Date;
    objektsperre?: boolean;
    kiModell?: { modell: string; host: string };
    /** Der Worker überwacht einen Eingangsordner (EINGANG_ORDNER) */
    eingangsordner?: boolean;
    /** Inhalt des Codes auf Trennblättern (TRENNBLATT_CODE) */
    trennblattCode?: string;
  },
): Promise<Verfahrensdoku> {
  const [e, zugaenge, tokens, quellen, regeln, sperren, z, befunde, stempel, geteilt] = await Promise.all([
    einstellungenLaden(db),
    zugaengeListen(db),
    tokensListen(db),
    quellenListen(db),
    regelnListen(db),
    sperrenListen(db),
    zahlen(db),
    pruefen(db),
    zeitstempelListen(db),
    geteiltZahlen(db),
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
        "Jede Datei wird unverändert übernommen. Belegt berechnet beim Eingang den SHA-256 und speichert die Datei unter diesem Wert; den Dateityp erkennt es am Inhalt. Jedes Dokument bekommt dabei eine fortlaufende Archivnummer, die die Datenbank vergibt und versiegelt. Eine zweite Aufnahme derselben Datei legt ein weiteres Dokument an, schreibt die Datei aber nicht neu.",
        "E-Mails werden als Original (.eml) archiviert, jeder Anhang zusätzlich als eigenes Dokument mit Verweis auf seine Mail. Eine Mail, deren Inhalt schon archiviert ist, wird nicht doppelt aufgenommen.",
        quellen.length
          ? `Postfächer werden alle ${abrufMinuten} Minuten nur lesend abgerufen (IMAP); Belegt löscht und verschiebt dort nichts. Die Zugangsdaten liegen verschlüsselt (AES-256-GCM).`
          : "Es ist kein Postfach für den automatischen Abruf eingerichtet.",
        eingangsordner
          ? "Ein Eingangsordner (etwa das Ziel eines Scanners) wird alle 5 Sekunden überwacht. Belegt nimmt eine Datei erst auf, wenn sie sich zwischen zwei Blicken nicht mehr ändert, und entfernt sie aus dem Ordner erst, nachdem sie im Archiv liegt. Dateien, die sich nicht aufnehmen lassen (leer, größer als 100 MB), verschiebt es in den Unterordner „fehler“; dort bleiben sie zur Klärung liegen."
          : "",
        `Gescannte Stapel als PDF teilt Belegt an Trennblättern (QR-Code oder Code 128 mit dem Inhalt „${trennblattCode}“)${eingangsordner ? " aus dem Eingangsordner immer und" : ""} beim Hochladen auf Wunsch in einzelne Dokumente. Der Stapel ist dabei nur das Transportmittel: Jedes Teil wird als eigenes Original aufgenommen, die Trennblätter und der Stapel selbst nicht. Lässt sich ein Stapel nicht teilen, wird er unverändert aufgenommen.`,
        "Seiten eines archivierten PDFs lassen sich drehen, entfernen oder teilen, mehrere PDFs zu einem zusammenfügen. Das Original bleibt dabei unverändert; das Ergebnis ist ein neues Dokument mit eigener Archivnummer und der Quelle „abgeleitet“, das wie jedes andere eingeordnet wird. Woraus es entstand, mit welcher Operation und welchen Seiten, durch wen und wann, hält eine versiegelte Verknüpfung fest; sie steht im Protokoll und auf der Seite beider Dokumente.",
      ].filter(Boolean),
      liste: [
        ...quellen.map(
          (q) =>
            `Postfach „${q.name}“: ${q.benutzer} auf ${q.host}, Ordner ${q.ordner}${q.aktiv ? "" : " (deaktiviert)"}`,
        ),
        ...regeln.map(
          (r) =>
            `Regel „${r.name}“ schlägt vor: ${r.art ? (ART[r.art as Aufbewahrungsart] ?? r.art) : "nur Tags, Dokumenttyp oder Feldwerte"}${r.aktiv ? "" : " (deaktiviert)"}`,
        ),
      ],
    },
    {
      titel: "3. Einordnung und Aufbewahrung",
      absaetze: [
        `${kiModell ? `Ein Sprachmodell (${kiModell.modell} auf ${kiModell.host}) schlägt für Dokumente im Eingang eine Einordnung vor; es bekommt dafür Dateiname, Mailkopf und Text des Dokuments. ` : ""}Jedes Dokument wird von einer berechtigten Person eingeordnet; Regeln${kiModell ? " und das Sprachmodell" : ""} machen nur Vorschläge. Aus Art und Tag der Entstehung rechnet Belegt die Frist nach § 147 Abs. 3 und 4 AO: Sie beginnt mit dem Schluss des Kalenderjahres. Eine spätere Einordnung ersetzt die frühere nicht, beide bleiben erhalten; es gilt die neueste.`,
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
        "Die Unveränderbarkeit liegt in der Datenbank (PostgreSQL), nicht nur in der Anwendung: Dokumente, Archivnummern, Einordnungen, Mails und Löschnachweise sind ab dem Einfügen versiegelt, Ändern, Löschen und Leeren der Tabellen lehnt die Datenbank ab.",
        "Jede Änderung an protokollierten Tabellen schreibt die Datenbank in ein Protokoll, das nur anwächst. Jeder Eintrag enthält den SHA-256 seines Vorgängers (Hash-Kette); Akteur und Zeitpunkt stehen in jedem Eintrag.",
        objektsperre
          ? "Die Dateien liegen in einem S3-Bucket mit Object Lock im Modus COMPLIANCE: Bis zum Ende der längsten Frist ihrer Dokumente kann sie niemand ändern oder löschen, auch nicht mit dem Schlüssel des Kontos."
          : "Die Dateien liegen unter ihrem SHA-256 im Dateisystem des Servers; eine Änderung fällt beim Lesen und bei der Prüfung auf.",
        "Die Prüfung unter „Prüfung“ rechnet Kette, Kopf und Siegel nach und vergleicht auf Wunsch jede Datei mit ihrem Hash.",
        stempel[0]
          ? `Einmal am Tag lässt Belegt den Kopf der Kette von einem Zeitstempeldienst nach RFC 3161 bestätigen (${stempel[0].dienst}); der letzte Zeitstempel vom ${tag(stempel[0].zeit)} belegt den Stand bis Eintrag ${stempel[0].seq}.`
          : "",
        befunde.length
          ? `Bei Erstellung dieses Dokuments meldete die Prüfung ${befunde.length} Befunde.`
          : "Bei Erstellung dieses Dokuments meldete die Prüfung von Kette und Siegeln keine Befunde.",
      ].filter(Boolean),
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
        "Zugänge entstehen nur über Einladung durch den Inhaber. Von den Personen schreibt nur der Inhaber; die Steuerberatung liest und kann Löschungen als zweite Person bestätigen; Prüfer lesen nur Dokumente ihres Zeitraums (Z1) und können sie als Datenträger nach dem Beschreibungsstandard exportieren (Z3).",
        "Programme greifen mit einem API-Token zu, das der Inhaber anlegt und widerrufen kann. Ein Token liest Dokumente, mit dem Recht zu schreiben nimmt es zusätzlich Dokumente auf und ordnet sie ein; löschen, bestätigen und Einstellungen ändern kann es nicht. Im Protokoll steht das Token als Akteur.",
        geteilt.jemals
          ? `Der Inhaber kann das Original eines einzelnen Dokuments per Link an Personen ohne Zugang geben, für 1, 7 oder höchstens 30 Tage (die Datenbank lässt keine längere Frist zu). Über den Link lässt sich nur diese Datei herunterladen, nichts ändern; nach Ablauf, Widerruf oder Löschung des Dokuments gilt er nicht mehr. Gespeichert ist nur ein Hash des Links. Anlegen, Widerruf und jeder Abruf stehen mit Zeitpunkt im Protokoll, ohne IP-Adresse oder andere Angaben zur abrufenden Person. Bisher wurden ${geteilt.jemals} Links angelegt, ${geteilt.aktiv} gelten derzeit.`
          : "",
      ].filter(Boolean),
      liste: [
        ...zugaenge.zugaenge.map(
          (u) =>
            `${u.email}: ${ROLLE[u.rolle] ?? u.rolle}${u.zeitraumVon && u.zeitraumBis ? `, Zeitraum ${u.zeitraumVon} bis ${u.zeitraumBis}` : ""}, seit ${tag(new Date(u.erstelltAm))}`,
        ),
        ...tokens
          .filter((t) => !t.widerrufenAm)
          .map(
            (t) =>
              `API-Token „${t.name}“: ${t.recht === "schreiben" ? "liest, nimmt auf und ordnet ein" : "liest"}, seit ${tag(new Date(t.erstelltAm))}`,
          ),
      ],
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
