---
title: "Installation und Betrieb"
description: >-
  Belegt mit Docker Compose betreiben: Start, S3 mit Object Lock, Sicherung, Aktualisieren und Texterkennung.
---

# Betrieb

Belegt läuft als ein Image für Server und Worker neben PostgreSQL. Der Server wendet beim Start die Migrationen an
und liefert die Oberfläche aus; der Worker ruft Postfächer ab, überwacht den Eingangsordner, stellt Webhooks zu, führt
Workflows aus und liest Text, mit Texterkennung (Tesseract, Deutsch und Englisch) auch aus Scans.

## Starten

Das Image `tristanteu/belegt` gibt es auf Docker Hub und als `ghcr.io/firsttris/belegt`, für amd64 und arm64. Ohne den
Quellcode reichen zwei Dateien:

```bash
mkdir belegt && cd belegt
curl -O https://raw.githubusercontent.com/firsttris/belegt/main/deploy/compose.yml
curl -o .env https://raw.githubusercontent.com/firsttris/belegt/main/deploy/compose.env.example
chmod 600 .env
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

## Dateien in S3 mit Object Lock

Statt im Volume `dokumente` können die Originale in einem S3-Bucket liegen (AWS S3 oder ein selbst betriebener Dienst,
der Object Lock kann). Den Bucket legst du mit Object Lock an; dann setzt du `S3_ENDPUNKT`, `S3_BUCKET`,
`S3_ZUGANG_ID`, `S3_ZUGANG_GEHEIMNIS`, bei AWS `S3_REGION` und `S3_PFAD_STIL=false`.

Belegt lädt jede Datei mit SHA-256-Prüfsumme hoch und sperrt sie im Modus COMPLIANCE bis zum Ende der längsten Frist
ihrer Dokumente; der Worker verlängert die Sperre, sobald ein Dokument eingeordnet oder länger eingeordnet wird. Eine
solche Sperre kann niemand verkürzen oder aufheben, auch nicht mit dem Schlüssel des Kontos. Mit `S3_SPERRE_TAGE`
sperrt Belegt schon ab dem Hochladen für so viele Tage, also auch, was noch im Eingang liegt; frei Abgelegtes lässt
sich dann erst danach aus dem Bucket entfernen. Lehnt der Bucket das Entfernen nach einer bestätigten Löschung ab,
bleibt die Datei bis zum Ende ihrer Sperre liegen; Belegt liefert sie nicht mehr aus, und der Worker versucht das
Entfernen stündlich wieder.

## Sichern

Zu sichern sind die Datenbank und das Volume `dokumente` (die Originale unter ihrem SHA-256; mit S3 der Bucket, etwa
mit Replikation in einen zweiten), dazu `.env`: Ohne
`BELEGT_SCHLUESSEL` lassen sich Postfach-Passwörter und Webhook-Geheimnisse nicht mehr entschlüsseln.

```bash
docker compose exec -T postgres pg_dump -U belegt -Fc belegt > belegt.dump
```

Nach einer Wiederherstellung prüft „Prüfung“ mit „Auch alle Dateien prüfen“, ob Kette, Siegel und Dateien stimmen.
Beschreibe die Sicherung unter „Verfahrensdoku“; sie gehört in die Verfahrensdokumentation.

## Aktualisieren

```bash
docker compose pull
docker compose up -d
```

Mit `BELEGT_VERSION` in `.env` bleibt Belegt auf einer Version (etwa `0.1.0`), sonst folgt es `latest`. Aus dem
Quellcode gebaut (das `compose.yml` im Repository): `git pull` und `docker compose up -d --build`. Welche Version läuft,
steht unten in der Navigation und in `/api/status`.

Die Migrationen laufen beim Start des Servers; der Worker startet erst, wenn der Server bereit ist.

## Ansicht für Office-Dateien

```bash
docker compose --profile vorschau up -d
```

Mit `VORSCHAU_URL=http://gotenberg:3000` in `.env` schickt der Worker Word, Excel, PowerPoint, OpenDocument und RTF an
[Gotenberg](https://gotenberg.dev) und legt das PDF als Ansicht ab. LibreOffice läuft dort im eigenen Container und im
Netz `vorschau` ohne Internet, weil es fremde Dateien öffnet. Ist der Dienst nicht erreichbar, versucht es der Worker
später wieder; Dateien, die vor dem Einschalten eingegangen sind, bekommen ihre Ansicht nachträglich. Eine Datei, an der Gotenberg sein Zeitlimit
(`--api-timeout`, Vorgabe 30 Sekunden) überschreitet, bekommt keine Ansicht.

## Eingangsordner

Für einen Scanner oder eine Freigabe, in die Dateien abgelegt werden, legst du neben `compose.yml` einen Ordner an und
gibst ihn dem Benutzer des Containers (UID 1000), denn der Worker entfernt aufgenommene Dateien:

```bash
mkdir eingang && sudo chown 1000 eingang
```

Dann in `compose.yml` beim Worker die Zeile `- ./eingang:/var/lib/belegt/eingang` einkommentieren, in `.env`
`EINGANG_ORDNER=/var/lib/belegt/eingang` setzen und `docker compose up -d`. Was dort ankommt, beschreibt
[Eingang](eingang.md#eingangsordner); Fehler stehen im Log des Workers (`docker compose logs worker`). Stapel mit
[Trennblättern](eingang.md#trennblätter) teilt der Worker; einen eigenen Code für die Trennblätter setzt
`TRENNBLATT_CODE` in `.env`. Mit `EINGANG_ORDNER_TAGS=true` werden Unterordner zu Tags.

## Umzug aus Paperless-ngx

Ein hochgeladener Export liegt bis zum Ende seines Imports im Importordner (`IMPORT_ORDNER`, im Image
`/var/lib/belegt/import` im selben Volume wie die Dokumente, das Server und Worker teilen); Platz braucht es dort für
das ganze ZIP. Größer als `IMPORT_MAX_GB` (Vorgabe 20) darf es nicht sein. Ein Reverse Proxy davor muss so große
Uploads durchlassen, bei nginx etwa `client_max_body_size 20g;` für `/api/paperless/export`. Wie der Umzug geht, steht in
[Von Paperless-ngx zu Belegt](umzug.md).

## Texterkennung

Das Image bringt Tesseract mit Deutsch und Englisch mit. Andere Sprachen: Paket `tesseract-ocr-<sprache>` im
Containerfile ergänzen und `OCR_SPRACHEN` setzen (etwa `deu+eng+fra`). Ohne Tesseract (etwa bei `bun server/worker.ts`
auf einem Rechner ohne das Programm) bleiben Scans ohne Text; kommt es später dazu, liest der Worker sie nach.
