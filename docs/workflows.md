---
title: "Workflows"
description: >-
  Workflows in Belegt: wenn ein Dokument ankommt oder eingeordnet wird und Bedingungen zutreffen, Tags, Korrespondent,
  Dokumenttyp, Feldwerte, Notiz oder Webhook setzen oder das Original an eine Adresse senden, protokolliert und genau
  einmal je Dokument.
---

# Workflows

Ein Workflow handelt von selbst: Wenn ein Dokument aufgenommen oder eingeordnet wird (Auslöser) und alle Bedingungen
zutreffen, führt Belegt seine Aktionen aus. Workflows legt nur der Inhaber an, auf der Seite **Workflows**; die
Steuerberatung sieht sie, der Prüfer nicht.

## Regeln und Workflows

[Regeln](eingang.md#regeln) schlagen vor, Workflows handeln. Eine Regel ändert nichts, bis jemand „Übernehmen“
klickt; ein Workflow setzt Tags, Korrespondent, Dokumenttyp und Feldwerte sofort. Beides bleibt getrennt, damit klar ist, was nur ein
Vorschlag ist und was Belegt selbst getan hat.

## Auslöser

- **Dokument aufgenommen:** jedes neue Dokument, gleich woher (Hochladen, Mail, Eingangsordner, Schnittstelle,
  abgeleitet, Import).
- **Dokument eingeordnet:** wenn das Dokument eingeordnet wird; eine spätere neue Einordnung löst denselben Workflow
  nicht noch einmal aus.

Ein Workflow sieht nur Dokumente, die nach seinem Anlegen aufgenommen oder eingeordnet wurden, und bearbeitet jedes
Dokument genau einmal. Gelöschte Dokumente bearbeitet er nicht.

## Bedingungen

Alle ausgefüllten Bedingungen müssen zutreffen; ohne Bedingung gilt der Workflow für jedes Dokument seines Auslösers.

| Bedingung | trifft zu, wenn |
| --- | --- |
| Quelle | das Dokument aus einer der gewählten Quellen kam |
| Dateiname, Text enthält | der Dateiname oder der gelesene Text (PDF, Office, Texterkennung, Mailtext) das Wort enthält, ohne Unterschied zwischen Groß- und Kleinschreibung |
| Betreff, Absender, Domain, Anhangtyp | wie bei den Regeln; ein Anhang hat die Merkmale seiner Mail, ohne Mail ist der Dateiname der Betreff |
| Dateityp | der Typ genau passt (`application/pdf`) oder mit Stern (`image/*`) |
| Hat den Tag, Dokumenttyp, Korrespondent | das Dokument den Tag hat, den Dokumenttyp oder Korrespondenten oder keinen |
| Postfach | eine Mail (oder die Mail eines Anhangs) aus dem Postfach mit diesem Namen kam |
| Unterordner | die Datei im Eingangsordner in diesem Unterordner lag, auch tiefer („Steuer“ trifft „Steuer/2026“) |

Braucht eine Bedingung den Text, wartet der Workflow, bis der Worker ihn gelesen hat.

## Aktionen

- Tag hinzufügen oder entfernen, Korrespondent oder Dokumenttyp setzen, Feldwert setzen
- Notiz anlegen
- Webhook-Ereignis `dokument.workflow` auslösen; die Nachricht nennt den Workflow ([Webhooks](schnittstelle.md#webhooks))
- Original an eine Adresse senden, etwa an eine Buchhaltung ([unten](#original-an-adresse-senden))
- Ohne Bestätigung einordnen (siehe unten)

Die Aktionen eines Workflows laufen in einer Transaktion: Scheitert eine, etwa weil ein Tag inzwischen gelöscht ist,
geschieht keine, und der Fehler steht in den letzten Läufen. Belegt versucht es nicht wieder. Im Audit-Log und im
Verlauf des Dokuments steht jede Änderung mit dem Akteur `workflow:<Name>`.

## Original an Adresse senden { #original-an-adresse-senden }

Die Aktion schickt das Original an eine andere App, die Dateien über eine Schnittstelle annimmt: als
`multipart/form-data` per `POST`, die Datei im Feld mit dem gewählten Namen, dazu feste Felder und eine Kopfzeile für
die Anmeldung.

| Angabe | Bedeutung |
| --- | --- |
| Adresse | `https://…` (oder `http://` im eigenen Netz); Zugangsdaten gehören nicht in die Adresse |
| Name des Dateifelds | wie die App ihn erwartet, etwa `datei`, `file` oder `document` |
| Kopfzeile | Name (Vorgabe `Authorization`) und Wert, etwa `Bearer …` oder `Token …`. Der Wert ist mit `BELEGT_SCHLUESSEL` verschlüsselt gespeichert und steht nie in der Oberfläche, der Schnittstelle, dem Protokoll oder dem Log |
| Feste Felder | je Zeile `name=wert`; Platzhalter `{titel}` (sonst der Dateiname), `{asn}`, `{id}`, `{datum}` (Entstehung, sonst Eingang), `{eingang}`, `{dateiname}`, `{art}`, `{korrespondent}`, `{dokumenttyp}`, `{url}` (Link auf das Dokument in Belegt) |

Gesendet wird im Hintergrund. Eine Antwort `2xx` ist ein Erfolg. Antwortet die App nicht, mit `408`, `429` oder `5xx`,
versucht Belegt es nach 1, 5 und 15 Minuten, 1, 3, 6 und 12 Stunden und einem Tag wieder und gibt danach auf; eine
andere Antwort (`4xx`) und jede Weiterleitung (`3xx`, der Belegt nicht folgt, damit das Original nicht an eine andere
Adresse geht) beenden es sofort. Jedes Dokument geht je Aktion höchstens einmal erfolgreich hinaus; Postgres hält eine
gesendete Weitergabe fest. Ein Dokument, das vorher gelöscht wird, geht nicht mehr hinaus. Auf der Seite des Dokuments
stehen unter **Weitergaben** Workflow, Ziel, Stand, Zeitpunkt, HTTP-Status und Fehler (Inhaber und Steuerberatung);
gibt Belegt auf, meldet es das mit den fehlgeschlagenen Workflows ([Benachrichtigungen](betrieb.md#benachrichtigungen)).

Beispiel Buchhaltung mit Belege-API, hier [Haben](https://haben.app/) (`POST /api/v1/belege`, Datei im Feld `datei`,
Token mit dem Recht `belege:anlegen`): Haben legt mit derselben Referenz nichts doppelt an.

| Angabe | Wert |
| --- | --- |
| Adresse | `https://haben.example.de/api/v1/belege` |
| Dateifeld | `datei` |
| Kopfzeile | `Authorization` = `Bearer hb_…` |
| Feste Felder | `externalSource=belegt`, `externalId={id}`, `note=Belegt ASN {asn}: {titel} {url}` |

Beispiel [Paperless-ngx](https://docs.paperless-ngx.com/api/#file-uploads) (`POST /api/documents/post_document/`):

| Angabe | Wert |
| --- | --- |
| Adresse | `https://paperless.example.de/api/documents/post_document/` |
| Dateifeld | `document` |
| Kopfzeile | `Authorization` = `Token …` (API-Token aus dem Profil) |
| Feste Felder | `title={titel}`, `created={datum}` |

Die Adresse wählt nur der Inhaber; wie bei den [Webhooks](schnittstelle.md#webhooks) gehen nur `http` und `https`,
ohne Weiterleitung und mit Zeitlimit. Eine Adresse im eigenen Netz ist erlaubt, denn dort stehen die Apps meist.

## Reihenfolge und Anhalten

Workflows laufen in der Reihenfolge der Liste, jeder sieht, was die vorigen gesetzt haben. Mit „Trifft er zu, laufen
die folgenden Workflows für dieses Dokument nicht“ hält ein Workflow die übrigen an.

## Einordnen durch einen Workflow

Einordnen setzt die Art, damit die Frist nach § 147 AO, und sperrt das Dokument bis Fristende. Deshalb ordnet ein
Workflow nur ein, wenn der Inhaber das bei der Aktion ausdrücklich wählt; Postgres lehnt einen Workflow ohne diese Wahl
ab. Er ordnet nur Dokumente im Eingang ein, nie eines, das schon jemand eingeordnet hat, mit dem Tag des Eingangs oder
dem Datum einer erkannten E-Rechnung als Entstehung.

Die GoBD verlangen keine Bestätigung je Beleg, aber ein beschriebenes, nachvollziehbares Verfahren (GoBD Rz. 151 ff.):
Der Workflow ist die vorab getroffene Entscheidung des Inhabers, jede Einordnung steht mit `workflow:<Name>` im
Audit-Log, und die [Verfahrensdokumentation](verfahrensdoku.md) führt jeden aktiven Workflow mit Auslöser, Bedingungen
und Aktionen auf. Eine falsche Einordnung korrigierst du wie jede andere mit einer neuen Einordnung; die alte bleibt.

## Ändern

Ein Workflow lässt sich aus- und einschalten, verschieben und löschen. Um Bedingungen oder Aktionen zu ändern, legst
du ihn neu an und löschst den alten; seine Läufe bleiben im Protokoll. Wird ein Workflow wieder eingeschaltet,
bearbeitet er auch die Dokumente, die in der Zwischenzeit ankamen.
