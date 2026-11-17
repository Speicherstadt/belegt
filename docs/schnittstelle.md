---
title: "Schnittstellen für Programme"
description: >-
  API-Tokens, „Öffnen mit …“, Webhooks mit Signatur und MCP für KI-Assistenten: wie andere Programme Belegt nutzen.
---

# Schnittstelle für andere Programme

Andere Programme nutzen Belegt über offene Schnittstellen. Die Beschreibung als OpenAPI 3.1 liegt ohne Anmeldung
unter `/api/openapi.json`; alle Aufrufe stehen in [`api.md`](api.md).

## API-Tokens

Unter **Quellen und Schnittstellen** legt der Inhaber ein Token an und kopiert es einmal (Knopf „Kopieren“). Das Programm schickt es als
`Authorization: Bearer belegt_…`. Mit dem Recht **Lesen** liest es Dokumente, Originale, Mails und Verlauf, mit
**Lesen, aufnehmen und einordnen** nimmt es zusätzlich Dateien und Mails auf und ordnet ein. Löschen, bestätigen und
Einstellungen ändern kann kein Token. Im Protokoll steht `token:<Name>`.

## Öffnen mit einer anderen App

Mit `OEFFNEN_MIT_NAME` und `OEFFNEN_MIT_URL` zeigt die Seite einer Office- oder Textdatei den Knopf „Öffnen mit
<Name>“, etwa für ein Office im Browser:

```bash
OEFFNEN_MIT_NAME=Office im Browser
OEFFNEN_MIT_URL=https://office.firma.de/oeffnen?datei={url}&name={name}
```

Beim Klick legt Belegt einen Link auf das Original an und öffnet die Adresse in einem neuen Tab, mit dem Link für
`{url}` und dem Dateinamen für `{name}`. Über den Link holt die App die Datei ohne Anmeldung, zehn Minuten lang und nur
dieses eine Dokument; nur ihr Origin darf die Antwort im Browser lesen. Inhaber und Steuerberatung dürfen das, der
Prüfer nicht. Wer wann einen Link anlegte, steht im Protokoll, der Link selbst nicht.

Die App bearbeitet eine Kopie. Was sie speichern will, nimmt sie als neues Dokument mit einem API-Token auf; das Original
bleibt unverändert.

## KI-Assistenten (MCP)

Unter `/api/mcp` spricht Belegt das Model Context Protocol (Streamable HTTP, ohne Sitzung), mit einem API-Token in
derselben Kopfzeile. Ein Assistent kann damit suchen (`dokumente_suchen`), Angaben und Text lesen (`dokument_lesen`,
`dokument_text`), jeweils mit Archivnummer, Tags, Dokumenttyp, Korrespondent und Feldern, und die vorhandenen Tags,
Dokumenttypen, Korrespondenten und Felder abfragen (`ordnung_listen`) und die Notizen eines Dokuments lesen (`notizen_lesen`). Mit dem Recht **schreiben**
nimmt er Dateien auf, ordnet ein, setzt Tags, Dokumenttyp, Korrespondent und Feldwerte und schreibt Notizen (`dokument_aufnehmen`,
`dokument_einordnen`, `dokument_ordnen`, `notiz_schreiben`). Neue Tags, Typen oder Felder
anlegen und löschen kann er nicht. In Claude Code etwa:

```bash
claude mcp add --transport http belegt https://belegt.example/api/mcp --header "Authorization: Bearer belegt_…"
```

## Webhooks

Ein Webhook meldet einer Adresse per `POST`, wenn ein Dokument aufgenommen, eingeordnet oder gelöscht wurde oder ein
[Workflow](workflows.md) es meldet (`dokument.workflow`, mit `workflow`: seinem Namen), ab dem Anlegen und der Reihe
nach:

```json
{ "id": 42, "art": "dokument.eingeordnet", "dokumentId": "…", "zeitpunkt": "2026-11-14T10:00:00.000Z" }
```

Die Nachricht enthält keinen Inhalt; den holt das Programm mit seinem Token. Die Kopfzeile `X-Belegt-Signatur` ist
`sha256=` und der HMAC-SHA256 des Rumpfs mit dem Geheimnis (`whsec_…`), das beim Anlegen einmal erscheint. Antwortet
die Adresse nicht mit 2xx, versucht Belegt es alle 15 Sekunden wieder und hält bis dahin die folgenden Ereignisse
zurück; ein Ereignis kommt also nicht doppelt und nicht außer der Reihe, solange der Empfänger nicht 2xx meldet, ohne
es verarbeitet zu haben. Den letzten Fehler zeigt die Liste. Zugestellt wird vom Worker, das Geheimnis liegt
verschlüsselt (braucht `BELEGT_SCHLUESSEL`).

Signatur prüfen, etwa in TypeScript:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
const erwartet = `sha256=${createHmac("sha256", geheimnis).update(rumpf).digest("hex")}`;
const echt = timingSafeEqual(Buffer.from(erwartet), Buffer.from(kopfzeile));
```
