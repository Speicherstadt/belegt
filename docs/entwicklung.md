# Entwicklung

## Befehle

```sh
bun install
bun run dev:server   # Server auf Port 3000 (PORT), braucht DATABASE_URL; wendet beim Start die Migrationen an
bun run dev:app      # Oberfläche mit Vite, leitet /api an den Server
bun run typecheck
bun run lint         # Biome; bun run format behebt Formatfehler
bun run test         # Vitest
bun run e2e          # Playwright mit axe gegen echten Server (Port 3185) und Vite (5185), braucht E2E_DATABASE_URL
bun run build
```

Texte der Oberfläche stehen in `messages/de.json` und `messages/en.json` (Paraglide); `bun install` und
`bun run typecheck` übersetzen sie nach `src/paraglide/`. Die Sprache folgt dem Browser, sonst Deutsch.

## Tests

Vitest für alles ohne Browser, Playwright für das, was jemand klickt. Tests gegen Postgres brauchen
`TEST_DATABASE_URL` und werden sonst übersprungen; die CI setzt sie immer.

```sh
TEST_DATABASE_URL=postgres://belegt:belegt@localhost:5432/belegt_test bun run test
```

Die E2E-Tests starten einen eigenen Server mit frischer Datenbank unter `E2E_DATABASE_URL` (Vorgabe
`postgres://belegt:belegt@localhost:5432/belegt_e2e`; sie wird gelöscht und neu angelegt) und richten Belegt zuerst
über die Oberfläche ein (`e2e/einrichten.setup.ts`).

Daneben legt der Lauf `<name>_vorlage` an (einmal migriert) und je Vitest-Worker `<name>_<Nummer>` als Kopie davon
(`server/test-db.ts`). Der Benutzer braucht `CREATEDB`; Tests, die eine Manipulation an den Triggern vorbei
nachstellen, brauchen einen Superuser.

`TEST_DATABASE_URL` nie auf einen Server mit echten Daten zeigen lassen: Die Tests legen Datenbanken daneben an und
löschen sie wieder.

## Einstellungen

| Variable | Bedeutung | Vorgabe |
| --- | --- | --- |
| `PORT` | Port des Servers | `3000` |
| `DATABASE_URL` | Postgres; Pflicht für den Server | – |
| `DOCUMENTS_DIR` | Wurzel des Dateispeichers | `data/dokumente` |
| `BETTER_AUTH_SECRET` | Schlüssel für Sitzungen, mindestens 32 Zeichen; Pflicht für den Server | – |
| `BETTER_AUTH_URL` | Adresse, unter der Belegt erreichbar ist | `http://localhost:3000` |

## Migrationen

Die erste Migration (`drizzle/0000_gobd_kern.sql`) ist die SQL-Vorlage aus `@firsttris/gobd-kern` mit dem Präfix
`belegt`: Audit-Log als Hash-Kette, Siegel, Sperren und die Prüfung. Tabellen stehen in `server/db/schema.ts`;
`bun --bun drizzle-kit generate --name <name>` erzeugt die Migration, versiegelte und protokollierte Tabellen meldet
sie danach mit `SELECT belegt_seal_table('…')` oder `SELECT belegt_audit_table('…')` an. Eine Migration, die schon
auf `main` ist, wird nie mehr geändert.

Der Kern kommt als Datei vom Release in Haben (`package.json`); eine neue Version trägt man dort mit der neuen URL ein.
