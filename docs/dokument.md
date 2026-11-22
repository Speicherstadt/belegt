---
title: "Dokument: Vorschaubilder, durchsuchbares PDF, Seiten, Notizen, Ähnliches"
description: >-
  Was Belegt rund um ein einzelnes Dokument zeigt und anbietet: Vorschaubilder, durchsuchbare PDFs von Scans, Seiten bearbeiten, ohne das Original zu ändern, Notizen und ähnliche Dokumente.
---

# Dokument

## Aufbau der Seite

Links steht die Vorschau, groß und beim Scrollen stehend. Rechts teilen Reiter den Rest auf: **Einordnung** (Art,
Frist, Tags, Korrespondent, Felder, Mail, E-Rechnung, Angaben mit ASN), **Notizen**, **Weiteres** (Teilen, Weitergaben, Ableitungen,
ähnliche Dokumente, Löschung) und **Verlauf** (Verlauf und Nachweis). Der Reiter steht in der Adresse.

Kommst du aus dem Eingang oder dem Archiv, blätterst du mit ← und → (Knöpfe oder Pfeiltasten, solange du nicht tippst)
durch dieselbe Liste; „Zurück“ führt in die Liste mit ihren Filtern. Im Eingang ordnet „Einordnen & weiter“ das
Dokument ein und öffnet gleich das nächste.

## Vorschaubilder

Eingang und Archiv zeigen vor dem Namen ein kleines Bild der ersten Seite; „Kacheln“ zeigt die Dokumente als größere
Bilder nebeneinander, mit den Tags auf dem Bild, Korrespondent, Typ und den Knöpfen „Öffnen“ und „Herunterladen“; „Liste“ wieder als Tabelle. Die Wahl merkt sich der Browser.

