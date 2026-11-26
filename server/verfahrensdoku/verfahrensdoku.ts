import {
  abschnitt,
  angabenAbsaetze,
  fehlendeAngaben,
  tagInDeutschland as tag,
  type Verfahrensdoku,
  type VerfahrensdokuAbschnitt,
  verfahrensdoku as zusammensetzen,
} from "@firsttris/gobd-kern/verfahrensdoku";
import { sql } from "drizzle-orm";
import { type Aufbewahrungsart, gesetzlicheJahre } from "../../shared/fristen.ts";
import { anzahl } from "../../shared/zahl.ts";
import { zuordnungsregelnBeschreiben } from "../abgleich/vorschlaege.ts";
import { backupStand } from "../betrieb/backup.ts";
import type { Datenbank } from "../db/client.ts";
import { zugriffLesen } from "../db/rollen.ts";
import { pruefen } from "../dokumente/dokumente.ts";
import { sperrenListen } from "../einordnung/einordnung.ts";
import { laden as einstellungenLaden } from "../einstellungen/einstellungen.ts";
import { ZIP_MAX_BYTES, ZIP_MAX_DOKUMENTE } from "../export/auswahl.ts";
import { geteiltZahlen } from "../freigabe/teilen.ts";
import { klassifikatorStand } from "../lernen/lernen.ts";
import { listen as quellenListen } from "../mail/abruf.ts";
import { listen as regelnListen } from "../mail/regeln.ts";
import { laeufeFuerVerfahrensdoku } from "../paperless/laeufe.ts";
import { letztePruefung } from "../pruefung/kette.ts";
import { workflowsBeschreiben } from "../workflows/beschreibung.ts";
import { listen as zeitstempelListen } from "../zeitstempel/zeitstempel.ts";
import { listen as tokensListen } from "../zugang/tokens.ts";
import { rechteBeschreiben } from "./datenbank.ts";
import { benachrichtigungenBeschreiben } from "./meldungen.ts";
import { postfachAktion, postfachAktionenAbsatz } from "./postfach.ts";
import { sicherungBeschreiben } from "./sicherung.ts";
import { unveraenderbarkeit } from "./unveraenderbarkeit.ts";
import { anmeldungBeschreiben, zugaengeBeschreiben } from "./zugaenge.ts";

/**
 * Verfahrensdokumentation (GoBD Rz. 151 ff.): allgemeine Beschreibung, Anwender-, System- und Betriebsdokumentation.
 * Was Belegt tut, steht hier aus dem Code und dem aktuellen Stand der Datenbank; was nur der Betrieb wissen kann
 * (Angaben zum Betrieb), kommt aus den Einstellungen. Fehlt davon etwas, nennt das Dokument die Lücke, statt sie zu
 * füllen. Datenmodell, Angaben, Texte zum Kern (Abschnitt 4) und Markdown kommen aus @firsttris/gobd-kern. Der Text ist
 * Deutsch, weil er für die deutsche Finanzverwaltung ist.
 */

export type { Verfahrensdoku };

type Abschnitt = VerfahrensdokuAbschnitt;

const ART: Record<Aufbewahrungsart, string> = {
  buecher: "Bücher, Aufzeichnungen, Inventare, Jahresabschlüsse (§ 147 Abs. 1 Nr. 1 AO)",
  zoll: "Unterlagen nach dem Zollkodex der Union (§ 147 Abs. 1 Nr. 4a AO)",
  beleg: "Buchungsbelege (§ 147 Abs. 1 Nr. 4 AO)",
  geschaeftsbrief: "Empfangene und abgesandte Handels- und Geschäftsbriefe (§ 147 Abs. 1 Nr. 2 und 3 AO)",
  sonstige: "Sonstige für die Besteuerung bedeutsame Unterlagen (§ 147 Abs. 1 Nr. 5 AO)",
  freiwillig: "Freiwillig aufbewahrt, mit selbst gewählter Frist",
  frei: "Frei abgelegt, ohne Frist",
};

const STATUS: Record<string, string> = {
  laeuft: "läuft",
  fertig: "abgeschlossen",
  abgebrochen: "abgebrochen",
  fehler: "mit Fehler beendet",
  wartet: "wartet",
};

