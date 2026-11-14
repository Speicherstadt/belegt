# Entwicklung

## Befehle

```sh
bun install
bun run dev:server   # Server auf Port 3000 (PORT)
bun run typecheck
bun run lint         # Biome; bun run format behebt Formatfehler
bun run test         # Vitest
```

## Tests

Vitest für alles ohne Browser, Playwright für das, was jemand klickt. Tests gegen Postgres brauchen
`TEST_DATABASE_URL` und werden sonst übersprungen; die CI setzt sie immer.

`TEST_DATABASE_URL` nie auf einen Server mit echten Daten zeigen lassen: Die Tests legen Datenbanken daneben an und
löschen sie wieder.

## Einstellungen

| Variable | Bedeutung | Vorgabe |
| --- | --- | --- |
| `PORT` | Port des Servers | `3000` |
| `DATABASE_URL` | Postgres | – |
| `DOCUMENTS_DIR` | Wurzel des Dateispeichers | `data/dokumente` |
