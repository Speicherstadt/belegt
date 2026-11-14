# Sicherheit

## Unterstützte Versionen

Sicherheitsfixes gibt es nur für das neueste Release. Bitte vor einer Meldung auf die neueste Version aktualisieren
([Aktualisieren](docs/betrieb.md#aktualisieren)).

| Version | Unterstützt |
| --- | --- |
| [neuestes Release](https://github.com/firsttris/belegt/releases/latest) | ja |
| ältere Releases | nein |

## Eine Lücke melden

Bitte **kein öffentliches Issue** für ein Sicherheitsproblem. Melde es privat über GitHub:
[Security › Report a vulnerability](https://github.com/firsttris/belegt/security/advisories/new).

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

## Abhängigkeiten aktuell halten

Die Abhängigkeiten hält [Renovate](https://github.com/apps/renovate) aktuell (`.github/renovate.json5`). Jedes
Update kommt als Pull Request und läuft durch die ganze CI, auch die Tests gegen PostgreSQL; `bun audit` prüft bei
jedem Lauf auf bekannte Lücken.
