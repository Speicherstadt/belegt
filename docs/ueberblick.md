---
title: "Alle Funktionen"
description: >-
  Was Belegt kann, Bereich für Bereich: Eingang und Suche, Umzug, Ordnung, E-Rechnungen, Fristen, Unveränderbarkeit,
  Betriebsprüfung, Zugänge, Verfahrensdokumentation, Schnittstellen und Workflows.
---

# Alle Funktionen

Den Rundgang in Bildern zeigt die [Startseite](index.md), den Betrieb [Installation und Betrieb](betrieb.md).

Belegt kennt drei Arten der Aufbewahrung:

- **Pflicht:** Buchungsbelege 8 Jahre, Geschäftsbriefe 6 Jahre, Bücher und Abschlüsse 10 Jahre (§ 147 AO), gesperrt bis
  Fristende.
- **Freiwillig mit Frist:** Verträge, Garantien; gesperrt bis zu einem selbst gewählten Tag.
- **Frei:** alles andere, jederzeit löschbar.

| Bereich | Was Belegt kann |
| --- | --- |
| [Eingang und Suche](eingang.md) | Hochladen, Mails per IMAP, JMAP, Microsoft 365, Google, SMTP-Journal, MBOX, EML und PST; Volltext mit Text aus PDFs, Office-Dateien und Texterkennung für Scans |
| [Scannen](scannen.md) | Eingangsordner für Netzwerkscanner, FTP-Dienst für „Scan to FTP“, Trennblätter für Stapel |
| [Umzug](umzug.md) | Dokumente aus Paperless-ngx über die API oder aus einem Export, mit Tags, Dokumenttypen, Feldern und Notizen, jedes Original gegen seine Prüfsumme geprüft |
| [Ordnung](ordnung.md) | Tags, Dokumenttypen und eigene Felder (Betrag, Datum, Auswahl …) mit Filter, Suche und gespeicherten Ansichten, jede Änderung im Verlauf |
| [Dokument](dokument.md) | Vorschaubilder, durchsuchbares PDF für Scans, Seiten drehen, entfernen und teilen als neues Dokument, Notizen, ähnliche Dokumente |
| [E-Rechnungen](eingang.md#text-und-e-rechnungen) | XRechnung und ZUGFeRD erkannt, Nummer, Datum, Verkäufer und Betrag als Vorschlag zur Einordnung, auf Wunsch [geprüft mit dem KoSIT-Validator](betrieb.md#erechnung-pruefen) |
| [Fristen und Löschen](fristen.md) | Fristen nach § 147 AO, Sperren bei Außenprüfung oder Rechtsstreit, Löschen erst nach Fristende und mit zweiter Person |
| [Unveränderbarkeit](pruefung.md) | Siegel und Hash-Kette in PostgreSQL, Prüfung von Kette und Dateien, Zeitstempel nach RFC 3161, auf Wunsch S3 mit Object Lock |
| [Betriebsprüfung](pruefung.md#prüferzugang-z1) | Prüferzugang mit Zeitraum (Z1), Datenträger nach dem Beschreibungsstandard (Z3), Prüfbericht |
| [Zugänge](zugaenge.md) | Steuerberatung, Prüfer und Mitarbeiter, die nur Dokumente bestimmter Tags, Typen oder Korrespondenten sehen und darin bearbeiten |
| [Teilen per Link](teilen.md) | Ein Original ohne Anmeldung herunterladen lassen, mit Ablauf und Widerruf, jeder Abruf festgehalten |
| [Verfahrensdokumentation](verfahrensdoku.md) | Aus dem tatsächlichen Stand erzeugt, mit deinen Angaben zum Betrieb und den Lücken, die noch fehlen |
| [Schnittstellen](schnittstelle.md) | REST-API mit OpenAPI, API-Tokens, Webhooks, MCP für KI-Assistenten, Anmeldung über OpenID Connect und Einbetten |
| [Workflows](workflows.md) | Wenn ein Dokument ankommt oder eingeordnet wird: Tags, Dokumenttyp, Feldwerte, Notiz, Webhook oder das Original an eine Adresse senden, nach Bedingungen, je Dokument genau einmal und protokolliert |
| [Vorschläge](eingang.md#vorschläge-eines-sprachmodells) | Regeln, E-Rechnung und auf Wunsch ein Sprachmodell auf deinem Server schlagen vor; eingeordnet wird erst nach Bestätigung |
| [Benachrichtigungen](betrieb.md#benachrichtigungen) | Mail bei fehlgeschlagener Sicherung, hängendem Postfach, Befund in der Kette, wartendem Löschantrag, ablaufenden Fristen oder Fehlern in Workflows |
