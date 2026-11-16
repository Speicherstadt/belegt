#!/bin/sh
# Start des Servers im Image: Mit MIGRATION_DATABASE_URL läuft erst der Migrationsschritt (server/migrieren.ts), dann der
# Server ohne die Eigentümeradresse. Leer statt unset: Bun läse eine Variable aus einer .env sonst wieder ein.
set -eu
if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  bun server/migrieren.ts
  export MIGRATION_DATABASE_URL=
fi
exec bun server/index.ts
