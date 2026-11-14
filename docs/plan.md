# Plan für die Umsetzung

Belegt ist eine selbst gehostete Ablage für alle Dokumente, wie paperless, mit einem GoBD-Modus für das, was aufbewahrt werden muss. Mails und E-Rechnungen sind vollwertige Dokumente, nicht nur Anhänge.

Nicht Teil von Belegt: Buchhaltung (Haben), Mail lesen und schreiben (Kontext), Dokumente bearbeiten (Schreibzeug). Eine Zertifizierung gibt es für GoBD nicht; möglich ist später ein Testat nach IDW PS 880.

## Grundsätze

1. **Lose Kopplung:** Im Code von Belegt steht nirgends `haben` oder `kontext`. Belegt bietet offene Schnittstellen an; jedes Produkt baut seine Anbindung bei sich. Braucht ein Produkt mehr, wird die Schnittstelle allgemein erweitert.
2. **Nichts geht verloren:** Was ankommt, wird zuerst roh gespeichert (Hash, dann Audit-Eintrag), erst danach zerlegt und erkannt.
3. **Unveränderbar durch die Datenbank, nicht durch den Code:** Trigger in Postgres, getrennte Rollen, Hash-Kette. Fehler im Code oder SQL von Hand können nichts ändern.
4. **Wenige Abhängigkeiten auf dem Server:** Belegt muss über 10 Jahre laufen. In der Oberfläche sind die Pakete von Kontext erlaubt.
5. **Dieselben Regeln wie Haben:** Bun, Funktionen statt Klassen, Schreiben über `withActor`, Audit-Trigger für jede Tabelle, Tests für jede Änderung.

**Deutsch zuerst, international vorbereitet:** Name, Recht und Marketing sind deutsch. Die Oberfläche gibt es von Anfang an auf Deutsch und Englisch mit Paraglide JS (`@inlang/paraglide-js`), wie in Kontext. Fristen sind ein Länderprofil: Deutschland zuerst, Österreich und Schweiz später.

## Architektur

```
Mailserver (SMTP-Journal) ─┐
Postfächer (IMAP, JMAP) ───┼─▶ Worker: roh speichern → zerlegen → OCR, E-Rechnung prüfen ─┐
Ordner, Upload, Handy-Scan ┘                                                            ├─▶ gobd-kern ─▶ Postgres (Trigger, Kette, Siegel, Rollen)
Apps und Nutzer ──────────────▶ Web-Server (Hono): REST-API, Webhooks, OIDC, Einbetten ──┘             └▶ Dateispeicher (SHA-256, Dateisystem oder S3 mit Object Lock)
```

## Stack und Testautomatisierung

Belegt nutzt denselben Stack und dieselben Prüfungen wie Haben, Kontext und Schreibzeug. Kein Push ohne grüne Prüfungen; CI auf GitHub Actions führt alle bei jedem Pull Request aus.

| Bereich | Werkzeug | Wie in |
| --- | --- | --- |
| Laufzeit, Pakete | Bun (`bun run test`, nie `bun test`) | allen drei |
| Server | Hono, Zod | Kontext, Schreibzeug |
| Datenbank | Postgres, Drizzle, Migrationen mit drizzle-kit | Haben |
| Anmeldung | Better Auth, OpenID Connect | allen drei |
| Oberfläche | React, TanStack Router und Query, Vite, Tailwind, Radix, Geist | Kontext, Schreibzeug |
| Übersetzung | Paraglide JS, Deutsch und Englisch | Kontext |
| Lint und Format | Biome, TypeScript `tsc --noEmit` | allen drei |
| Unit-Tests | Vitest, Testing Library für Komponenten | allen drei |
| Tests gegen Postgres | Vitest neben dem Modul, eigene Testdatenbank je Lauf, nie echte Daten | Haben |
| End-to-End | Playwright, eigene Ports, `--trace off` | allen drei |
| Barrierefreiheit | `@axe-core/playwright` in den E2E-Tests | Haben, Kontext |
| Regeln per Skript | Modulgrenzen, Dateigröße (~400 Zeilen) | Haben |
| Mail-Tests | Test-SMTP-Server im Compose der Tests | Kontext |
| Container | Dockerfile, Compose für Entwicklung und Tests | allen drei |

