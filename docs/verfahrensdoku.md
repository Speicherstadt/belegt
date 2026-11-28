---
title: "Verfahrensdokumentation"
description: >-
  Die Verfahrensdokumentation nach GoBD erzeugt Belegt aus dem tatsächlichen Stand und deinen Angaben zum Betrieb.
---

# Verfahrensdokumentation

Unter **Verfahrensdokumentation** erzeugt Belegt die Verfahrensdokumentation (GoBD Rz. 151 ff.) bei jedem Aufruf neu:
Erfassung, Einordnung und Fristen, Unveränderbarkeit (mit der Datenbankanmeldung der App und ihren wirksamen
Rechten je Art von Tabelle), Löschung, Zugriff und Betrieb mit der Datensicherung: Ziel, Rhythmus, letzte
Sicherung und letzter Test-Restore, wie der [Backup-Container](betrieb.md#sichern) sie eingetragen hat, und die
[Benachrichtigungen](betrieb.md#benachrichtigungen) mit ihren eingeschalteten Anlässen. Zur Erfassung gehören die
Erkennung [doppelter Dateien](eingang.md#doppelte-dateien) und, wenn eingerichtet, die [Prüfung von
E-Rechnungen](betrieb.md#erechnung-pruefen) mit dem KoSIT-Validator. Was Belegt selbst tut, Postfächer,
Eingangsordner, Regeln, [Zuordnungsregeln und gelernte Vorschläge](ordnung.md#zuordnungsregeln) mit dem Stand des
letzten Lernens, aktive [Workflows](workflows.md) mit Auslöser, Bedingungen und Aktionen (beim [Senden des Originals](workflows.md#original-an-adresse-senden) mit Ziel und Dateifeld, nie dem Wert der Kopfzeile), Sperren, die [tägliche Prüfung der Kette](pruefung.md#taegliche-pruefung) mit ihrem letzten Lauf, Zugänge (Mitarbeiter mit Recht und [Sichtbereich](zugaenge.md#mitarbeiter), je Zugang der [zweite Faktor](zugaenge.md#zwei-faktor), dazu für welche Rollen er Pflicht ist) und API-Tokens stehen darin, wie sie gerade eingerichtet sind, ebenso der [Download als ZIP](ordnung.md#zip) mit seinen Grenzen und jeder
[Import aus Paperless-ngx](umzug.md) mit Zeitpunkt, Quelle, Zahlen und dem Abgleich der Prüfsummen.

Die Seite hat zwei Reiter: **Angaben** (das Formular) und **Dokument** (die fertige Fassung). Sie öffnet die
Angaben, solange etwas fehlt, sonst das Dokument.

Was nur du wissen kannst, trägst du unter **Angaben** ein (nur der Inhaber; die Steuerberatung liest):
Name, Rechtsform, Anschrift, wer verantwortlich ist und wer vertritt, Ort der Aufbewahrung, Betrieb des Servers,
Datensicherung, Ablage von Schlüsseln und Passwörtern (nur der Ort), Papierbelege und Scannen, dazu Ergänzungen. Fehlt
davon etwas, steht im Dokument „Fehlt: …“. Jede Änderung steht im Protokoll.

„Kredit- oder Wertpapierinstitut oder unter Versicherungsaufsicht“ verlängert die Frist für Buchungsbelege von 8 auf
10 Jahre (Art. 97 § 19a Abs. 3 EGAO), für Einordnungen ab dann; frühere behalten ihre Frist. Name und Anschrift stehen
auch als Datenlieferant in der `index.xml` des Z3-Exports.

Zum Weitergeben druckst du im Reiter **Dokument** die Seite oder sicherst sie als PDF; Navigation und Formular erscheinen dabei nicht. **Als
Markdown** lädt dieselbe Fassung als Textdatei herunter, mit Stand (Tag, Programm und Version) und jeder offenen Lücke.

Gliederung, Angaben zum Betrieb, die Texte zu Sperren, Audit-Log, Hash-Kette, Siegeln, Prüfung, Prüfwert, Dateispeicher
und Datenbankanmeldung sowie die Markdown-Ausgabe kommen aus dem GoBD-Kern (`@firsttris/gobd-kern`), dessen SQL-Vorlage
auch Belegts Datenbank schützt; was nur Belegt betrifft, steht dahinter.
