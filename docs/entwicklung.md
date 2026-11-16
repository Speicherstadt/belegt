---
title: "Entwicklung"
description: >-
  Belegt lokal starten, testen und ändern: Befehle, Tests gegen PostgreSQL, Umgebungsvariablen und Migrationen.
---

# Entwicklung

## Befehle

```sh
bun install
bun run dev:server   # Server auf Port 3000 (PORT), braucht DATABASE_URL; wendet beim Start die Migrationen an
bun run dev:app      # Oberfläche mit Vite, leitet /api an den Server
bun server/smtp.ts   # SMTP-Journal (docs/eingang.md)
bun server/worker.ts # Worker: Postfächer, Eingangsordner, Webhooks, Workflows, Text und E-Rechnungen, Benachrichtigungen
bun run typecheck
bun run lint         # Biome; bun run format behebt Formatfehler
bun run test         # Vitest
bun run e2e          # Playwright mit axe gegen echten Server (Port 3185) und Vite (5185), braucht E2E_DATABASE_URL
bun run build
```

Die installierbare App (Manifest, Service Worker, Seite ohne Verbindung) steht in `src/pwa/`; Vite liefert sie in der
Entwicklung aus und legt sie beim Bauen nach `dist`. Die Symbole in `public/icons/` erzeugt `bun scripts/symbole.ts` aus
`docs/assets/icon.svg` und `icon-maskable.svg`.

Texte der Oberfläche stehen in `messages/de.json` und `messages/en.json` (Paraglide); `bun install` und
`bun run typecheck` übersetzen sie nach `src/paraglide/`. Die Sprache folgt dem Browser, sonst Deutsch.

## Tests

Vitest für alles ohne Browser, Playwright für das, was jemand klickt. Tests gegen Postgres brauchen
`TEST_DATABASE_URL` und werden sonst übersprungen; die CI setzt sie immer. Die Tests der Texterkennung brauchen `tesseract` (mit
Deutsch) und `pdftoppm` (Poppler), etwa `apt install tesseract-ocr-deu poppler-utils`, die der Trennblätter und
Vorschaubilder `pdftoppm`; sonst werden sie übersprungen.

```sh
TEST_DATABASE_URL=postgres://belegt:belegt@localhost:5432/belegt_test bun run test
```

Die Tests der Sicherung (`deploy/backup/backup.test.ts`) brauchen `pg_dump`, `pg_restore`, `psql` und `flock` und
nehmen für restic einen Nachbau (`deploy/backup/restic-attrappe.sh`); das echte restic läuft in der CI im Job
„Container bauen und starten“.

Die E2E-Tests starten einen eigenen Server mit frischer Datenbank unter `E2E_DATABASE_URL` (Vorgabe
`postgres://belegt:belegt@localhost:5432/belegt_e2e`; sie wird gelöscht und neu angelegt) und richten Belegt zuerst
über die Oberfläche ein (`e2e/einrichten.setup.ts`). Für die Testmail läuft daneben ein nachgebauter SMTP-Server auf
Port 3187 (`E2E_SMTP_PORT`). Der Server läuft dabei wie im Betrieb als eigene App-Rolle
`<name>_app`; der Benutzer aus `E2E_DATABASE_URL` migriert und braucht dafür `CREATEROLE`.

Daneben legt der Lauf `<name>_vorlage` an (einmal migriert) und je Vitest-Worker `<name>_<Nummer>` als Kopie davon
(`server/test-db.ts`). Der Benutzer braucht `CREATEDB`; Tests, die eine Manipulation an den Triggern vorbei
nachstellen, brauchen einen Superuser.

`TEST_DATABASE_URL` nie auf einen Server mit echten Daten zeigen lassen: Die Tests legen Datenbanken daneben an und
löschen sie wieder.

## Einstellungen

