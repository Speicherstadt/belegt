---
name: checks
description: "Prüfungen von Belegt ausführen (Typen, Lint, Vitest mit Postgres, Playwright, Build, Doku). Vor jedem Push, im Review und wenn Bun, PostgreSQL oder ein Werkzeug für die Tests fehlt."
---

# Prüfungen

Vor jedem Push grün, danach die CI prüfen. Einrichtung, Umgebungsvariablen und Migrationen stehen in
`docs/entwicklung.md`.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint             # Biome und checks (Dateigröße, Zyklen, Texte)
TEST_DATABASE_URL=postgres://belegt:belegt@localhost:5432/belegt_test bun run test
bun run build
bun run e2e              # bei Änderungen an der Oberfläche
zensical build --strict  # wenn docs/ oder mkdocs.yml geändert sind (pip install -r requirements-docs.txt)
```

- Die Testdatenbank wird geleert: nie auf eine Datenbank mit echten Daten zeigen lassen. Was GoBD betrifft (Siegel,
  Hash-Kette, Fristen, Löschung), läuft immer gegen Postgres.
- Ohne `TEST_DATABASE_URL`, ohne Tesseract und `pdftoppm` (OCR) oder ohne Validator für E-Rechnungen
  (`VALIDATOR_TEST_URL`) werden Tests übersprungen. Das gehört mit Grund in die Beschreibung des Pull Requests, nie als
  bestanden; die CI hat alles.
- `bun run test` startet Vitest; `bun test` wäre Buns eigener Runner.
- Für Tests andere Ports nehmen als ein laufender Dev-Server; laufende Prozesse nicht stoppen.

Die Regeln am Pull Request selbst (Titel, `Umgesetzt`/`Refs`, neue Abhängigkeiten, lange Funktionen) prüft vor dem
Push die Werkbank, siehe Skill `beitrag`.
