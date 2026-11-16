# Mitwirken an Belegt

Issues und Pull Requests sind willkommen. Belegt ist ein selbst gehostetes Dokumentenarchiv mit GoBD-Modus. Wie du es
lokal startest und testest, steht in der [Entwicklung](docs/entwicklung.md). Für alle, die mitmachen, gilt unser
[Verhaltenskodex](CODE_OF_CONDUCT.md).

## Fehler und Wünsche melden

Neues Issue über die Formulare: [Issue anlegen](https://github.com/firsttris/belegt/issues/new/choose). **Keine echten
Dokumente, Mails, Adressen oder Zugangsdaten** in Issues, Screenshots oder Logs. Sicherheitslücken bitte privat melden,
siehe [SECURITY.md](SECURITY.md).

## Pull Requests

- Ein Thema je Pull Request, auf einem eigenen Branch, in `main`.
- Im selben Pull Request mitändern, was die Änderung betrifft: Tests (Vitest, Tests gegen Postgres neben dem Modul,
  Playwright in `e2e/` für das, was jemand klickt), die Doku in `docs/`. Ein Fehler beginnt mit einem roten Test.
- Was GoBD betrifft (Siegel, Hash-Kette, Fristen, Löschung), immer gegen Postgres testen; Unveränderbarkeit gehört in
  die Datenbank, nicht nur in den Code.
- Keine bestehende Migration ändern; neue mit `bun --bun drizzle-kit generate --name <name>`.
- Texte der Oberfläche über Paraglide, Deutsch und Englisch. Die Oberfläche folgt der [Gestaltung](DESIGN.md): Zielgrößen,
  Schrift, Fokus, Bestätigung, Meldungen.
- Vor dem Push: `bun run typecheck`, `bun run lint`, `bun run test`, bei Änderungen an der Oberfläche `bun run e2e`.
- Mit einem KI-Werkzeug geschriebene Beiträge sind willkommen; du verantwortest sie wie eigenen Code und nennst das
  Werkzeug im Pull Request.

Die Regeln für Agenten stehen in [CLAUDE.md](CLAUDE.md).

## Lizenz

Mit einem Beitrag stellst du ihn unter die [AGPL-3.0](LICENSE).