| Variable | Bedeutung | Vorgabe |
| --- | --- | --- |
| `PORT` | Port des Servers | `3000` |
| `DATABASE_URL` | Postgres; Pflicht für Server, Worker und SMTP-Journal. Mit getrennten Rollen die App-Anmeldung (docs/betrieb.md) | – |
| `MIGRATION_DATABASE_URL` | Eigentümer der Datenbank, nur für Migrationen und die Rechte der App-Anmeldung; `bun server/migrieren.ts` oder der Server selbst | – |
| `DOCUMENTS_DIR` | Wurzel des Dateispeichers | `data/dokumente` |
| `BETTER_AUTH_SECRET` | Schlüssel für Sitzungen, mindestens 32 Zeichen; Pflicht für den Server | – |
| `BETTER_AUTH_URL` | Adresse, unter der Belegt erreichbar ist | `http://localhost:3000` |
| `BELEGT_SCHLUESSEL` | Schlüssel für Passwörter von Postfächern und Geheimnisse von Webhooks, 32 Bytes base64 (`openssl rand -base64 32`); Pflicht für den Worker | – |
| `ABRUF_MINUTEN` | Abstand der Abrufe im Worker | `5` |
| `EINGANG_ORDNER` | Ordner, den der Worker überwacht (docs/eingang.md) | – |
| `EINGANG_ORDNER_TAGS` | Unterordner im Eingangsordner als Tags (`true` oder `false`, docs/eingang.md) | `false` |
| `IMPORT_ORDNER`, `IMPORT_MAX_GB` | Ordner für hochgeladene Exporte aus Paperless-ngx, den Server und Worker teilen, und ihre größte Größe in GB (docs/umzug.md) | `data/import`, `20` |
| `TRENNBLATT_CODE` | Inhalt des Codes auf Trennblättern, an denen gescannte Stapel geteilt werden | `BELEGT-TRENNER` |
| `OCR_SPRACHEN` | Sprachen für die Texterkennung (Tesseract), etwa `deu+eng+fra` | `deu+eng` |
| `ARCHIVFASSUNG` | Durchsuchbares PDF für Scans, wenn Tesseract da ist (`true` oder `false`, docs/dokument.md) | `true` |
| `SMTP_PORT`, `SMTP_EMPFAENGER`, `SMTP_TLS_KEY`, `SMTP_TLS_CERT` | SMTP-Journal: Port, erlaubte Empfänger, Pfade zu Schlüssel und Zertifikat für STARTTLS | `2525`, alle, ohne TLS |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Apps für IMAP mit OAuth (docs/eingang.md) | – (Mandant `common`) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_NAME` | Anmelden über einen OpenID-Connect-Anbieter (docs/einbetten.md) | –, Name `Firmenkonto` |
| `BELEGT_EMBED_ORIGIN` | Die eine Seite, die Belegt in einem Frame zeigen darf | – |
| `S3_ENDPUNKT`, `S3_BUCKET`, `S3_REGION`, `S3_ZUGANG_ID`, `S3_ZUGANG_GEHEIMNIS`, `S3_PFAD_STIL`, `S3_SPERRE_TAGE` | Dateien in S3 mit Object Lock statt `DOCUMENTS_DIR` (docs/betrieb.md) | –, `us-east-1`, `true`, `0` |
| `TSA_URL` | Zeitstempeldienst nach RFC 3161 für den täglichen Zeitstempel über die Kette (docs/pruefung.md) | – |
| `KI_URL`, `KI_MODELL` | Sprachmodell (Ollama) für Vorschläge zur Einordnung, auf eigenem Server (docs/eingang.md) | – |
| `OEFFNEN_MIT_NAME`, `OEFFNEN_MIT_URL` | Knopf „Öffnen mit …“ für eine andere App, Adresse mit `{url}` und `{name}` (docs/schnittstelle.md) | – |
| `MAIL_SMTP_URL`, `MAIL_SMTP_PASSWORT`, `MAIL_ABSENDER` | Benachrichtigungen per Mail: SMTP-Server (`smtp://benutzer@host:587` mit STARTTLS, `smtps://…:465`), Passwort, Absender (docs/betrieb.md) | –, –, `belegt@<Host von BETTER_AUTH_URL>` |
| `VORSCHAU_URL` | Vorschau-Dienst mit der Schnittstelle von Gotenberg für die Ansicht von Office-Dateien (docs/betrieb.md) | – |

## Migrationen

Die erste Migration (`drizzle/0000_gobd_kern.sql`) ist die SQL-Vorlage aus `@firsttris/gobd-kern` mit dem Präfix
`belegt`: Audit-Log als Hash-Kette, Siegel, Sperren und die Prüfung. Tabellen stehen in `server/db/schema.ts`;
`bun --bun drizzle-kit generate --name <name>` erzeugt die Migration, versiegelte und protokollierte Tabellen meldet
sie danach mit `SELECT belegt_seal_table('…')` oder `SELECT belegt_audit_table('…')` an. Rechte vergibt keine
Migration: Nach jedem Lauf leitet `server/db/rollen.ts` sie aus den Triggern ab (`belegt_append_only` nimmt UPDATE und
DELETE); `server/db/rollen.test.ts` versucht als App-Rolle, was verboten ist. Eine Migration, die schon
auf `main` ist, wird nie mehr geändert.

Der Kern kommt als Datei vom Release in Haben (`package.json`); eine neue Version trägt man dort mit der neuen URL ein.

## Veröffentlichen

Eine neue Version startet der Knopf **Actions → Bump version → Run workflow** auf `main` (`patch`, `minor`, `major`;
`preminor` für einen Release Candidate). Er erhöht die Version in `package.json`, taggt `vX.Y.Z` und startet
`release.yml`: CI (übersprungen, wenn `main` denselben Code schon geprüft hat), dann das Image für amd64 und arm64 nach
Docker Hub (`tristanteu/belegt`, Tags `x.y.z`, `x.y`, `latest`) und GHCR, die Beschreibung auf Docker Hub aus dem
README und das GitHub-Release. Ein Release Candidate bekommt `x.y.z-rc.N` und `next`, ein Start von Hand auf `main`
das Tag `edge`. Die Workflows kommen aus [firsttris/workflows](https://github.com/firsttris/workflows).

Einmalig im Repository einzurichten:

- Secret `DOCKER_PAT`: Zugangstoken von Docker Hub für `tristanteu` (Account Settings → Personal access tokens, Recht
  Read & Write).
- Settings → Pages → Source „GitHub Actions“ für die Doku, von Hand; danach veröffentlicht `docs.yml` sie bei jeder
  Änderung an `docs/` (den ersten Lauf unter Actions → Docs → Re-run starten).
- Die GitHub-App [Renovate](https://github.com/apps/renovate) für dieses Repository (`.github/renovate.json5`).

Die Bilder in README und Doku erzeugt `bun run screenshots` (erfundene Daten, hell und dunkel, nach `docs/assets/`).
