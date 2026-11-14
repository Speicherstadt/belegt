# Betrieb

Belegt läuft als ein Image für Server und Worker neben PostgreSQL. Der Server wendet beim Start die Migrationen an
und liefert die Oberfläche aus; der Worker ruft Postfächer ab, stellt Webhooks zu und liest Text, mit Texterkennung
(Tesseract, Deutsch und Englisch) auch aus Scans.

## Starten

```bash
cp .env.beispiel .env
```

In `.env` drei Geheimnisse eintragen, etwa mit `openssl rand -hex 32` und `openssl rand -base64 32`:
`POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` (mindestens 32 Zeichen) und `BELEGT_SCHLUESSEL` (32 Bytes base64; damit
sind Postfach-Passwörter und Webhook-Geheimnisse verschlüsselt). `BELEGT_URL` ist die Adresse, unter der Belegt
erreichbar ist (hinter einem Reverse Proxy mit HTTPS die öffentliche).

```bash
docker compose up -d
```

Beim ersten Start schreibt der Server einen Einrichtungscode ins Log (`docker compose logs server`). Mit ihm legst du
unter `BELEGT_URL` das erste Konto an, den Inhaber; der Code gilt bis zum nächsten Neustart.

## Sichern

Zu sichern sind die Datenbank und das Volume `dokumente` (die Originale unter ihrem SHA-256), dazu `.env`: Ohne
`BELEGT_SCHLUESSEL` lassen sich Postfach-Passwörter und Webhook-Geheimnisse nicht mehr entschlüsseln.

```bash
docker compose exec -T postgres pg_dump -U belegt -Fc belegt > belegt.dump
```

Nach einer Wiederherstellung prüft „Prüfung“ mit „Auch alle Dateien prüfen“, ob Kette, Siegel und Dateien stimmen.
Beschreibe die Sicherung unter „Verfahrensdoku“; sie gehört in die Verfahrensdokumentation.

## Aktualisieren

```bash
git pull
docker compose up -d --build
```

Die Migrationen laufen beim Start des Servers; der Worker startet erst, wenn der Server bereit ist.

## Texterkennung

Das Image bringt Tesseract mit Deutsch und Englisch mit. Andere Sprachen: Paket `tesseract-ocr-<sprache>` im
Containerfile ergänzen und `OCR_SPRACHEN` setzen (etwa `deu+eng+fra`). Ohne Tesseract (etwa bei `bun server/worker.ts`
auf einem Rechner ohne das Programm) bleiben Scans ohne Text; kommt es später dazu, liest der Worker sie nach.
