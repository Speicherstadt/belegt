---
title: "Verfahrensdokumentation"
description: >-
  Die Verfahrensdokumentation nach GoBD erzeugt Belegt aus dem tatsächlichen Stand und deinen Angaben zum Betrieb.
---

# Verfahrensdokumentation

Unter **Verfahrensdoku** erzeugt Belegt die Verfahrensdokumentation (GoBD Rz. 151 ff.) bei jedem Aufruf neu:
Erfassung, Einordnung und Fristen, Unveränderbarkeit (mit der Datenbankanmeldung der App und ihren wirksamen
Rechten je Art von Tabelle), Löschung, Zugriff und Betrieb mit der Datensicherung: Ziel, Rhythmus, letzte
Sicherung und letzter Test-Restore, wie der [Backup-Container](betrieb.md#sichern) sie eingetragen hat. Was Belegt selbst tut, Postfächer,
Eingangsordner, Regeln, [Zuordnungsregeln und gelernte Vorschläge](ordnung.md#zuordnungsregeln) mit dem Stand des
letzten Lernens, aktive [Workflows](workflows.md) mit Auslöser, Bedingungen und Aktionen, Sperren, Zugänge (Mitarbeiter mit Recht und [Sichtbereich](zugaenge.md#mitarbeiter)) und API-Tokens stehen darin, wie sie gerade eingerichtet sind, dazu jeder
[Import aus Paperless-ngx](umzug.md) mit Zeitpunkt, Quelle, Zahlen und dem Abgleich der Prüfsummen.

Was nur du wissen kannst, trägst du unter **Angaben zum Betrieb** ein (nur der Inhaber; die Steuerberatung liest):
Name, Anschrift, wer verantwortlich ist, Datensicherung und Scannen. Fehlt davon etwas, steht im Dokument „Fehlt: …“.
Jede Änderung steht im Protokoll.

„Kredit- oder Wertpapierinstitut oder unter Versicherungsaufsicht“ verlängert die Frist für Buchungsbelege von 8 auf
10 Jahre (Art. 97 § 19a Abs. 3 EGAO), für Einordnungen ab dann; frühere behalten ihre Frist. Name und Anschrift stehen
auch als Datenlieferant in der `index.xml` des Z3-Exports.

Zum Weitergeben druckst du die Seite oder sicherst sie als PDF; Navigation und Formular erscheinen dabei nicht.
