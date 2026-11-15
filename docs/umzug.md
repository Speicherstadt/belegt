---
title: "Von Paperless-ngx zu Belegt"
description: >-
  Dokumente aus Paperless-ngx nach Belegt übernehmen, über die API oder aus einem Export, mit Tags, Dokumenttypen, eigenen Feldern und Notizen.
---

# Von Paperless-ngx zu Belegt

Belegt übernimmt Dokumente aus Paperless-ngx mit Tags, Dokumenttyp, eigenen Feldern und Notizen, auf zwei Wegen:
über die API, solange Paperless-ngx noch läuft, oder aus einem Export. Beide bilden gleich ab. Beides steht unter
**Quellen → Umzug aus Paperless-ngx** und ist Sache des Inhabers.

Übernommen wird immer das Original, nie die Archivversion (das PDF/A, das Paperless-ngx aus Scans erzeugt). Vor der
Aufnahme prüft Belegt die Prüfsumme aus Paperless-ngx gegen das Original, das ankommt (SHA-256, bei älteren Versionen
MD5); passt sie nicht, kommt das Dokument nicht ins Archiv und steht mit Grund in der Fehlerliste. Liegt dasselbe
Original schon im Archiv, verknüpft Belegt es nur und legt kein zweites Dokument an. Übernommene Dokumente haben die
Quelle „Importiert“, eine eigene Archivnummer und im Protokoll den Akteur `import:paperless`.

## Über die API

1. In Paperless-ngx unter **Mein Profil** ein API-Token erzeugen. Belegt übernimmt, was dieser Benutzer sehen darf.
2. In Belegt Name, Adresse (etwa `https://paperless.firma.de`) und Token eintragen, **Paperless-ngx verbinden**.
3. **Import starten**.

Der Worker holt die Dokumente seitenweise im Hintergrund; die Seite zeigt „x von y übernommen, z Fehler“, darunter auf
Wunsch die Fehler mit Grund. **Abbrechen** hält nach dem laufenden Dokument an. Ein neuer Import derselben Quelle
überspringt, was schon übernommen ist, und versucht die Fehler noch einmal; so geht es nach einem Abbruch weiter oder
später mit neuen Dokumenten. Wird der Worker mitten im Import neu gestartet, macht er beim nächsten Dokument weiter.

Das Token liegt verschlüsselt in der Datenbank wie das Passwort eines Postfachs (`BELEGT_SCHLUESSEL`) und erscheint weder
in der Oberfläche noch im Protokoll. Belegt schickt es nur an die eingetragene Adresse und folgt keiner Weiterleitung
auf einen anderen Host. Hat ein Dokument in Paperless-ngx mehrere Versionen, übernimmt Belegt die neueste, wie
Paperless-ngx sie zeigt. Größer als 100 MB darf ein Original nicht sein.

## Aus einem Export

Den Export erzeugt der `document_exporter` von Paperless-ngx als ZIP, etwa

```sh
docker compose exec -T webserver document_exporter ../export --zip --no-archive --no-thumbnail
```

`--no-archive` und `--no-thumbnail` machen das ZIP kleiner; Belegt braucht nur die Originale. **Export hochladen (ZIP)**
legt die Datei in den Importordner (`IMPORT_ORDNER`, Server und Worker müssen ihn teilen, in Compose liegt er im Volume
unter `/var/lib/belegt/import`), dann importiert der Worker wie über die API, mit Stand und Abbrechen. Danach löscht
Belegt das ZIP wieder, denn es enthält auch Benutzer, Passwörter von Postfächern und anderes, was nicht ins Archiv
gehört. Aus dem Manifest liest Belegt nur Dokumente, Korrespondenten, Dokumenttypen, Tags, eigene Felder, Notizen und
die Namen der Benutzer.

Grenzen: höchstens `IMPORT_MAX_GB` (Vorgabe 20 GB) je ZIP und 500 MB je Manifest; ein größeres Manifest teilt
`--split-manifest`. Die Kompression muss DEFLATE sein, die Vorgabe des Exporters (nicht `--zip-compression bzip2` oder
`zstd`). Ein Export mit `--data-only` enthält keine Originale. Dokumente im Papierkorb von Paperless-ngx übernimmt
Belegt nicht. Einen abgebrochenen Export lädst du neu hoch; was schon übernommen ist, verknüpft Belegt dann nur.

## Zuordnung

Paperless-ngx kennt keine Aufbewahrungsfrist. Deshalb landet jedes Dokument zuerst im [Eingang](eingang.md). Titel,
Korrespondent und Datum (`created`) aus Paperless-ngx stehen dort als Vorschlag; „Übernehmen“ trägt sie ins Formular,
eingeordnet wird erst mit „Einordnen“. Nach der Löschung des Dokuments zeigt Belegt den Vorschlag nicht mehr.

Unter **Zuordnung zur Art** legst du fest, welche Dokumenttypen oder Tags aus Paperless-ngx schon eine Art bestimmen,
etwa Dokumenttyp „Rechnung“ → Buchungsbelege. Passt eine Zuordnung, ordnet der Import das Dokument gleich ein, mit
Datum, Titel und Korrespondent aus Paperless-ngx; zuerst zählt der Dokumenttyp, dann die Tags. Freiwillig mit Frist
gibt es dort nicht, denn dafür braucht es ein Datum. Die Zuordnung gilt für Importe, die danach starten.

| Paperless-ngx | Belegt |
| --- | --- |
| Original | Dokument mit eigener Archivnummer, Quelle „Importiert“ |
| Titel, Korrespondent, `created` | Vorschlag für die Einordnung, mit Zuordnung gleich die Einordnung |
| Tags | [Tags](ordnung.md#tags), per Namen zugeordnet oder angelegt |
| Dokumenttyp | [Dokumenttyp](ordnung.md#dokumenttypen), per Namen zugeordnet oder angelegt |
| Archivnummer (ASN) | Feld „Paperless-ASN“ (Zahl); Belegt vergibt eine eigene |
| Notizen | [Notizen](dokument.md#notizen), darunter Autor und Zeitpunkt aus Paperless-ngx |

Eigene Felder legt Belegt mit passendem Typ an oder findet sie per Namen:

| Typ in Paperless-ngx | Feld in Belegt |
| --- | --- |
| Text, langer Text | Text |
| Ganzzahl | Zahl |
| Geldbetrag (`EUR12.50`) | Betrag in Cent |
| Datum | Datum |
| Boolesch | Ja/Nein |
| Auswahl | Auswahl mit denselben Optionen |
| URL | Link |
| Gleitkommazahl, Dokumentverknüpfung, unbekannte Typen | Text, mit Hinweis am Import |

Gibt es schon ein Feld dieses Namens mit anderem Typ, heißt das neue „Name (Paperless-ngx)“. Ein Wert, der nicht
passt, etwa ein Betrag in einer anderen Währung als Euro oder ein Text über 1000 Zeichen, steht in einer Notiz am
Dokument. Was beim Abbilden nicht eins zu eins ging, steht als Hinweis am Import. Nullzeichen (U+0000), die Paperless-ngx mit SQLite oder MariaDB in Titeln, Namen
und Notizen haben kann, lässt Belegt weg.

Die [Verfahrensdokumentation](verfahrensdoku.md) führt jeden Import mit Zeitpunkt, Quelle, Zahlen und dem Abgleich der
Prüfsummen auf.
