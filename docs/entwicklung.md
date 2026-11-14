# Entwicklung

## Befehle

```sh
bun install
bun run dev:server   # Server auf Port 3000 (PORT)
bun run dev:app      # Oberfläche mit Vite, leitet /api an den Server
bun run typecheck
bun run lint         # Biome; bun run format behebt Formatfehler
bun run test         # Vitest
bun run e2e          # Playwright mit axe, Desktop und Handy, eigener Port 5185
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

Daneben legt der Lauf `<name>_vorlage` an (einmal migriert) und je Vitest-Worker `<name>_<Nummer>` als Kopie davon
(`server/test-db.ts`). Der Benutzer braucht `CREATEDB`; Tests, die eine Manipulation an den Triggern vorbei
nachstellen, brauchen einen Superuser.

`TEST_DATABASE_URL` nie auf einen Server mit echten Daten zeigen lassen: Die Tests legen Datenbanken daneben an und
löschen sie wieder.

## Einstellungen

| Variable | Bedeutung | Vorgabe |
| --- | --- | --- |
| `PORT` | Port des Servers | `3000` |
| `DATABASE_URL` | Postgres | – |
| `DOCUMENTS_DIR` | Wurzel des Dateispeichers | `data/dokumente` |
