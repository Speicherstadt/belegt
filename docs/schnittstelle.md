# Schnittstelle für andere Programme

Andere Programme nutzen Belegt über offene Schnittstellen. Die Beschreibung als OpenAPI 3.1 liegt ohne Anmeldung
unter `/api/openapi.json`; alle Aufrufe stehen in [`api.md`](api.md).

## API-Tokens

Unter **Quellen und Schnittstellen** legt der Inhaber ein Token an und kopiert es einmal. Das Programm schickt es als
`Authorization: Bearer belegt_…`. Mit dem Recht **Lesen** liest es Dokumente, Originale, Mails und Verlauf, mit
**Lesen, aufnehmen und einordnen** nimmt es zusätzlich Dateien und Mails auf und ordnet ein. Löschen, bestätigen und
Einstellungen ändern kann kein Token. Im Protokoll steht `token:<Name>`.

## Webhooks

Ein Webhook meldet einer Adresse per `POST`, wenn ein Dokument aufgenommen, eingeordnet oder gelöscht wurde, ab dem
Anlegen und der Reihe nach:

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
