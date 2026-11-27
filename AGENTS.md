# Hinweise für Coding-Agenten

Belegt: selbst gehostetes Dokumentenarchiv mit GoBD-Modus (Mails, E-Rechnungen, Scans, beliebige Dokumente;
Pflicht, freiwillig mit Frist, frei). Server in `server/` (Hono, Postgres), Oberfläche in `src/` (React).

Die Regeln stehen einmal: Beitragen in [`docs/mitwirken.md`](docs/mitwirken.md), Befehle und Tests in
[`docs/entwicklung.md`](docs/entwicklung.md), der Plan in [`docs/plan.md`](docs/plan.md), die Oberfläche in
[`DESIGN.md`](DESIGN.md). Diese Datei sagt, wo was steht und was nie passieren darf. Sie gilt für jeden Agenten;
`CLAUDE.md` verweist nur hierher.

## Skills

Die Schritte für wiederkehrende Aufgaben stehen in [`.agents/skills`](.agents/skills); jeder Agent folgt denselben
Dateien. Aus der [Werkbank](https://github.com/Speicherstadt/werkbank) (gleich in allen Projekten, Änderungen dort):
`beitrag` (Branch, Commits, Pull Request als Entwurf, dann Selbstprüfung und Review), `beitrag-pruefen` (gewollt,
Quellen, einfachste Lösung, Regeln), `tdd-review` (unabhängiges Review, ein Befund braucht einen fehlschlagenden
Test), `doku-pruefen` (Review des Markdowns), `fork-pushen` (Push auf den Fork einer anderen Person),
`prs-abarbeiten` (alle offenen Pull Requests, vom einfachsten Merge an), `issue-schreiben`, `board-pflegen` (das
Board auf GitHub), `release`, `fehler-eingrenzen` (Ursache eines Fehlers über eine rote Prüfung finden) und
`vorhaben-klaeren` (einen Plan vor dem Bauen mit der Person durchfragen). Aus diesem Projekt: `checks` (alle Prüfungen, mit Postgres).

## Nie

- Belegt nennt keine andere App im Code (`haben`, `kontext`, `schreibzeug`): Andere Apps nutzen offene Schnittstellen.
- Unveränderbarkeit nur im App-Code: Sperren, Hash-Kette und Siegel liegen in Postgres (Trigger, getrennte Rollen).
- Eine bestehende Migration ändern oder `drizzle/meta/` von Hand schreiben.
- Ein Geheimnis im Klartext speichern oder loggen.
- Floats für Geld: Beträge in ganzen Cent.
- Tests auf eine Datenbank mit echten Daten zeigen lassen; einen Test überspringen, abschwächen oder löschen, um grün
  zu werden; einen übersprungenen Test als bestanden melden.
- Auf `main` pushen (Ausnahme: Reparatur eines roten `main` durch oder auf Anweisung des Maintainers), Commits von
  Beitragenden umschreiben, mergen (nur Maintainer oder Collaborator mit dessen Zustimmung), eigenen Code reviewen.
- Issues und Pull Requests ohne Auftrag anlegen oder kommentieren.
- Eine Abhängigkeit hinzufügen, ohne zuerst eigenen Code zu versuchen und den Grund je Paket unter
  „## Neue Abhängigkeiten“ im Pull Request zu nennen.
- Prozesse der Nutzerin oder des Nutzers stoppen; `sudo` umgehen.

## Bei jeder Änderung

- Tests für das Geänderte: Vitest, Tests gegen Postgres neben dem Modul, Playwright für das, was jemand klickt; ein
  Fehler beginnt mit einem roten Test. Was GoBD betrifft, immer gegen Postgres.
- Prüfungen grün vor jedem Push (Skill `checks`), Übersprungenes melden; danach die CI prüfen.
- Texte der Oberfläche über Paraglide (Deutsch und Englisch), nie fest im Code.
- Oberfläche nach `DESIGN.md`; ändert sich eine Regel, ändert sich die Datei im selben Pull Request.
- Doku in `docs/` im selben Pull Request, kurz und für Menschen.
- Jede berührte Datei sauberer hinterlassen, ohne das Verhalten zu ändern, und unter „Aufgeräumt“ nennen.
- Issues mit `Umgesetzt #…` oder `Refs #…`, nie `Closes`/`Fixes`.
- Die Beschreibung des Pull Requests wird die Squash-Nachricht: bei jedem Push nachziehen, der etwas daran ändert.
- Vor dem Merge ein unabhängiges Review durch einen eigenen Agenten: `tdd-review` für Code, `doku-pruefen` für Markdown.

## Arbeitsweise

- Deutsch für Kommentare, Doku, Commits, Pull Requests und alles, was Nutzer sehen; Bezeichner auf Englisch.
- Funktional, keine Klassen; Dateien über ~400 Zeilen und Funktionen über ~80 Zeilen werden geteilt.
- Bun, nicht Node, npm oder pnpm: `bun run test` startet Vitest, `bun test` wäre Buns eigener Runner.
- Der GoBD-Kern kommt als Paket `@firsttris/gobd-kern` aus dem Repo von Haben, nicht als Kopie im Code.
- Fremde, nicht committete Änderungen gehören jemand anderem (oft einem anderen Agenten): beim eigenen Umfang bleiben.
