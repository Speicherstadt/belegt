# Sicherheit

## Unterstützte Versionen

Sicherheitsfixes gibt es nur für das neueste Release. Bitte vor einer Meldung auf die neueste Version aktualisieren
([Aktualisieren](docs/betrieb.md#aktualisieren)).

| Version | Unterstützt |
| --- | --- |
| [neuestes Release](https://github.com/Speicherstadt/belegt/releases/latest) | ja |
| ältere Releases | nein |

## Eine Lücke melden

Bitte **kein öffentliches Issue** für ein Sicherheitsproblem. Melde es privat über GitHub:
[Security › Report a vulnerability](https://github.com/Speicherstadt/belegt/security/advisories/new).

Eine gute Meldung nennt die Version, wie sich das Problem nachstellen lässt und was ein Angreifer damit erreicht. Keine
echten Dokumente, Mails oder Zugangsdaten mitschicken. Wir bestätigen die Meldung, arbeiten den Fix in einem privaten
Security Advisory aus und veröffentlichen es mit dem Release, das ihn behebt.

Belegt verwahrt Dokumente, die aufbewahrt werden müssen, dazu Zugänge zu Postfächern und Tokens für andere Programme.
Besonders wichtig sind deshalb Lücken

- bei Anmeldung, Rollen, Prüferzugang und API-Tokens,
- beim Schutz des Archivs (Siegel, Hash-Kette, Löschregeln, Object Lock),
- bei gespeicherten Geheimnissen (Postfach-Passwörter, Refresh-Tokens, Webhook-Geheimnisse),
- bei allem, was von außen hereinkommt: Uploads, Mails, SMTP-Journal, PST, E-Rechnungen, Webhooks und MCP.

Probleme in PostgreSQL, Tesseract, Poppler oder anderen eingebundenen Programmen gehören zu diesen Projekten; macht
erst die Konfiguration von Belegt sie ausnutzbar, bitte hier melden.

## Getrennte Datenbankrollen

Mit [getrennten Rollen](https://belegt.net/betrieb.html#getrennte-datenbankrollen) arbeitet die App als
Rolle ohne Eigentum an Tabellen und ohne Rechte, Trigger abzuschalten, Tabellen zu ändern oder zu leeren oder den
Replikationsmodus zu setzen. Nur der Migrationsschritt nutzt den Eigentümer und vergibt danach die Rechte neu; der
Server bekommt dessen Adresse nicht. Eine übernommene App kann so nur, was auch die Oberfläche kann, und die Trigger
prüfen es weiter. Gegen den Betreiber mit Eigentümer- oder Serverzugang helfen Zeitstempel, notierte Prüfwerte und
Sicherungen an einem zweiten Ort. Bestehende Installationen mit einer Adresse laufen weiter; „Prüfung“ zeigt die
wirksamen Rechte und warnt.

## Abhängigkeiten aktuell halten

Die Abhängigkeiten hält [Renovate](https://github.com/apps/renovate) aktuell (`.github/renovate.json5`). Jedes
Update kommt als Pull Request und läuft durch die ganze CI, auch die Tests gegen PostgreSQL; `bun audit` prüft bei
jedem Lauf auf bekannte Lücken.
