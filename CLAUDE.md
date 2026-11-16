# Hinweise für Claude

Belegt: selbst gehostetes Dokumentenarchiv mit GoBD-Modus (Mails, E-Rechnungen, Scans, beliebige Dokumente;
Pflicht, freiwillig mit Frist, frei). Server in `server/` (Hono, Postgres), Oberfläche in `src/` (React).
Der Plan steht in `docs/plan.md`, Befehle und Tests in `docs/entwicklung.md`.

## Nie

- Belegt nennt keine andere App im Code (`haben`, `kontext`, `schreibzeug`): Andere Apps nutzen offene Schnittstellen.
- Unveränderbarkeit nur im App-Code: Sperren, Hash-Kette und Siegel liegen in Postgres (Trigger, getrennte Rollen).
- Eine bestehende Migration ändern oder `drizzle/meta/` von Hand schreiben.
- Ein Geheimnis im Klartext speichern oder loggen.
- Tests auf eine Datenbank mit echten Daten zeigen lassen; einen Test überspringen oder abschwächen, um grün zu werden.
- Floats für Geld: Beträge in ganzen Cent.

## Bei jeder Änderung

- Tests für das Geänderte: Vitest, Tests gegen Postgres neben dem Modul, Playwright für das, was jemand klickt; ein
  Fehler beginnt mit einem roten Test. Was GoBD betrifft, immer gegen Postgres.
- `bun run typecheck`, `bun run lint`, `bun run test` grün vor jedem Push; Übersprungenes melden.
- Texte der Oberfläche über Paraglide (Deutsch und Englisch), nie fest im Code.
- Oberfläche nach `DESIGN.md`; ändert sich eine Regel, ändert sich die Datei im selben Commit.
- Doku in `docs/` im selben Commit, kurz und für Menschen.

## Arbeitsweise

- Deutsch für Kommentare, Doku, Commits und alles, was Nutzer sehen; Bezeichner auf Englisch.
- Funktional, keine Klassen; Dateien über ~400 Zeilen und Funktionen über ~80 Zeilen werden geteilt.
- Bun, nicht Node, npm oder pnpm: `bun run test` startet Vitest, `bun test` wäre Buns eigener Runner.
- Der GoBD-Kern kommt als Paket `@firsttris/gobd-kern` aus dem Repo von Haben, nicht als Kopie im Code.