async function zahlen(db: Datenbank) {
  const [z] = await db.execute<{
    dokumente: string;
    geloescht: string;
    mails: string;
    seq: string | null;
    hash: string | null;
  }>(sql`
    select (select count(*) from dokumente) as dokumente,
           (select count(*) from loeschungen where bestaetigt_am is not null) as geloescht,
           (select count(*) from mails) as mails,
           k.seq, encode(k.hash, 'hex') as hash
      from (select 1) x left join audit_chain k on k.id = 1`);
  const seq = z?.seq ? Number(z.seq) : 0;
  return {
    dokumente: Number(z?.dokumente ?? 0),
    geloescht: Number(z?.geloescht ?? 0),
    mails: Number(z?.mails ?? 0),
    seq,
    pruefwert: seq && z?.hash ? { seq, hash: z.hash } : null,
  };
}

export interface VerfahrensdokuOptionen {
  abrufMinuten: number;
  version: string;
  jetzt?: Date;
  objektsperre?: boolean;
  /** Originale im S3-Bucket sind clientseitig verschlüsselt (S3_SCHLUESSEL) */
  s3Verschluesselt?: boolean;
  kiModell?: { modell: string; host: string };
  /** Der Worker überwacht einen Eingangsordner (EINGANG_ORDNER) */
  eingangsordner?: boolean;
  /** Inhalt des Codes auf Trennblättern (TRENNBLATT_CODE) */
  trennblattCode?: string;
  /** E-Rechnungen werden mit dem KoSIT-Validator geprüft (VALIDATOR_URL) */
  erechnungPruefung?: boolean;
  /** Benachrichtigungen per Mail sind eingerichtet (MAIL_SMTP_URL) */
  mail?: boolean;
}

const ABSCHNITT_LOESCHUNG = {
  titel: "5. Löschung",
  absaetze: [
    "Gelöscht wird nur auf Antrag und nur, was eingeordnet ist, dessen Frist abgelaufen ist und das keine Sperre betrifft. Wegen möglicher Ablaufhemmung bestätigt eine zweite Person jede Löschung; nur frei Abgelegtes, das nie anders eingeordnet war, wird sofort gelöscht. Die Datenbank prüft diese Regeln selbst.",
    "Nach der Löschung bleibt der Nachweis: Hash, Einordnung, Antrag und Bestätigung mit Personen und Zeitpunkten. Nur die Datei wird entfernt.",
  ],
};

