<div align="center">

<h1>Belegt: Dokumentenarchiv mit GoBD-Modus, selbst gehostet</h1>

**Belegt ist, was du beweisen kannst.**<br>
Mails, E-Rechnungen, Scans und beliebige Dokumente an einem Ort, durchsuchbar, auf deinem Server. Was aufbewahrt
werden muss, bleibt bis Fristende unverändert, und danach löschst du es nachweisbar.

![Status: Beta](https://img.shields.io/badge/Status-Beta-orange)
[![CI](https://github.com/Speicherstadt/belegt/actions/workflows/ci.yml/badge.svg)](https://github.com/Speicherstadt/belegt/actions/workflows/ci.yml)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue)](LICENSE)
[![Doku](https://img.shields.io/badge/Doku-belegt.net-4f46e5)](https://belegt.net/)
[![GoBD](https://img.shields.io/badge/GoBD-Siegel%20%7C%20Hash--Kette%20%7C%20Z1%20%7C%20Z3-1f6f5c)](https://belegt.net/pruefung.html)
[![E-Rechnung](https://img.shields.io/badge/E--Rechnung-ZUGFeRD%20%7C%20XRechnung-1f6f5c)](https://belegt.net/eingang.html#text-und-e-rechnungen)
[![RFC 3161](https://img.shields.io/badge/Zeitstempel-RFC%203161-1f6f5c)](https://belegt.net/pruefung.html#zeitstempel-rfc-3161)
[![MCP](https://img.shields.io/badge/MCP-KI--Assistenten-d97757)](https://belegt.net/schnittstelle.html#ki-assistenten-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh)
[![Hono](https://img.shields.io/badge/Hono-e36002?logo=hono&logoColor=white)](https://hono.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

[Rundgang in Bildern](https://belegt.net/) •
[Warum?](#warum-belegt) •
[Funktionen](#funktionen) •
[Schnellstart](#schnellstart) •
[FAQ](#faq) •
[Entwicklung](#entwicklung)

<sub>English: self-hosted document archive with a GoBD mode for German businesses: mails (IMAP, JMAP, Microsoft 365, Google, SMTP journal, PST), e-invoices (ZUGFeRD, XRechnung), scans with OCR and any other file, immutable until the end of the legal retention period, with auditor access and the data medium for tax audits. The app is in German and English; the [documentation](https://belegt.net/) is in German.</sub>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-start-dunkel.png">
  <img src="docs/assets/screenshot-start.png" alt="Startseite von Belegt: Eingang, Archiv, offener Löschantrag, Sperre und Speicher, Fristen, Quellen, Zustand der Hash-Kette und eine gespeicherte Ansicht" width="900">
</picture>

</div>

> [!WARNING]
> **Beta:** Belegt wird noch stark weiterentwickelt. Vor jedem Update sichern
> ([Sichern](https://belegt.net/betrieb.html#sichern)); Migrationen lassen sich nicht zurückspielen.

## Warum Belegt?

Wer ein Unternehmen führt, muss Rechnungen, Kontoauszüge und Geschäftsbriefe sechs, acht oder zehn Jahre aufbewahren,
unverändert und auffindbar, und der Betriebsprüfung zeigen können. Ein Ordner auf dem Server oder ein
Dokumentenmanagement reicht dafür selten: Dateien lassen sich ändern, und niemand weiß, wann was gelöscht werden darf.

- **Unveränderbar, wo es zählt**: Siegel und Hash-Kette liegen in PostgreSQL, nicht nur in der App; auf Wunsch S3 mit
  Object Lock bis Fristende und ein täglicher Zeitstempel nach RFC 3161
- **Fristen statt Bauchgefühl**: Belegt rechnet die Frist nach § 147 AO, sperrt bis dahin und lässt danach nur mit
  einer zweiten Person löschen; der Nachweis bleibt
- **Alles an einem Ort**: Mails aus Postfach, Journal oder Outlook-Datei, E-Rechnungen, Scans mit Texterkennung und
  beliebige Dateien, durchsuchbar
- **Bereit für die Prüfung**: Prüferzugang mit Zeitraum, Datenträger nach dem Beschreibungsstandard, Prüfbericht und
  eine Verfahrensdokumentation, die sich selbst aktuell hält
- **Offen für andere Programme**: REST-API, Webhooks, MCP für KI-Assistenten, Anmeldung über OpenID Connect und
  Einbetten in ein Portal
- **Deine Daten bleiben bei dir**: eigener Server, Geheimnisse verschlüsselt, KI-Vorschläge nur mit einem Modell auf
  deinem Server

## Funktionen

Kurz je Bereich; die Details stehen auf der verlinkten Seite, alles auf einen Blick unter
[Alle Funktionen](https://belegt.net/ueberblick.html).

| Bereich | Was Belegt kann |
|---|---|
| 📥 [Eingang](https://belegt.net/eingang.html) | Hochladen, Foto mit dem Handy, Teilen an die installierte App, [Scanner per FTP](https://belegt.net/scannen.html) mit Trennblättern, Postfächer per IMAP, JMAP, Microsoft 365 und Google, SMTP-Journal, EML, MBOX und PST |
| 🔎 [Suche](https://belegt.net/eingang.html) | Volltext in PDFs, Office-Dateien, Mails und Scans (Texterkennung), fortlaufende Archivnummer |
| 🏷️ [Ordnung](https://belegt.net/ordnung.html) | Korrespondenten, Tags, Dokumenttypen und eigene Felder, Zuordnungsregeln und gelernte Vorschläge, gespeicherte Ansichten |
| 🧾 [E-Rechnungen](https://belegt.net/eingang.html#text-und-e-rechnungen) | XRechnung und ZUGFeRD erkannt, als Vorschlag zur Einordnung, auf Wunsch [mit dem KoSIT-Validator geprüft](https://belegt.net/betrieb.html#erechnung-pruefen) |
| ⏳ [Fristen und Löschen](https://belegt.net/fristen.html) | Fristen nach § 147 AO, Sperren bei Außenprüfung oder Rechtsstreit, Löschen nach Fristende mit zweiter Person |
| 🔒 [Prüfung](https://belegt.net/pruefung.html) | Siegel und Hash-Kette in PostgreSQL, Prüfbericht, Prüferzugang (Z1), Datenträger mit `index.xml` (Z3), Zeitstempel nach RFC 3161 |
| 📘 [Verfahrensdokumentation](https://belegt.net/verfahrensdoku.html) | Aus dem tatsächlichen Stand erzeugt, mit deinen Angaben und den Lücken, die noch fehlen |
| ⚙️ [Workflows](https://belegt.net/workflows.html) | Tags, Typ, Felder, Notiz, Webhook oder Original an eine Adresse, wenn ein Dokument ankommt oder eingeordnet wird |
| 🔌 [Schnittstellen](https://belegt.net/schnittstelle.html) | REST-API mit OpenAPI, API-Tokens, signierte Webhooks, MCP für Claude und andere Assistenten |
| 🔐 [Zugänge](https://belegt.net/zugaenge.html) | Inhaber, Steuerberatung, Prüfer und Mitarbeiter mit Sichtbereich, zweiter Faktor, [OpenID Connect und Einbetten](https://belegt.net/einbetten.html), [Teilen per Link](https://belegt.net/teilen.html) |
| 📦 [Umzug](https://belegt.net/umzug.html) | Aus Paperless-ngx über die API oder einen Export, mit Tags, Feldern und Notizen |
| 🌍 Oberfläche | Deutsch und Englisch, hell, dunkel oder nach dem Gerät, als App installierbar, gegen WCAG 2.2 AA geprüft |

## Screenshots

<table>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-suche-dunkel.png"><img src="docs/assets/screenshot-suche.png" alt="Archiv mit der Suche nach „Rechnung“: Mail, XRechnung, Rechnung des Holzhandels und Stromrechnung mit Korrespondent, Typ, Tags und Frist"></picture><br><sub><b>Suche</b>: Volltext mit Filtern und Tags</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-dokument-dunkel.png"><img src="docs/assets/screenshot-dokument.png" alt="ZUGFeRD-Rechnung mit PDF-Vorschau, Nummer, Datum, Verkäufer, Gesamtbetrag, Prüfung gültig und Vorschlag zur Einordnung"></picture><br><sub><b>E-Rechnung</b>: erkannt, geprüft und vorgeschlagen</sub></td>
  </tr>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-fristen-dunkel.png"><img src="docs/assets/screenshot-fristen.png" alt="Fristen nach § 147 AO mit einem offenen Löschantrag, der auf die zweite Person wartet"></picture><br><sub><b>Fristen</b>: Löschen mit zweiter Person</sub></td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-pruefung-dunkel.png"><img src="docs/assets/screenshot-pruefung.png" alt="Prüfung: Kette intakt, Prüfbericht mit Prüfwert und Datenträger für die Betriebsprüfung"></picture><br><sub><b>Prüfung</b>: Prüfbericht und Datenträger (Z3)</sub></td>
  </tr>
</table>

Mehr im [Rundgang in Bildern](https://belegt.net/).

## Schnellstart

Belegt läuft als Container (`tristanteu/belegt`, amd64 und arm64) neben PostgreSQL; ein zweiter Container aus demselben
Image ruft Postfächer ab, liest Text und stellt Webhooks zu. Du brauchst einen Server mit Docker oder Podman. Die
Images erscheinen mit dem ersten Release auf Docker Hub und GHCR.

```bash
mkdir belegt && cd belegt
curl -O https://raw.githubusercontent.com/Speicherstadt/belegt/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/Speicherstadt/belegt/main/deploy/compose.env.example
chmod 600 .env
```

Trag in `.env` die Geheimnisse ein (`POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `BETTER_AUTH_SECRET`,
`BELEGT_SCHLUESSEL`); die App arbeitet dann mit einer eigenen Datenbankrolle, die keine Sperre abschalten kann. Dann:

```bash
docker compose up -d
docker compose logs server
```

Mit dem Einrichtungscode aus dem Log legst du unter `BELEGT_URL` (Port 3000) das erste Konto an, den Inhaber. Weitere
Dienste sind Profile (`docker compose --profile <name> up -d`): `https` (Caddy), `backup` (tägliche Sicherung mit
Test-Restore), `journal` (SMTP-Journal), `ftp` (für Scanner), `validator` (E-Rechnungen prüfen), `vorschau`
(Office-Dateien als PDF) und `ki` (Sprachmodell). S3, Zeitstempel, Microsoft 365, Google und OpenID Connect stehen in
[Installation und Betrieb](https://belegt.net/betrieb.html).

> [!IMPORTANT]
> Sichere `BELEGT_SCHLUESSEL` zusätzlich an einem zweiten Ort. Ohne ihn lassen sich Postfach-Passwörter,
> Refresh-Tokens und Webhook-Geheimnisse nach einer Wiederherstellung nicht mehr lesen.

## FAQ

<details>
<summary><b>Ist Belegt GoBD-konform?</b></summary>

Belegt setzt die technischen Anforderungen um: Unveränderbarkeit per Datenbank, Hash-Kette, Fristen, Löschen mit
Nachweis, Prüferzugang und Datenträger. Zur Ordnungsmäßigkeit gehören außerdem dein Betrieb (Sicherung, Zugänge,
Abläufe) und deine Verfahrensdokumentation. Ein Testat für die Software gibt es nicht; was eine Prüfung braucht, steht
in [Unterlagen für ein Testat](https://belegt.net/testat.html).
</details>

<details>
<summary><b>Ist das ein Dokumentenmanagement wie paperless?</b></summary>

Es kann das Gleiche (hochladen, Texterkennung, Suche, einordnen), aber mit einem anderen Ziel: Belegt beweist, dass ein
Dokument seit dem Eingang unverändert ist, und weiß, wie lange es aufbewahrt werden muss. Was nicht aufbewahrt werden
muss, legst du „frei“ ab und löschst es, wann du willst. Aus Paperless-ngx ziehst du mit allen Dokumenten, Tags,
Feldern und Notizen um, siehe [Von Paperless-ngx zu Belegt](https://belegt.net/umzug.html).
</details>

<details>
<summary><b>Kann ich Mails aus Microsoft 365, Google oder Outlook archivieren?</b></summary>

Ja: Postfächer per OAuth (Microsoft 365, Google), IMAP oder JMAP abrufen, alle Mails per SMTP-Journal vom Mailserver
bekommen, oder eine PST-Datei aus Outlook importieren. Siehe
[Eingang, Mails und Suche](https://belegt.net/eingang.html).
</details>

<details>
<summary><b>Wo liegen meine Dokumente, und was sieht eine KI?</b></summary>

Auf deinem Server, im Dateisystem oder in deinem S3-Bucket. Vorschläge eines Sprachmodells gibt es nur, wenn du eines
einrichtest, und es gehört auf deinen eigenen Server (etwa Ollama); die Verfahrensdokumentation nennt Modell, Server
und was es bekommt.
</details>

<details>
<summary><b>Kann meine Steuerberatung oder die Betriebsprüfung damit arbeiten?</b></summary>

Ja, über eine Einladung: Die Steuerberatung liest und bestätigt Löschungen als zweite Person; ein Prüfer sieht nur
Dokumente seines Zeitraums und lädt den Datenträger herunter. Mitarbeiter sehen nur Dokumente bestimmter Tags, Typen
oder Korrespondenten und ordnen sie auf Wunsch ein. Siehe [Prüfung, Z1 und Z3](https://belegt.net/pruefung.html)
und [Zugänge](https://belegt.net/zugaenge.html).
</details>

<details>
<summary><b>Kann ich Claude oder andere Programme anbinden?</b></summary>

Ja: per MCP suchen und lesen KI-Assistenten im Archiv, mit dem Recht „schreiben“ nehmen sie auch auf und ordnen ein;
löschen kann keiner. Für eigene Programme gibt es REST-API, Webhooks und API-Tokens. Siehe
[Schnittstellen](https://belegt.net/schnittstelle.html).
</details>

<details>
<summary><b>Was kostet Belegt?</b></summary>

Die Software ist kostenlos (AGPL-3.0). Du brauchst nur einen Server.
</details>

## Entwicklung

Voraussetzungen: Bun 1.4.4, PostgreSQL. Befehle, Tests und Umgebungsvariablen stehen in
[Entwicklung](https://belegt.net/entwicklung.html), wie du mitmachst, in
[CONTRIBUTING.md](CONTRIBUTING.md). Sicherheitslücken bitte privat melden, siehe [SECURITY.md](SECURITY.md).

```bash
bun install
bun run dev:server   # Server auf Port 3000
bun run dev:app      # Oberfläche mit Vite
bun run test         # Vitest, mit TEST_DATABASE_URL auch gegen PostgreSQL
bun run e2e          # Playwright mit axe gegen einen echten Server
```

Belegt nutzt den GoBD-Kern (`@firsttris/gobd-kern`) aus [Haben](https://github.com/firsttris/haben), der
Open-Source-Buchhaltung desselben Projekts.

## Sterne im Verlauf

<a href="https://www.star-history.com/#Speicherstadt/belegt&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Speicherstadt/belegt&type=Date&theme=dark">
    <img alt="Verlauf der GitHub-Sterne von Belegt" src="https://api.star-history.com/svg?repos=Speicherstadt/belegt&type=Date">
  </picture>
</a>

---

<div align="center">

⭐ Gefällt dir Belegt? Ein [Stern auf GitHub](https://github.com/Speicherstadt/belegt) hilft anderen, es zu finden.<br>
🐛 [Fehler melden](https://github.com/Speicherstadt/belegt/issues/new) · 💡 [Idee vorschlagen](https://github.com/Speicherstadt/belegt/issues/new) · 🔒 [Sicherheitslücke melden](SECURITY.md)

<sub>Lizenz: <a href="LICENSE">AGPL-3.0</a> · © Tristan Teufel und Mitwirkende<br>
Wer Belegt für andere betreibt, muss ihnen den Quellcode anbieten.<br>
Belegt ist keine Steuer- oder Rechtsberatung. Aufbewahrung und Verfahrensdokumentation vor dem Echtbetrieb mit deiner Steuerberatung abgleichen.</sub>

</div>
