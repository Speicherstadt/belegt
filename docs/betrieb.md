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

In `.env` die Geheimnisse eintragen, etwa mit `openssl rand -hex 24` und `openssl rand -base64 32`:
`POSTGRES_PASSWORD` und `APP_DB_PASSWORD` (nur Buchstaben und Ziffern, sie stehen in den Adressen darunter),
`BETTER_AUTH_SECRET` (mindestens 32 Zeichen) und `BELEGT_SCHLUESSEL` (32 Bytes base64; damit sind Postfach-Passwörter
und Webhook-Geheimnisse verschlüsselt). `BELEGT_URL` ist die Adresse, unter der Belegt
erreichbar ist (hinter einem Reverse Proxy mit HTTPS die öffentliche).

```bash
docker compose up -d
```

Beim ersten Start schreibt der Server einen Einrichtungscode ins Log (`docker compose logs server`). Mit ihm legst du
unter `BELEGT_URL` das erste Konto an, den Inhaber; der Code gilt bis zum nächsten Neustart.

## HTTPS

Mit dem Profil `https` stellt [Caddy](https://caddyserver.com) Belegt unter einer Domain mit automatischem Zertifikat
bereit. In `.env` `DOMAIN` (zeigt auf den Server, Ports 80 und 443 offen), `BELEGT_URL=https://<DOMAIN>` und
`BELEGT_PORT=127.0.0.1:3000` setzen, damit der Server selbst nur lokal erreichbar ist, dann:

```bash
docker compose --profile https up -d
```

Caddy setzt HSTS und komprimiert; Rahmen und Inhaltstyp setzt Belegt selbst. Eine Grenze für Uploads setzt Caddy nicht,
weil der Export aus Paperless-ngx bis `IMPORT_MAX_GB` groß sein darf. Für einen eigenen Caddy ist `deploy/Caddyfile`
die Vorlage, mit demselben Block. Das SMTP-Journal geht nicht über Caddy; für STARTTLS dort siehe
[SMTP-Journal](eingang.md#smtp-journal).

## Getrennte Datenbankrollen

Server, Worker und SMTP-Journal melden sich mit der Rolle `belegt_app` an (`DATABASE_URL`). Sie besitzt keine Tabelle,
hat keine Rechte als Superuser, für Rollen oder neue Datenbanken und kann deshalb weder Trigger abschalten noch Tabellen
ändern, leeren oder `session_replication_role` setzen. Nur der Migrationsschritt vor dem Start arbeitet als Eigentümer
`belegt` (`MIGRATION_DATABASE_URL`) und vergibt danach die Rechte neu, auch ohne neue Migration:

| Tabellen | Rechte der App |
| --- | --- |
| Nur ergänzen: versiegelte Tabellen ohne Festschreibungsspalte (Dokumente, Archivnummern, Einordnungen, Mails …), Freigaben, Postfach-Aktionen | lesen, einfügen |
| Audit-Log, Siegel und Kopf der Kette (`audit_chain`), die nur ihre Trigger mit den Rechten des Eigentümers schreiben; `sealed_tables`, `backup_status` | lesen |
| Alle anderen; Festschreibungen (etwa bestätigte Löschungen) prüfen die Trigger | lesen, einfügen, ändern, löschen |

`TRUNCATE`, `TRIGGER`, eigene Objekte und temporäre Tabellen gibt es für die App nie. Der Server bekommt die
Eigentümeradresse nicht (`server/start.sh`). Die wirksamen Rechte stehen unter „Prüfung“ › „Datenbankzugriff“ und in
der Verfahrensdokumentation.

**Neue Installation:** `APP_DB_PASSWORD` in `.env` setzen; Postgres legt die Rolle beim ersten Start mit leerem
Volume an.

**Bestehende Installation:** erst sichern, dann die Rolle einmal anlegen (`createuser` fragt das Passwort zweimal; es
muss zu `APP_DB_PASSWORD` passen) und die drei Zeilen `APP_DB_PASSWORD`, `DATABASE_URL` und `MIGRATION_DATABASE_URL`
aus `compose.env.example` in `.env` übernehmen:

```bash
docker compose exec postgres createuser -U belegt --login --no-superuser --no-createdb --no-createrole --pwprompt belegt_app
docker compose up -d
```

Ohne die beiden Adressen läuft Belegt wie bisher mit dem Eigentümer weiter; Log, Startseite und „Prüfung“ warnen dann.
Mit `MIGRATION_DATABASE_URL` bricht der Start ab, wenn die App-Anmeldung zu viele Rechte hat (auch geerbte, etwa über
`pg_write_all_data`), dieselbe wie die des Eigentümers ist, auf eine andere Datenbank zeigt oder mit
`session_replication_role = replica` startet. Fehlt eine Migration und ist nur die App-Anmeldung da, startet der Server
nicht.

Die Trennung schützt vor einer übernommenen App, nicht vor dem Betreiber mit Eigentümer- oder Serverzugang; dafür
bleiben Zeitstempel, notierte Prüfwerte und Sicherungen an einem zweiten Ort.

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
mit Replikation in einen zweiten), dazu `.env`: Ohne `BELEGT_SCHLUESSEL` lassen sich Postfach-Passwörter und
Webhook-Geheimnisse nicht mehr entschlüsseln.

Das übernimmt der Backup-Container (`tristanteu/belegt-backup`, aus `deploy/backup`): `RESTIC_PASSWORD` in `.env`
setzen (`openssl rand -base64 32`, an einem zweiten Ort aufbewahren), dann

```bash
docker compose --profile backup up -d
docker compose exec backup backup.sh   # eine Sicherung jetzt, etwa vor einem Update
```

Täglich um `BACKUP_TIME` (Standard 03:15) sichert er die Datenbank mit `pg_dump` (custom format, mit Prüfsumme) und die
Originale, verschlüsselt mit [restic](https://restic.net). Mit S3 sichert er nur die Datenbank; die Dateien liegen im
Bucket mit Object Lock. Ziel ist das Volume `backups`; besser ein zweites System über `RESTIC_REPOSITORY` (`sftp:…`,
`s3:…` mit `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY`, `rest:…`). Aufbewahrt werden 14 tägliche, 24 monatliche und
11 jährliche Stände. Mehrere Instanzen in einem Repository brauchen je einen eigenen `BACKUP_HOST`.

**Test-Restore:** Alle `RESTORE_CHECK_DAYS` Tage (Standard 7, `0` schaltet ab) spielt er nach dem Backup den Stand in
eine Wegwerf-Datenbank ein und prüft ihn mit der Prüfung von Belegt: Hash-Kette, Kopf, Siegel und jedes Original gegen
seinen Hash (bei S3 die Dateien im Bucket); der Kopf der Kette muss in der laufenden Datenbank stehen. Danach löscht er
die Wegwerf-Datenbank. Von Hand: `docker compose exec backup restore-check.sh` (oder mit einer Snapshot-ID). Platz
braucht es dafür kurz für eine zweite Kopie der Datenbank und für den Snapshot im Container.

Ergebnis und Fehler stehen auf der Startseite unter „Betrieb“, unter „Prüfung“ und mit Ziel, Rhythmus und letztem Test
in der Verfahrensdokumentation (Tabelle `backup_status`, nur ergänzen, mit Audit-Log; die App kann sie nur lesen). Der
Container ist ungesund, wenn das letzte Backup fehlschlug oder zwei Tage keins durchlief.

**Wiederherstellen** ersetzt Datenbank und Originale vollständig; gibt es die Datenbank nicht mehr (neuer Server), legt
es sie an:

```bash
docker compose stop server worker smtp
docker compose run --rm restore          # verfügbare Stände
docker compose run --rm restore latest   # oder eine Snapshot-ID, fragt nach „ja“
docker compose up -d
```

Der Start danach vergibt die Rechte der App-Rolle neu (auf einem neuen Server die Rolle vorher anlegen, siehe
[Getrennte Datenbankrollen](#getrennte-datenbankrollen)). Dann unter „Prüfung“ mit „Auch alle Dateien prüfen“ prüfen.

Ohne den Container geht es auch von Hand, dann ohne Test-Restore und ohne Eintrag in der App:

```bash
docker compose exec -T postgres pg_dump -U belegt -Fc belegt > belegt.dump
```

Löscht Belegt Mails in einem Postfach ([Nach dem Abholen](eingang.md#nach-dem-abholen)), wähle die Wartezeit dort
länger als den Abstand zwischen zwei Sicherungen. Beschreibe die Sicherung unter „Verfahrensdoku“ (wer die
Wiederherstellung prüft, wo das Passwort liegt); sie gehört in die Verfahrensdokumentation.

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

Aus jedem Scan mit erkanntem Text erzeugt der Worker außerdem ein [durchsuchbares PDF](dokument.md#durchsuchbares-pdf)
(PDF/A-2b). Das erkennt den Text ein zweites Mal und braucht etwa so viel Rechenzeit wie die Texterkennung selbst und in
der Datenbank etwa so viel Platz wie der Scan. `ARCHIVFASSUNG=false` schaltet es ab; vorhandene Fassungen bleiben.
