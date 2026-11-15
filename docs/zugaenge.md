---
title: "Zugänge und Mitarbeiter"
description: >-
  Wer auf Belegt zugreift: Inhaber, Steuerberatung, Prüfer und Mitarbeiter mit Sichtbereich nach Tags, Dokumenttypen und Korrespondenten.
---

# Zugänge

Unter **Zugänge** lädt der Inhaber weitere Personen ein; der Link gilt 72 Stunden und einmal. Jeder Zugang hat eine
Rolle:

| Rolle | Sieht | Darf |
| --- | --- | --- |
| Inhaber | alles | alles; genau einer, das erste Konto |
| Steuerberatung | alles | lesen, Löschungen als zweite Person bestätigen, Notizen |
| Prüfer | Dokumente seines Zeitraums ([Prüfung](pruefung.md#prüferzugang-z1)) | lesen, Z3-Export, Prüfung |
| Mitarbeiter | Dokumente seines Sichtbereichs | lesen; mit dem Recht „bearbeiten“ auch aufnehmen und ordnen |

Bei jedem Konto außer dem Inhaber steht **Entziehen**: Seine Sitzungen enden, anmelden kann er sich nicht mehr, im
Protokoll und in der [Verfahrensdokumentation](verfahrensdoku.md) bleibt er mit dem Tag des Entzugs stehen.

## Mitarbeiter { #mitarbeiter }

Für Mitarbeiter wählst du beim Einladen ein Recht und einen Sichtbereich; beides lässt sich später mit
**Sichtbereich ändern** anpassen und gilt sofort. Jede Änderung steht mit dir als Akteur im Protokoll.

Der Sichtbereich besteht aus erlaubten Tags, Dokumenttypen und Korrespondenten
([Ordnung](ordnung.md)). Innerhalb einer Art genügt einer davon, zwischen den Arten müssen alle passen; eine Art ohne
Auswahl schränkt nicht ein. Dazu kommen:

- **Ausgeschlossene Tags**: Ein Dokument mit einem davon sieht der Mitarbeiter nie, auch wenn es sonst passt.
- **Auch Dokumente ohne Tag, Typ und Korrespondent**: etwa damit er den Eingang mit abarbeitet.

Beispiele:

| Gewünscht | Sichtbereich |
| --- | --- |
| alles außer Personalunterlagen | ausgeschlossener Tag „Personal“, sonst nichts gewählt |
| Eingangsrechnungen von Projekt X | Dokumenttyp „Eingangsrechnung“ und Tag „Projekt X“ |
| Rechnungen der Stadtwerke und der Telekom | Korrespondenten „Stadtwerke“ und „Telekom“ |

Ein Dokument außerhalb gibt es für den Mitarbeiter nicht: Er findet es weder in Liste, Suche und Startseite noch über
seine Adresse (`404`), Zahlen bei Tags, Typen und Korrespondenten zählen nur seine Dokumente, ähnliche Dokumente,
Ableitungen und Mails zeigen nur, was in seinem Sichtbereich liegt. Von Tags, Typen und Korrespondenten sieht er die
erlaubten, oder alle außer den ausgeschlossenen Tags, wenn für die Art nichts gewählt ist; Vorschläge nennen nur diese.

Mit dem Recht **lesen** öffnet und lädt er Dokumente herunter und liest Notizen. Mit **bearbeiten** nimmt er
zusätzlich Dokumente auf, ordnet sie ein, setzt Tags, Typ, Korrespondent und Felder (auch für mehrere zugleich) und
schreibt Notizen. Eine Änderung, nach der das Dokument außerhalb seines Sichtbereichs läge, lehnt Belegt ab und ändert
nichts; das darf nur der Inhaber. Was er selbst hochlädt, sieht er, bis es eine Ordnung bekommt; danach gilt sein
Sichtbereich wie für alle anderen Dokumente.

Nie: Löschung beantragen oder bestätigen, Sperren, Fristen, Prüfung, Z3-Export, Seiten bearbeiten, teilen per Link,
„Öffnen mit …“, Mails importieren, Tags und andere Listen anlegen oder ändern, Regeln, Workflows, Quellen, Import aus
Paperless-ngx, Einstellungen, Zugänge, API-Tokens, Webhooks und MCP. API-Tokens gehören dem Inhaber und sehen alle
Dokumente; Mitarbeiter bekommen keine.

## Wie Belegt das durchsetzt

Welche Dokumente ein Zugang sieht, entscheidet eine Stelle (`server/zugang/sicht.ts`), für den Zeitraum des Prüfers
und den Sichtbereich des Mitarbeiters: Liste, Suche, Zahlen und alle anderen Abfragen nehmen ihre Bedingung, und vor
jedem Aufruf unter `/api/dokumente/:id/…` prüft die Anmeldung das Dokument. Was ein Mitarbeiter überhaupt aufrufen
darf, steht in einer Liste (`server/zugang/mitarbeiter.ts`); alles andere lehnt der Server ab. Ein Test führt jede
Route der Schnittstelle auf und prüft jede mit einem Dokument außerhalb des Sichtbereichs, eine neue Route fällt dort
auf, bis sie eingeordnet ist.
