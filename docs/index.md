---
title: "Dokumentenarchiv mit GoBD-Modus, selbst gehostet"
description: >-
  Belegt archiviert Mails, E-Rechnungen, Scans und beliebige Dokumente auf deinem Server: unveränderbar bis Fristende,
  durchsuchbar, mit Prüferzugang und Datenträger für die Betriebsprüfung. Ein Rundgang in Bildern.
image: social-preview.png
hide:
  - navigation
  - toc
---

<!-- Die Seite zum Weitergeben: was Belegt kann, in Bildern. Details stehen auf den verlinkten Seiten und in
     ueberblick.md; die Bilder entstehen mit bun run docs:screenshots (entwicklung.md). -->

<div class="showcase-hero" markdown>

<p class="showcase-kicker">Open-Source-Dokumentenarchiv, selbst gehostet</p>

# Belegt ist, was du beweisen kannst.

<p class="showcase-claim">Mails, E-Rechnungen, Scans und beliebige Dokumente an einem Ort, durchsuchbar, auf deinem
Server. Was aufbewahrt werden muss, bleibt im GoBD-Modus bis zum Ende der Frist unverändert, und danach löschst du es
nachweisbar.</p>

[Rundgang starten](#rundgang){ .md-button .md-button--primary } [Installieren](betrieb.md){ .md-button } [Alle Funktionen im Detail](ueberblick.md){ .md-button }

<p class="showcase-hinweis">Belegt ist noch in der Beta: vor jedem Update <a href="betrieb.html#sichern">sichern</a>.</p>

</div>

<div class="showcase-shot showcase-shot--hero" markdown>
![Startseite von Belegt: Eingang, Archiv, offener Löschantrag, Sperre und Speicher, Fristen, Quellen, Zustand der Hash-Kette und eine gespeicherte Ansicht](assets/screenshot-start.png#only-light){ width="1504" height="1192" }
![Startseite von Belegt: Eingang, Archiv, offener Löschantrag, Sperre und Speicher, Fristen, Quellen, Zustand der Hash-Kette und eine gespeicherte Ansicht](assets/screenshot-start-dunkel.png#only-dark){ width="1504" height="1192" }
</div>

<div class="showcase-feature" id="rundgang" markdown>
<div markdown>
<span class="showcase-kicker">Archiv und Suche</span>

## Ein Suchfeld für alles

Dateiname, Einordnung, Mail und der Text im Dokument: aus PDFs, Word, Excel und OpenDocument, aus Scans per
Texterkennung. Filter nach Tags, Korrespondent, Dokumenttyp und eigenen Feldern, jede Ansicht als Link speicherbar,
jedes Dokument mit fortlaufender Archivnummer.

[Eingang, Mails und Suche](eingang.md) · [Filter und Suche](ordnung.md#filter-und-suche)
</div>
<div class="showcase-shot" markdown>
![Archiv mit der Suche nach „Rechnung“: Mail, XRechnung, Rechnung des Holzhandels und Stromrechnung mit Korrespondent, Typ, Tags und Frist](assets/screenshot-suche.png#only-light){ width="1504" height="972" loading="lazy" }
![Archiv mit der Suche nach „Rechnung“: Mail, XRechnung, Rechnung des Holzhandels und Stromrechnung mit Korrespondent, Typ, Tags und Frist](assets/screenshot-suche-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature showcase-feature--flip" markdown>
<div markdown>
<span class="showcase-kicker">Eingang</span>

## Das Dokument kommt, wie es gerade da ist

Postfächer per IMAP, JMAP, Microsoft 365 oder Google, das Journal deines Mailservers, Outlook-Dateien. Der Scanner
legt per FTP in den Eingangsordner, das Handy fotografiert oder teilt direkt an Belegt. Alles ist sofort unverändert
gesichert; im Eingang legst du fest, was es ist.

[Postfächer](eingang.md#postfächer) · [Scannen](scannen.md) · [Unterwegs mit dem Handy](eingang.md#unterwegs-mit-dem-handy)
</div>
<div class="showcase-phone" markdown>
![Eingang am Handy mit Hochladen und Foto aufnehmen, darunter Mail, Scans und XRechnung als Kacheln](assets/screenshot-mobil.png#only-light){ width="454" height="916" loading="lazy" }
![Eingang am Handy mit Hochladen und Foto aufnehmen, darunter Mail, Scans und XRechnung als Kacheln](assets/screenshot-mobil-dunkel.png#only-dark){ width="454" height="916" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>
<span class="showcase-kicker">Dokument und E-Rechnung</span>

## Die E-Rechnung liest und prüft Belegt selbst

XRechnung, ZUGFeRD und Factur-X erkennt Belegt beim Eingang: Nummer, Datum, Verkäufer und Betrag stehen neben der
Vorschau und als Vorschlag zur Einordnung. Auf Wunsch prüft der Validator der KoSIT jede Rechnung, auf deinem Server
ohne Internet.

[Dokument](dokument.md) · [E-Rechnungen](eingang.md#text-und-e-rechnungen) · [E-Rechnungen prüfen](betrieb.md#erechnung-pruefen)
</div>
<div class="showcase-shot" markdown>
![ZUGFeRD-Rechnung des Holzhandels Kranich: links das PDF, rechts Nummer, Datum, Verkäufer, Gesamtbetrag, Prüfung gültig und der Vorschlag zur Einordnung](assets/screenshot-dokument.png#only-light){ width="1504" height="972" loading="lazy" }
![ZUGFeRD-Rechnung des Holzhandels Kranich: links das PDF, rechts Nummer, Datum, Verkäufer, Gesamtbetrag, Prüfung gültig und der Vorschlag zur Einordnung](assets/screenshot-dokument-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature showcase-feature--flip" markdown>
<div markdown>
<span class="showcase-kicker">Ordnung</span>

## Ordnung, die mitlernt

Korrespondenten, Tags in Farben, Dokumenttypen und eigene Felder wie Betrag oder Datum. Zuordnungsregeln und was
Belegt aus deinen Einordnungen lernt, schlagen vor; gesetzt wird erst, wenn du übernimmst. Jede Änderung steht im
Verlauf, die Frist hängt allein an der Art.

[Korrespondenten, Tags, Typen und Felder](ordnung.md)
</div>
<div class="showcase-shot" markdown>
![Archiv als Kacheln mit Vorschaubildern, Korrespondent, Dokumenttyp und Tags, darüber Filter nach Art, Tags, Korrespondent, Typ und Feld](assets/screenshot-ordnung.png#only-light){ width="1504" height="972" loading="lazy" }
![Archiv als Kacheln mit Vorschaubildern, Korrespondent, Dokumenttyp und Tags, darüber Filter nach Art, Tags, Korrespondent, Typ und Feld](assets/screenshot-ordnung-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>
<span class="showcase-kicker">Fristen und Löschen</span>

## Gesperrt bis Fristende, gelöscht mit Nachweis

Belegt rechnet die Frist nach § 147 AO aus der Art und dem Tag des Dokuments. Bis dahin lässt Postgres kein
Löschen zu, eine Sperre hält es etwa bei einer Außenprüfung länger. Danach beantragst du die Löschung, eine zweite Person
bestätigt, der Nachweis bleibt.

[Fristen und Löschen](fristen.md)
</div>
<div class="showcase-shot" markdown>
![Fristen: Zahlen zu Archiv, Eingang und Löschbarem, ein offener Löschantrag für einen Kontoauszug von 2016 und die Fristen nach § 147 AO](assets/screenshot-fristen.png#only-light){ width="1504" height="972" loading="lazy" }
![Fristen: Zahlen zu Archiv, Eingang und Löschbarem, ein offener Löschantrag für einen Kontoauszug von 2016 und die Fristen nach § 147 AO](assets/screenshot-fristen-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature showcase-feature--flip" markdown>
<div markdown>
<span class="showcase-kicker">Prüfung</span>

## Bereit, wenn die Betriebsprüfung kommt

Siegel und Hash-Kette liegen in PostgreSQL; ein Klick prüft Kette und Dateien, der Prüfbericht nennt den Prüfwert.
Der Prüfer bekommt einen Zugang für seinen Zeitraum (Z1), der Datenträger nach dem Beschreibungsstandard ist ein ZIP
(Z3). Dazu auf Wunsch Zeitstempel nach RFC 3161 und S3 mit Object Lock.

[Prüfung, Z1 und Z3](pruefung.md)
</div>
<div class="showcase-shot" markdown>
![Prüfung: Kette intakt, alle Siegel stimmen, Prüfbericht mit Prüfwert, Datenbankzugriff mit getrennten Rollen, Sicherung und Datenträger für die Betriebsprüfung](assets/screenshot-pruefung.png#only-light){ width="1504" height="972" loading="lazy" }
![Prüfung: Kette intakt, alle Siegel stimmen, Prüfbericht mit Prüfwert, Datenbankzugriff mit getrennten Rollen, Sicherung und Datenträger für die Betriebsprüfung](assets/screenshot-pruefung-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature" markdown>
<div markdown>
<span class="showcase-kicker">Verfahrensdokumentation</span>

## Die Verfahrensdoku schreibt sich aus dem Stand

Erfassung, Fristen, Unveränderbarkeit, Löschung, Zugänge und Sicherung, so wie Belegt gerade eingerichtet ist. Was
nur du wissen kannst, trägst du einmal ein; was noch fehlt, steht als Lücke darin. Zum Weitergeben als PDF oder
Markdown.

[Verfahrensdokumentation](verfahrensdoku.md)
</div>
<div class="showcase-shot" markdown>
![Erzeugte Verfahrensdokumentation der Muster Werkstatt GmbH mit allgemeiner Beschreibung und Erfassung](assets/screenshot-verfahrensdoku.png#only-light){ width="1504" height="972" loading="lazy" }
![Erzeugte Verfahrensdokumentation der Muster Werkstatt GmbH mit allgemeiner Beschreibung und Erfassung](assets/screenshot-verfahrensdoku-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-feature showcase-feature--flip" markdown>
<div markdown>
<span class="showcase-kicker">Workflows und Schnittstellen</span>

## Offen für deine anderen Programme

Workflows setzen Tags, Typ und Felder oder schicken das Original an eine Adresse, wenn ein Dokument ankommt oder eingeordnet wird.
REST-API mit OpenAPI, signierte Webhooks und MCP für KI-Assistenten binden andere Programme an. Aus Paperless-ngx
ziehst du mit Tags, Feldern und Notizen um, jedes Original gegen seine Prüfsumme geprüft.

[Workflows](workflows.md) · [Schnittstellen](schnittstelle.md) · [Von Paperless-ngx zu Belegt](umzug.md)
</div>
<div class="showcase-shot" markdown>
![Workflows: Stadtwerke als Fixkosten beim Eingang, Rechnungen mit Tag Steuer 2026 an die Buchhaltung senden, darunter ein neuer Workflow](assets/screenshot-workflows.png#only-light){ width="1504" height="972" loading="lazy" }
![Workflows: Stadtwerke als Fixkosten beim Eingang, Rechnungen mit Tag Steuer 2026 an die Buchhaltung senden, darunter ein neuer Workflow](assets/screenshot-workflows-dunkel.png#only-dark){ width="1504" height="972" loading="lazy" }
</div>
</div>

<div class="showcase-center" markdown>

## Für wen?

</div>

<div class="showcase-cards" markdown>
<div markdown>
**🧾 Selbstständige und kleine Betriebe**

Rechnungen, Kontoauszüge und Geschäftsbriefe sechs, acht oder zehn Jahre aufbewahren, ohne Ordner im Regal.
</div>
<div markdown>
**📬 Wer Mails aufbewahren muss**

Geschäftsbriefe kommen per Mail. Belegt archiviert sie aus dem Postfach oder als Journal vom Mailserver.
</div>
<div markdown>
**🤝 Mit deiner Steuerberatung**

[Eigener Zugang](zugaenge.md), der liest und Löschungen als zweite Person bestätigt; Mitarbeiter sehen nur ihren Teil.
</div>
<div markdown>
**📦 Wer von Paperless-ngx kommt**

Dasselbe Ablegen und Suchen, dazu Fristen und Unveränderbarkeit. [Umzug](umzug.md) mit allen Dokumenten.
</div>
</div>

<div class="showcase-center" markdown>

## In drei Schritten installiert

</div>

<div class="showcase-cards" markdown>
<div markdown>
**1. Zwei Dateien holen**

`compose.yml` und `.env` in einen Ordner auf einem Server mit Docker oder Podman.
</div>
<div markdown>
**2. Geheimnisse eintragen**

Passwörter und Schlüssel in `.env`, dann `docker compose up -d`.
</div>
<div markdown>
**3. Inhaber anlegen**

Mit dem Einrichtungscode aus `docker compose logs server` das erste Konto anlegen.
</div>
</div>

```bash
mkdir belegt && cd belegt
curl -O https://raw.githubusercontent.com/Speicherstadt/belegt/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/Speicherstadt/belegt/main/deploy/compose.env.example
chmod 600 .env
```

<p class="showcase-hinweis">Die Images erscheinen mit dem ersten Release auf Docker Hub; alles Weitere unter
<a href="betrieb.html">Installation und Betrieb</a>.</p>

<div class="showcase-hero" markdown>

## Deine Unterlagen. <span class="showcase-akzent">Dein Server.</span>

<p class="showcase-claim">Open Source unter AGPL-3.0, kostenlos. Du brauchst nur einen Server.</p>

[Installieren](betrieb.md){ .md-button .md-button--primary } [Alle Funktionen](ueberblick.md){ .md-button } [Quellcode auf GitHub](https://github.com/Speicherstadt/belegt){ .md-button }

</div>
