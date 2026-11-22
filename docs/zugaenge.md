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


Die Sicht ist eine Bedingung in derselben Datenbankabfrage wie die Liste, keine Auswertung je Dokument danach. Ein
Mitarbeiter wartet deshalb auf seine Liste kaum länger als der Inhaber; `server/zugang/sicht-leistung.test.ts` misst
das bei einigen hundert Dokumenten.

## Zwei-Faktor { #zwei-faktor }

Unter **Konto** (unten in der Seitenleiste) richtet jede Person ihren zweiten Faktor selbst ein:

- **Authenticator-App (TOTP)**: Passwort eingeben, den QR-Code scannen (Belegt erzeugt ihn selbst) und mit einem Code
  bestätigen. Danach zeigt Belegt zehn Backup-Codes einmal an, zum Herunterladen als Textdatei; jeder gilt einmal, wenn
  die App fehlt. Neue Backup-Codes und Entfernen verlangen das Passwort.
- **Passkey**: mit Namen hinzufügen (Fingerabdruck, Gesicht, Sicherheitsschlüssel), umbenennen, entfernen.

Bei der Anmeldung fragt Belegt nach dem Passwort den Code aus der App oder einen Backup-Code; „Passkey verwenden“
meldet ohne Passwort an. Wer Passkeys, aber kein TOTP hat, meldet sich nur mit dem Passkey an. Je Anmeldung gelten fünf
Codes, je Adresse fünf in der Minute; nach zehn falschen ist der zweite Faktor 15 Minuten gesperrt.

Unter **Zugänge → Zwei-Faktor-Anmeldung** legt der Inhaber fest, für welche Rollen ein zweiter Faktor Pflicht ist. Wer
dann keinen hat, sieht nach der Anmeldung nur die Einrichtung, bis TOTP oder ein Passkey eingerichtet ist; alle anderen
Aufrufe lehnt der Server ab. Wer sich über den OIDC-Anbieter anmeldet ([Einbetten](einbetten.md)), braucht keinen
eigenen zweiten Faktor; dafür ist der Anbieter zuständig.

Hat jemand Telefon und Backup-Codes verloren, setzt der Inhaber unter **Zugänge** seinen zweiten Faktor zurück: TOTP,
Backup-Codes und Passkeys sind weg, die Sitzungen enden, im Protokoll steht der Inhaber. Seinen eigenen setzt er mit
einem Backup-Code zurück, im Notfall mit dem Eigentümerzugang der Datenbank auf dem Server:

```sh
docker compose exec server bun server/zugang/notfall.ts inhaber@firma.de
```

Das Skript läuft nur mit `MIGRATION_DATABASE_URL` ([getrennte Rollen](betrieb.md#getrennte-datenbankrollen)) und steht
als `system:notfall` im Protokoll. TOTP-Geheimnis und Backup-Codes speichert Belegt verschlüsselt mit
`BETTER_AUTH_SECRET` und nie im Protokoll; von einem Passkey nur den öffentlichen Schlüssel. Die
[Verfahrensdokumentation](verfahrensdoku.md) nennt je Zugang den zweiten Faktor und die Pflicht.

## Mitarbeiter { #mitarbeiter }

Für Mitarbeiter wählst du beim Einladen ein Recht und einen Sichtbereich; beides lässt sich später mit
**Sichtbereich ändern** anpassen und gilt sofort. Jede Änderung steht mit dir als Akteur im Protokoll.

Der Sichtbereich besteht aus erlaubten Tags, Dokumenttypen und Korrespondenten
([Ordnung](ordnung.md)). Innerhalb einer Art genügt einer davon, zwischen den Arten müssen alle passen; eine Art ohne
Auswahl schränkt nicht ein. Dazu kommen:

- **Ausgeschlossene Tags**: Ein Dokument mit einem davon sieht der Mitarbeiter nie, auch wenn es sonst passt. Löschst
  du einen solchen Tag, verlieren seine Dokumente ihn, und der Mitarbeiter sieht sie, wenn sie sonst passen; beim
  Löschen weist Belegt darauf hin.
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

Mail und Anhänge gibt es nur gemeinsam: Die Datei einer Mail (`.eml`) enthält ihre Anhänge, deshalb sieht er eine Mail
nur, wenn auch jeder ihrer Anhänge in seinem Sichtbereich liegt, auch einer, der als schon vorhandenes Dokument
[verweist](eingang.md#doppelte-dateien). Einen sichtbaren Anhang einer Mail außerhalb findet die
Suche nur über seinen eigenen Text, nicht über Absender und Betreff der Mail. Für Prüfer gilt dasselbe mit ihrem
Zeitraum.

Mit dem Recht **lesen** öffnet und lädt er Dokumente herunter und liest Notizen. Mit **bearbeiten** nimmt er
zusätzlich Dokumente auf, ordnet sie ein, setzt Tags, Typ, Korrespondent und Felder (auch für mehrere zugleich) und
schreibt Notizen. Eine Änderung, nach der das Dokument außerhalb seines Sichtbereichs läge, lehnt Belegt ab und ändert
nichts; das darf nur der Inhaber. Was er selbst hochlädt, sieht er, bis es eine Ordnung bekommt; danach gilt sein
Sichtbereich wie für alle anderen Dokumente. Lädt er eine Datei hoch, die schon im Archiv liegt, erfährt er bei einem Dokument
außerhalb seines Sichtbereichs nur, dass sie vorliegt, ohne Archivnummer.

Nie: Löschung beantragen oder bestätigen, Sperren, Fristen, Prüfung, Z3-Export, Seiten bearbeiten, teilen per Link,
„Öffnen mit …“, Mails importieren, Tags und andere Listen anlegen oder ändern, Regeln, Workflows, Quellen, Import aus
Paperless-ngx, Einstellungen, Zugänge, API-Tokens, Webhooks und MCP. Das eigene Konto (zweiter Faktor) pflegt jede Rolle. API-Tokens gehören dem Inhaber und sehen alle
Dokumente; Mitarbeiter bekommen keine.

## Wie Belegt das durchsetzt

Welche Dokumente ein Zugang sieht, entscheidet eine Stelle (`server/zugang/sicht.ts`), für den Zeitraum des Prüfers
und den Sichtbereich des Mitarbeiters: Liste, Suche, Zahlen und alle anderen Abfragen nehmen ihre Bedingung, und vor
jedem Aufruf unter `/api/dokumente/:id/…` prüft die Anmeldung das Dokument. Was ein Mitarbeiter überhaupt aufrufen
darf, steht in einer Liste (`server/zugang/mitarbeiter.ts`); alles andere lehnt der Server ab. Ein Test führt jede
Route der Schnittstelle auf und prüft jede mit einem Dokument außerhalb des Sichtbereichs, eine neue Route fällt dort
auf, bis sie eingeordnet ist.
