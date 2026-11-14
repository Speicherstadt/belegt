---
title: "Tags, Dokumenttypen und eigene Felder"
description: >-
  Das Archiv in Belegt ordnen: Tags, Dokumenttypen und eigene Felder neben der Art, die die Frist bestimmt, mit Filter, Suche und Verlauf.
---

# Ordnung

Neben der Art, die die Frist bestimmt ([Fristen](fristen.md)), ordnest du Dokumente mit Tags, Dokumenttypen und eigenen
Feldern. Das sind Metadaten, nicht das Original: Sie lassen sich ändern, aber jede Änderung steht mit Person und
Zeitpunkt im Audit-Log und im Verlauf des Dokuments. Anlegen und zuweisen darf nur der Inhaber; Steuerberatung und
Prüfer sehen sie. Verwaltet werden sie auf der Seite Ordnung.

## Tags

Ein Dokument hat beliebig viele Tags, etwa „Steuer 2026“ oder „Auto“. Ein Tag hat einen Namen (ohne Unterschied
zwischen Groß- und Kleinschreibung eindeutig) und eine Farbe aus einer festen Auswahl, deren Schrift auf dem
Hintergrund in hell und dunkel mindestens 4,5:1 Kontrast hat. Umbenennen geht jederzeit. Einen Tag zu löschen entfernt
nur seine Zuordnungen, jede einzeln im Audit-Log; die Dokumente bleiben.

## Dokumenttypen

Ein Dokumenttyp sagt, was ein Dokument ist, etwa „Vertrag“ oder „Kontoauszug“; jedes hat höchstens einen. Er ist
getrennt von der Art: Die Frist richtet sich allein nach der Art der Einordnung. Ein Dokumenttyp kann eine Vorgabe-Art
haben, die beim Einordnen vorgeschlagen wird, etwa „Kontoauszug“ → Buchungsbeleg. Übernommen wird sie erst, wenn du
einordnest.

## Eigene Felder

Eigene Felder halten Werte je Dokument, etwa eine Vertragsnummer oder eine Summe. Der Typ ist ab dem Anlegen fest:

| Typ | Wert |
| --- | --- |
| Text | bis 1000 Zeichen |
| Zahl | ganze Zahl |
| Betrag | Euro in ganzen Cent; Eingabe wie `1.234,56`, Anzeige mit Währung |
| Datum | Tag |
| Ja/Nein | ja oder nein |
| Auswahl | eine der festgelegten Optionen; eine Option, die ein Dokument nutzt, lässt sich nicht entfernen |
| Link | Adresse mit `http` oder `https` |

Belegt prüft jeden Wert auf dem Server. Ein leerer Wert entfernt ihn. Ein Feld zu löschen löscht seine Werte, jeden
einzeln im Audit-Log.

## Vorschläge und Eingangsordner

[Regeln](eingang.md#regeln) schlagen neben der Art auch Tags, einen Dokumenttyp und einen Feldwert vor, das
[Sprachmodell](eingang.md#vorschläge-eines-sprachmodells) passende vorhandene Tags und einen Dokumenttyp. „Übernehmen“
auf der Seite des Dokuments setzt sie. Mit `EINGANG_ORDNER_TAGS=true` werden die Unterordner des
[Eingangsordners](eingang.md#eingangsordner) zu Tags.

## Filter und Suche

Im Archiv filterst du nach Tags (das Dokument hat alle gewählten), nach Dokumenttyp (auch „Ohne Dokumenttyp“) und nach
einem Feld: gesetzt, Text enthält, oder bei Betrag, Zahl und Datum von–bis. Die Liste zeigt Tags und Dokumenttyp unter
dem Namen. Die Suche findet die Namen von Tags und Dokumenttyp und die Werte der Felder vom Typ Text, Auswahl und Link.

## Mehrfachauswahl

Im Eingang und im Archiv wählst du Dokumente mit den Kästchen aus, mit dem Kästchen im Kopf der Tabelle alle auf der
Seite. Dann wendest du eine Aktion auf alle an: Tag hinzufügen oder entfernen, Dokumenttyp setzen, Feldwert setzen oder
einordnen. Einordnen geht wie bei einem einzelnen Dokument: Art, Tag der Entstehung (auf Wunsch der Tag des Eingangs
jedes Dokuments), Titel und Korrespondent. Ohne „Auch schon eingeordnete neu einordnen“ ordnet Belegt nur Dokumente im
Eingang ein und überspringt die übrigen; mit dem Häkchen kommt bei jedem eine neue Einordnung als Version dazu.

Eine Sammelbearbeitung ist eine Transaktion: Geht es bei einem Dokument nicht, etwa weil es gelöscht ist, ändert sich
bei keinem etwas, und Belegt nennt das Dokument und den Grund.

## Nach der Löschung

Tags, Dokumenttyp und Feldwerte eines gelöschten Dokuments bleiben als Teil des Löschnachweises, neue lehnt Postgres
ab. Der aus der Datei gelesene Text verschwindet wie bisher mit der Löschung, auch aus der Suche.
