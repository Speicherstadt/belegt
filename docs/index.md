---
title: "Belegt: Dokumentenarchiv mit GoBD-Modus, selbst gehostet"
description: >-
  Belegt archiviert Mails, E-Rechnungen, Scans und beliebige Dokumente auf deinem Server: unveränderbar bis Fristende,
  durchsuchbar, mit Prüferzugang, Datenträger nach dem Beschreibungsstandard und offenen Schnittstellen.
---

# Belegt

**Belegt ist, was du beweisen kannst.**

Belegt ist ein Dokumentenarchiv, das du selbst betreibst: Mails, E-Rechnungen, Scans und beliebige Dokumente an einem
Ort, durchsuchbar wie in einem Dokumentenmanagement. Was aufbewahrt werden muss, bleibt bis zum Ende der Frist
unverändert, und danach löschst du es nachweisbar.

- **Pflicht:** Buchungsbelege 8 Jahre, Geschäftsbriefe 6 Jahre, Bücher und Abschlüsse 10 Jahre (§ 147 AO), gesperrt bis
  Fristende.
- **Freiwillig mit Frist:** Verträge, Garantien; gesperrt bis zu einem selbst gewählten Tag.
- **Frei:** alles andere, jederzeit löschbar.

## Was Belegt kann

| Bereich | Was Belegt kann |
| --- | --- |
| [Eingang und Suche](eingang.md) | Hochladen, Mails per IMAP, JMAP, Microsoft 365, Google, SMTP-Journal, MBOX, EML und PST; Volltext mit Text aus PDFs und Texterkennung für Scans |
| [E-Rechnungen](eingang.md#text-und-e-rechnungen) | XRechnung und ZUGFeRD erkannt, Nummer, Datum, Verkäufer und Betrag als Vorschlag zur Einordnung |
| [Fristen und Löschen](fristen.md) | Fristen nach § 147 AO, Sperren bei Außenprüfung oder Rechtsstreit, Löschen erst nach Fristende und mit zweiter Person |
| [Unveränderbarkeit](pruefung.md) | Siegel und Hash-Kette in PostgreSQL, Prüfung von Kette und Dateien, Zeitstempel nach RFC 3161, auf Wunsch S3 mit Object Lock |
| [Betriebsprüfung](pruefung.md#prüferzugang-z1) | Prüferzugang mit Zeitraum (Z1), Datenträger nach dem Beschreibungsstandard (Z3), Prüfbericht |
| [Verfahrensdokumentation](verfahrensdoku.md) | Aus dem tatsächlichen Stand erzeugt, mit deinen Angaben zum Betrieb und den Lücken, die noch fehlen |
| [Schnittstellen](schnittstelle.md) | REST-API mit OpenAPI, API-Tokens, Webhooks, MCP für KI-Assistenten, Anmeldung über OpenID Connect und Einbetten |
| [Vorschläge](eingang.md#vorschläge-eines-sprachmodells) | Regeln, E-Rechnung und auf Wunsch ein Sprachmodell auf deinem Server schlagen vor; eingeordnet wird erst nach Bestätigung |

## Schnellstart

```bash
mkdir belegt && cd belegt
curl -O https://raw.githubusercontent.com/firsttris/belegt/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/belegt/main/deploy/compose.env.example
chmod 600 .env
```

In `.env` die drei Geheimnisse eintragen, dann:

```bash
docker compose up -d
docker compose logs server
```

Mit dem Einrichtungscode aus dem Log legst du das erste Konto an. Alles Weitere steht unter
[Installation und Betrieb](betrieb.md).