Der Worker erzeugt die Bilder kurz nach dem Eingang mit `pdftoppm` (Poppler, im Image enthalten): aus PDFs, aus JPEG
und PNG und bei Office-Dateien aus ihrer [Ansicht](eingang.md#ansicht-von-office-dateien). Mails, Textdateien, WebP,
TIFF und HEIC bekommen keins, dort steht das Kürzel des Formats. Ein Vorschaubild ist wie die Ansicht aus dem Original
abgeleitet, 300 Pixel breit und höchstens viermal so hoch (eine längere Seite zeigt ihren oberen Teil), und geht mit der Löschung mit; maßgeblich bleibt das Original.

## Durchsuchbares PDF

Für Scans, also Bilder (JPEG, PNG, WebP) und PDFs ohne Textebene, erzeugt der Worker nach der
[Texterkennung](eingang.md#text-und-e-rechnungen) ein durchsuchbares PDF: jede Seite als Bild, der erkannte Text unsichtbar darüber,
sodass er sich im PDF-Leser suchen und markieren lässt. Die Seite des Dokuments zeigt dann diese Fassung mit dem
Hinweis, dass sie aus dem Original erzeugt ist, und bietet „Durchsuchbares PDF herunterladen“ neben „Original
herunterladen“.

Die Fassung ist ein PDF/A-2b (ISO 19005-2) mit sRGB-Farbprofil, XMP-Metadaten und eingebetteter Schrift (bei der
Entwicklung mit veraPDF geprüft). Tesseract schreibt Bild und Text, gescannte PDFs rastert `pdftoppm` vorher mit 300 dpi; so kommt nichts
aus dem Original hinein, was PDF/A verbietet. Das Original bleibt unverändert und maßgeblich, nur es steht im
[Z3-Export](pruefung.md#datenträger-für-die-betriebsprüfung-z3). Wie Ansicht und Vorschaubild ist die Fassung
abgeleitet, nicht versiegelt und geht mit der Löschung mit.

Keine Fassung bekommen Scans ohne erkannten Text, Scans mit mehr als 50 Seiten oder einer Seite über 50 Millionen
Bildpunkte (mit 300 dpi etwas größer als A2) und Fassungen über 50 MB; der Grund steht in der Datenbank, und der Worker
versucht es nicht noch einmal. Ein Scan, an dem Tesseract länger als zehn Minuten rechnet, wird abgebrochen.
`ARCHIVFASSUNG=false` schaltet die Fassungen ab ([`betrieb.md`](betrieb.md#texterkennung)).

## Seiten bearbeiten

Auf der Seite eines PDFs zeigt der Bereich **Seiten** jede Seite als kleines Bild. Dort drehst du einzelne Seiten,
entfernst ausgewählte oder teilst das PDF nach einer Seite in zwei. Mehrere PDFs fügst du über die Mehrfachauswahl in
Eingang oder Archiv zusammen; die Reihenfolge wählst du dort mit den Pfeilen.

Das Original bleibt dabei Byte für Byte, wie es ist. Jede Änderung legt ein **neues Dokument** an, mit eigener
Archivnummer und der Quelle „abgeleitet“; es kommt in den Eingang und wird wie jedes andere eingeordnet. Beim Teilen
entstehen zwei. Tags, Dokumenttyp und Felder der Quelle übernimmt es nicht von selbst, denn es kann etwas anderes
sein; „Ordnung der Quelle übernehmen“ setzt sie auf Wunsch.

Auf beiden Seiten steht die Verknüpfung unter **Ableitungen**: „Abgeleitet aus …“ und „Daraus abgeleitet …“, mit
Operation, Person und Zeitpunkt. Sie ist wie das Dokument versiegelt und steht im Verlauf und im Audit-Log, samt den
Seiten und Drehungen. Aus einem gelöschten Dokument lässt sich nichts mehr ableiten; eine Ableitung bleibt mit ihrer
Quelle verknüpft, auch wenn diese später gelöscht wird.

Bearbeiten darf nur der Inhaber, und nur PDFs. Ein PDF, das sich nicht lesen lässt (kaputt, verschlüsselt, länger als
zwei Minuten), bleibt, wie es ist, und Belegt sagt es. Die Seitenbilder brauchen `pdftoppm`.

## Notizen

Unter **Notizen** schreiben Inhaber und Steuerberatung Anmerkungen zu einem Dokument, etwa „Leistungsdatum fehlt,
beim Lieferanten nachgefragt“. Jede Notiz steht mit Person und Zeitpunkt da; ändern lässt sie sich nicht. Wer sie
geschrieben hat, und der Inhaber, kann sie **zurückziehen**: Sie verschwindet aus der Liste und der Suche, der
Verlauf behält, dass es sie gab und wer sie zurückgezogen hat. Postgres lehnt Ändern und Löschen ab.

Die Suche findet Notizen. Prüfer sehen keine, auch nicht über die Suche: Notizen sind Anmerkungen, keine Unterlage
nach § 147 AO. Mit der Löschung des Dokuments gehen die Notizen mit. Das Audit-Log hält jede Notiz ohne ihren Text
fest, nur mit dessen SHA-256; so lässt sich später zeigen, was stand, ohne dass der Text das Dokument überlebt.
Programme lesen Notizen mit einem Token mit dem Recht lesen und schreiben sie mit schreiben, auch über MCP.

## Ähnliche Dokumente

Auf der Seite eines Dokuments stehen unter **Ähnliche Dokumente** bis zu fünf andere, die ihm im Text am meisten
gleichen, etwa die Stromrechnungen der anderen Monate. Belegt nimmt dafür aus dem Volltext des Dokuments (Dateiname,
Einordnung, Mail, gelesener Text, Tags) die Wörter, die darin oft und im übrigen Archiv selten vorkommen, und sucht
nach Dokumenten mit möglichst vielen davon. Gelöschte erscheinen nicht, Prüfer und Mitarbeiter sehen nur Dokumente ihres Zeitraums oder Sichtbereichs.
Notizen zählen nicht mit. Hat ein Dokument keinen Text, der anderswo vorkommt, bleibt der Bereich weg.