export async function verfahrensdoku(
  db: Datenbank,
  {
    abrufMinuten,
    version,
    jetzt = new Date(),
    objektsperre = false,
    s3Verschluesselt = false,
    kiModell,
    eingangsordner = false,
    trennblattCode = "BELEGT-TRENNER",
    erechnungPruefung = false,
    mail = false,
  }: VerfahrensdokuOptionen,
): Promise<Verfahrensdoku> {
  const [
    e,
    zugaenge,
    tokens,
    quellen,
    regeln,
    sperren,
    z,
    befunde,
    stempel,
    geteilt,
    importe,
    workflows,
    zuordnung,
    lernstand,
    zugriff,
    sicherung,
    anmeldung,
    meldungen,
    letzterLauf,
  ] = await Promise.all([
    einstellungenLaden(db),
    zugaengeBeschreiben(db),
    tokensListen(db),
    quellenListen(db),
    regelnListen(db),
    sperrenListen(db),
    zahlen(db),
    pruefen(db),
    zeitstempelListen(db),
    geteiltZahlen(db),
    laeufeFuerVerfahrensdoku(db),
    workflowsBeschreiben(db),
    zuordnungsregelnBeschreiben(db),
    klassifikatorStand(db),
    zugriffLesen(db.$client),
    backupStand(db, jetzt),
    anmeldungBeschreiben(db),
    benachrichtigungenBeschreiben(db, mail),
    letztePruefung(db),
  ]);
  const rechte = rechteBeschreiben(zugriff);
  const allgemein = angabenAbsaetze(e, ["rechtsform", "anschrift", "verantwortlich", "aufbewahrungsort"]);
  const betrieb = angabenAbsaetze(e, ["serverbetrieb", "datensicherung", "schluesselablage"]);
  const papier = angabenAbsaetze(e, ["papierbelege"]);
  const ergaenzungen = angabenAbsaetze(e, ["ergaenzungen"]).absaetze;

  const abschnitte: Abschnitt[] = [
    abschnitt("1. Allgemeine Beschreibung", {
      absaetze: [
        `${e.firma || "Der Betrieb"} archiviert steuerlich relevante Unterlagen elektronisch mit Belegt ${version}, einem selbst betriebenen Dokumentenarchiv. Archiviert werden hochgeladene Dateien, E-Mails mit ihren Anhängen und abgerufene Postfächer.`,
        ...allgemein.absaetze,
        `Stand des Archivs: ${anzahl(z.dokumente, "Dokument", "Dokumente")}, davon ${anzahl(z.mails, "Mail", "Mails")} und ${z.geloescht} nach Ablauf der Frist gelöscht; ${anzahl(z.seq, "Eintrag", "Einträge")} im Protokoll.`,
      ],
      luecken: [...fehlendeAngaben(e, ["firma"]), ...allgemein.luecken],
    }),
    {
      titel: "2. Erfassung",
      absaetze: [
        "Jede Datei wird unverändert übernommen. Belegt berechnet beim Eingang den SHA-256 und speichert die Datei unter diesem Wert; den Dateityp erkennt es am Inhalt. Jedes Dokument bekommt dabei eine fortlaufende Archivnummer, die die Datenbank vergibt und versiegelt.",
        `Dieselbe Datei (gleicher SHA-256) nimmt Belegt nur einmal auf: Beim Hochladen und über die Schnittstelle legt es nichts an und nennt das vorhandene Dokument (einem Mitarbeiter, der es nicht sehen darf, nur dass es vorliegt)${eingangsordner ? "; aus dem Eingangsordner entfernt es die Datei und schreibt den Treffer mit Archivnummer ins Log des Workers" : ""}. Dokumente, deren Löschung bestätigt ist, zählen dabei nicht. Abgeleitete Dokumente und Importe können dieselbe Datei ein weiteres Mal enthalten; sie wird dann nicht neu geschrieben.`,
        "E-Mails werden als Original (.eml) archiviert, jeder Anhang zusätzlich als eigenes Dokument mit Verweis auf seine Mail. Liegt ein Anhang schon als Dokument im Archiv, verweist die Mail auf dieses Dokument, statt ein zweites anzulegen; der Verweis ist versiegelt wie ein Anhang. Eine Mail, deren Inhalt schon archiviert ist, wird nicht doppelt aufgenommen.",
        quellen.length
          ? `Postfächer werden ${abrufMinuten === 1 ? "jede Minute" : `alle ${abrufMinuten} Minuten`} abgerufen (IMAP oder JMAP). Die Zugangsdaten liegen verschlüsselt (AES-256-GCM).`
          : "Es ist kein Postfach für den automatischen Abruf eingerichtet.",
        quellen.length ? postfachAktionenAbsatz(quellen) : "",
        eingangsordner
          ? "Ein Eingangsordner (etwa das Ziel eines Scanners) wird alle 5 Sekunden überwacht. Belegt nimmt eine Datei erst auf, wenn sie sich zwischen zwei Blicken nicht mehr ändert, und entfernt sie aus dem Ordner erst, nachdem sie im Archiv liegt. Dateien, die sich nicht aufnehmen lassen (größer als 100 MB oder 10 Minuten lang leer), verschiebt es in den Unterordner „fehler“; dort bleiben sie zur Klärung liegen."
          : "",
        `Gescannte Stapel als PDF teilt Belegt an Trennblättern (QR-Code oder Code 128 mit dem Inhalt „${trennblattCode}“)${eingangsordner ? " aus dem Eingangsordner immer und" : ""} beim Hochladen auf Wunsch in einzelne Dokumente. Der Stapel ist dabei nur das Transportmittel: Jedes Teil wird als eigenes Original aufgenommen, die Trennblätter und der Stapel selbst nicht. Lässt sich ein Stapel nicht teilen, wird er unverändert aufgenommen.`,
        importe.length
          ? "Dokumente aus Paperless-ngx übernimmt Belegt über dessen REST-API (lesend, mit einem API-Token, das verschlüsselt gespeichert ist und nur an die eingetragene Adresse geht) oder aus einem Export (document_exporter). Übernommen wird immer das Original, nie die Archivversion. Vor der Aufnahme vergleicht Belegt die Prüfsumme aus Paperless-ngx (SHA-256, bei älteren Versionen MD5) mit dem geladenen Original; passt sie nicht, wird das Dokument nicht aufgenommen und der Fehler festgehalten. Ein Original, das schon im Archiv liegt, wird nur verknüpft. Das Ergebnis je Dokument (übernommen, verknüpft oder Fehler mit Grund, beide Prüfsummen) ist versiegelt. Übernommene Dokumente landen im Eingang; Titel, Korrespondent und Datum aus Paperless-ngx sind nur ein Vorschlag. Nur für Dokumenttypen oder Tags, die der Inhaber ausdrücklich einer Art zugeordnet hat, ordnet der Import gleich ein (Akteur „import:paperless“)."
          : "",
        "Seiten eines archivierten PDFs lassen sich drehen, entfernen oder teilen, mehrere PDFs zu einem zusammenfügen. Das Original bleibt dabei unverändert; das Ergebnis ist ein neues Dokument mit eigener Archivnummer und der Quelle „abgeleitet“, das wie jedes andere eingeordnet wird. Woraus es entstand, mit welcher Operation und welchen Seiten, durch wen und wann, hält eine versiegelte Verknüpfung fest; sie steht im Protokoll und auf der Seite beider Dokumente.",
        "Aus manchen Originalen erzeugt Belegt abgeleitete Fassungen zum Lesen: für Scans (Bilder und PDFs ohne Textebene) mit der Texterkennung ein durchsuchbares PDF (PDF/A-2b, das Bild mit dem erkannten Text unsichtbar darüber), für Office-Dateien eine Ansicht als PDF und für die Liste Vorschaubilder. Sie entstehen aus dem Original, ändern es nicht und sind als abgeleitet gekennzeichnet; maßgeblich bleibt das Original. Sie sind nicht versiegelt, lassen sich jederzeit neu erzeugen, gehören nicht in den Z3-Export und gehen mit der Löschung des Dokuments mit.",
        erechnungPruefung
          ? "E-Rechnungen (XRechnung, ZUGFeRD, Factur-X) prüft Belegt nach dem Eingang mit dem Validator der Koordinierungsstelle für IT-Standards (KoSIT) und dessen Konfiguration für XRechnung gegen XRechnung oder EN 16931; der Prüfdienst läuft auf dem eigenen Server ohne Internet. Das Ergebnis (gültig oder ungültig, Szenario, die ersten Fehler und Warnungen) steht auf der Seite des Dokuments. Es ist abgeleitet wie die Fassungen oben, ändert weder Original noch Einordnung und geht mit der Löschung des Dokuments mit."
          : "",
      ].filter(Boolean),
      liste: [
        ...quellen.map(
          (q) =>
            `Postfach „${q.name}“: ${q.benutzer} auf ${q.host}, Ordner ${q.ordner}${q.aktiv ? "" : " (deaktiviert)"}; nach dem Abholen: ${postfachAktion(q)}`,
        ),
        ...importe.map(
          (l) =>
            `Import aus Paperless-ngx (${l.art === "api" ? `API „${l.quelle ?? ""}“` : `Export ${l.dateiname ?? ""}`}) vom ${tag(new Date(l.begonnenAm ?? l.erstelltAm))}: ${l.uebernommen}${l.gesamt === null ? "" : ` von ${l.gesamt}`} übernommen, davon ${l.doppelt} schon im Archiv, ${l.fehler} nicht übernommen (Prüfsumme abgeglichen); Stand: ${STATUS[l.status]}`,
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
        `${kiModell ? `Ein Sprachmodell (${kiModell.modell} auf ${kiModell.host}) schlägt für Dokumente im Eingang eine Einordnung vor; es bekommt dafür Dateiname, Mailkopf und Text des Dokuments. ` : ""}Jedes Dokument wird von einer berechtigten Person eingeordnet; Regeln${kiModell ? " und das Sprachmodell" : ""} machen nur Vorschläge.${workflows.ordnenEin ? " Ausnahme: Workflows, bei denen der Inhaber das Einordnen ausdrücklich gewählt hat, ordnen Dokumente im Eingang ohne weitere Bestätigung ein; das Protokoll nennt sie als Akteur „workflow:<Name>“." : ""} Aus Art und Tag der Entstehung rechnet Belegt die Frist nach § 147 Abs. 3 und 4 AO: Sie beginnt mit dem Schluss des Kalenderjahres. Eine spätere Einordnung ersetzt die frühere nicht, beide bleiben erhalten; es gilt die neueste.`,
        `Korrespondenten führt Belegt als Liste. Die Einordnung hält den Namen fest, den der Korrespondent beim Einordnen hatte, und ist versiegelt; umbenennen und zusammenführen ändern nur die Liste und die Zuordnung zum Dokument, jede Änderung steht im Protokoll. Zuordnungsregeln an Korrespondenten, Dokumenttypen und Tags (irgendein Wort, alle Wörter, genau, regulärer Ausdruck mit Zeitlimit, unscharf) prüft Belegt einmal gegen Dateiname, Mailkopf und gelesenen Text eines neuen Dokuments; das Ergebnis ist nur ein Vorschlag. Daneben lernt Belegt ohne fremden Dienst aus den eigenen eingeordneten Dokumenten (naiver Bayes-Klassifikator über deren Wörter) und schlägt Korrespondent, Dokumenttyp, Tags und Art vor, wenn es sich sicher genug ist; jeder Vorschlag nennt, aus wie vielen Dokumenten er gelernt ist. Das gelernte Modell ist abgeleitet, wird mit jeder bestätigten Löschung verworfen und ohne das gelöschte Dokument neu gelernt.${lernstand ? ` Zuletzt gelernt am ${tag(lernstand.am)} aus ${anzahl(lernstand.beispiele, "Dokument", "Dokumenten")}.` : ""}`,
        e.aufsicht
          ? "Der Betrieb ist Kredit- oder Wertpapierinstitut oder steht unter Versicherungsaufsicht; Buchungsbelege werden deshalb zehn Jahre aufbewahrt (Art. 97 § 19a Abs. 3 EGAO)."
          : "Buchungsbelege werden acht Jahre aufbewahrt (§ 147 Abs. 3 AO in der Fassung ab 2025, Art. 97 § 19a EGAO).",
        sperren.some((s) => !s.aufgehobenAm)
          ? "Aktive Sperren (etwa wegen einer Außenprüfung oder eines Rechtsstreits) verhindern das Löschen der Dokumente ihres Zeitraums, auch nach Ablauf der Frist (Ablaufhemmung, § 147 Abs. 3 Satz 5 AO)."
          : "Sperren wegen einer Außenprüfung oder eines Rechtsstreits verhindern das Löschen der Dokumente ihres Zeitraums; derzeit ist keine aktiv.",
        workflows.texte.length
          ? "Workflows führen nach dem Eingang oder der Einordnung eines Dokuments festgelegte Aktionen aus, wenn ihre Bedingungen zutreffen: Tags, Korrespondent, Dokumenttyp und Feldwerte setzen, eine Notiz anlegen, ein Webhook-Ereignis auslösen, das Original an eine Adresse senden und, nur wenn der Inhaber es ausdrücklich gewählt hat, einordnen. Nur der Inhaber legt sie an. Jeder Workflow bearbeitet jedes Dokument genau einmal, gelöschte nie; das Ergebnis jedes Laufs (ausgeführt mit den Aktionen, trifft nicht, angehalten oder Fehler) hält eine Tabelle fest, die nur anwächst, und jede Änderung steht mit dem Akteur „workflow:<Name>“ im Protokoll. Die aktiven Workflows stehen in der Liste unten, in der Reihenfolge ihrer Ausführung. Das Senden des Originals (etwa an eine Buchhaltung) geschieht im Hintergrund an die Adresse, die der Inhaber im Workflow festgelegt hat, ohne Weiterleitungen zu folgen; die Anmeldung dafür liegt verschlüsselt. Je Dokument und Aktion geht das Original höchstens einmal erfolgreich hinaus; Zeitpunkt, HTTP-Status und Fehler jedes Versuchs stehen am Dokument und im Protokoll. Das Original im Archiv bleibt dabei unverändert."
          : "",
      ].filter(Boolean),
      liste: [
        ...(Object.keys(ART) as Aufbewahrungsart[]).map((a) => {
          const jahre = a === "beleg" ? gesetzlicheJahre(a, { aufsicht: e.aufsicht }) : gesetzlicheJahre(a);
          return `${ART[a]}: ${jahre ? `${jahre} Jahre` : "keine gesetzliche Frist"}`;
        }),
        ...sperren.filter((s) => !s.aufgehobenAm).map((s) => `Sperre „${s.grund}“ für ${s.von} bis ${s.bis}`),
        ...zuordnung,
        ...workflows.texte,
      ],
    },
    unveraenderbarkeit({
      rechte,
      pruefwert: z.pruefwert,
      objektsperre,
      s3Verschluesselt,
      stempel: stempel[0],
      befunde: befunde.length,
      letzterLauf,
    }),
    ABSCHNITT_LOESCHUNG,
    {
      titel: "6. Zugriff",
      absaetze: [
        "Zugänge entstehen nur über Einladung durch den Inhaber. Von den Personen schreibt nur der Inhaber; die Steuerberatung liest, kann Löschungen als zweite Person bestätigen und Notizen zu Dokumenten schreiben, die sich nicht ändern lassen und mit der Löschung des Dokuments entfernt werden; Prüfer lesen nur Dokumente ihres Zeitraums (Z1) und können sie als Datenträger nach dem Beschreibungsstandard exportieren (Z3).",
        "Mitarbeiter sehen nur die Dokumente ihres Sichtbereichs (Tags, Dokumenttypen, Korrespondenten, die der Inhaber festlegt). Mit dem Recht zu bearbeiten nehmen sie Dokumente auf, ordnen sie ein, setzen Tags, Typ, Korrespondent und Felder und schreiben Notizen, aber nur, solange das Dokument danach in ihrem Sichtbereich bleibt. Löschen, bestätigen, sperren, exportieren, teilen und Einstellungen, Zugänge, Tokens, Regeln, Workflows und Quellen ändern können sie nicht. Jede Änderung eines Sichtbereichs und jeder Entzug eines Zugangs stehen mit Akteur im Protokoll.",
        anmeldung,
        `Wer Dokumente sieht, kann ihre Originale als ZIP herunterladen, höchstens ${ZIP_MAX_DOKUMENTE} Dokumente und ${ZIP_MAX_BYTES / 1024 ** 3} GB auf einmal; das ZIP enthält nur Dokumente aus Zeitraum oder Sichtbereich des Zugangs. Die Dateien sind unverändert und vor der Ausgabe gegen ihren Hash geprüft; gelöschte Dokumente und Originale, die fehlen oder nicht zu ihrem Hash passen, nennt die Datei „nicht-enthalten.txt“ im ZIP. Wie das Herunterladen eines einzelnen Originals steht der ZIP-Download nicht im Protokoll.`,
        "Programme greifen mit einem API-Token zu, das der Inhaber anlegt und widerrufen kann. Ein Token liest Dokumente, mit dem Recht zu schreiben nimmt es zusätzlich Dokumente auf und ordnet sie ein; löschen, bestätigen und Einstellungen ändern kann es nicht. Im Protokoll steht das Token als Akteur.",
        geteilt.jemals
          ? `Der Inhaber kann das Original eines einzelnen Dokuments per Link an Personen ohne Zugang geben, für 1, 7 oder höchstens 30 Tage (die Datenbank lässt keine längere Frist zu). Über den Link lässt sich nur diese Datei herunterladen, nichts ändern; nach Ablauf, Widerruf oder Löschung des Dokuments gilt er nicht mehr. Gespeichert ist nur ein Hash des Links. Anlegen, Widerruf und jeder Abruf stehen mit Zeitpunkt im Protokoll, ohne IP-Adresse oder andere Angaben zur abrufenden Person. Bisher ${geteilt.jemals === 1 ? "wurde 1 Link" : `wurden ${geteilt.jemals} Links`} angelegt, ${geteilt.aktiv} ${geteilt.aktiv === 1 ? "gilt" : "gelten"} derzeit.`
          : "",
      ].filter(Boolean),
      liste: [
        ...zugaenge,
        ...tokens
          .filter((t) => !t.widerrufenAm)
          .map(
            (t) =>
              `API-Token „${t.name}“: ${t.recht === "schreiben" ? "liest, nimmt auf und ordnet ein" : "liest"}, seit ${tag(new Date(t.erstelltAm))}`,
          ),
      ],
    },
    abschnitt("7. Betrieb und Datensicherung", {
      absaetze: [
        "Belegt läuft als Server mit PostgreSQL-Datenbank und einem Verzeichnis für die Dateien; der Abruf der Postfächer läuft in einem eigenen Prozess.",
        ...betrieb.absaetze,
        ...sicherungBeschreiben(sicherung),
        meldungen,
      ],
      luecken: betrieb.luecken,
    }),
    abschnitt("8. Papierbelege und Scannen", papier),
    ...(ergaenzungen.length ? [abschnitt("9. Ergänzungen", { absaetze: ergaenzungen })] : []),
  ];

  return zusammensetzen({
    titel: e.firma ? `Verfahrensdokumentation ${e.firma}` : "Verfahrensdokumentation",
    stand: { datum: tag(jetzt), programm: "Belegt", version },
    abschnitte,
  });
}