Was GoBD betrifft (Sperren, Kette, Löschlauf), wird immer gegen Postgres getestet, nie nur mit Mocks. Ein Fehler beginnt mit einem roten Test. Vor jedem Merge ein unabhängiges Review durch einen eigenen Agenten.

## GoBD-Kern aus Haben

Der Kern wird in Haben als Paket `packages/gobd-kern` herausgelöst ([firsttris/haben#935](https://github.com/firsttris/haben/issues/935)). Er erscheint nicht auf npm, sondern als Datei an einem Release von Haben (Tag `gobd-kern-vX.Y.Z`); Belegt installiert ihn über deren URL, `bun.lock` hält den Hash fest.

- **TypeScript** (Speicher unter SHA-256, `withActor`, Prüfung von Kette und Siegeln, `index.xml` nach dem Beschreibungsstandard) gibt es einmal; Belegt installiert das Paket mit fester Version.
- **SQL** (Trigger, Kette, Siegel, Sperre gegen `TRUNCATE`) kommt als Vorlage aus dem Paket und wird einmal in die erste Migration von Belegt übernommen. Haben behält seine bestehenden Migrationen unverändert.
- **E-Rechnung:** Belegt liest die Kopfdaten selbst (EN 16931, CII und UBL, auch in ZUGFeRD); geprüft wird die Rechnung nicht.

## Phasen

| Phase | Inhalt | Fertig, wenn |
| --- | --- | --- |
| 0 · Kern in Haben herauslösen | `packages/gobd-kern`, Haben importiert vom Paket | alle Tests von Haben grün, Paket als Datei am Release |
| 1 · Grundgerüst | Repo, Stack, CI, Datenmodell, Upload mit OCR, Archivliste, Dokumentseite, Volltextsuche | ein Upload landet unverändert, Prüfung grün |
| 2 · Eingang und Fristen | Einordnung in Pflicht, freiwillig, frei; Regeln; Sperren; Löschlauf mit zweiter Person | Kette nach einem Löschlauf weiter gültig |
| 3 · E-Mail | Worker: SMTP-Journal, IMAP, JMAP, Import aus MBOX und EML; Microsoft 365, Google | jede Mail eines Testpostfachs im Archiv |
| 4 · E-Rechnung und Schnittstellen | XRechnung, ZUGFeRD; REST-API mit OpenAPI, Webhooks, Tokens, Einbetten, MCP | eine fremde App liefert ohne Sondercode ein |
| 5 · Prüfung | Prüferzugang (Z1), Datenträger-Export (Z3), Prüfbericht, Verfahrensdokumentation | Z3-Export entspricht dem Beschreibungsstandard |
| 6 · Später | S3 mit Object Lock, RFC 3161, PST, Mandanten, KI-Regeln, Testat | nach Bedarf |

Stand im November 2026:

- **Fertig:** Phasen 1 bis 5: SMTP-Journal, IMAP, JMAP, Microsoft 365 und Google per OAuth, MBOX und EML;
  XRechnung und ZUGFeRD, REST-API mit OpenAPI, Webhooks, Tokens, Einbetten mit OIDC und MCP; Prüferzugang, Z3-Export,
  Prüfbericht und Verfahrensdokumentation. Dazu Texterkennung, Container und Compose.
- **Offen:** Phase 6.

## Anbindung der Produkte

| Produkt | Was es bei sich baut | Schnittstelle von Belegt |
| --- | --- | --- |
| Haben | Webhook „E-Rechnung eingegangen“ legt einen Beleg an; festgeschriebene Rechnungen werden eingeliefert | REST-API, Webhooks, Token |
| Kontext | Menüpunkt „Archiv“ im Frame wie „Dokumente“; Stalwart schickt das Journal | OIDC, Einbetten mit `postMessage`, SMTP-Journal |
| Schreibzeug | „Fassung ins Archiv“ | REST-API |
| Fremde Apps | eigene Anbindung | REST-API mit OpenAPI, Webhooks, MCP |

Vorlage für Einbetten und Anmeldung ist Schreibzeug (`docs/kontext.de.md` dort).

## Offene Entscheidungen

- [ ] Lizenz: AGPL wie Haben, Kontext und Schreibzeug?
- [ ] Journal aus Stalwart: wie Stalwart jede ein- und ausgehende Mail als Kopie weitergibt, ist noch nicht geprüft.
- [ ] Speicher: ab wann S3 mit Object Lock Pflicht wird.
