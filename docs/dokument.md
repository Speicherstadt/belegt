---
title: "Dokument: Vorschaubilder und Seiten"
description: >-
  Was Belegt rund um ein einzelnes Dokument zeigt und anbietet: Vorschaubilder und Seiten bearbeiten, ohne das Original zu ändern.
---

# Dokument

## Vorschaubilder

Eingang und Archiv zeigen vor dem Namen ein kleines Bild der ersten Seite; „Kacheln“ zeigt die Dokumente als größere
Bilder nebeneinander, „Liste“ wieder als Tabelle. Die Wahl merkt sich der Browser.

Der Worker erzeugt die Bilder kurz nach dem Eingang mit `pdftoppm` (Poppler, im Image enthalten): aus PDFs, aus JPEG
und PNG und bei Office-Dateien aus ihrer [Ansicht](eingang.md#ansicht-von-office-dateien). Mails, Textdateien, WebP,
TIFF und HEIC bekommen keins, dort steht das Kürzel des Formats. Ein Vorschaubild ist wie die Ansicht aus dem Original
abgeleitet, 300 Pixel breit, und geht mit der Löschung mit; maßgeblich bleibt das Original.

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
