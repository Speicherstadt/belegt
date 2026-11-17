---
title: "Glossar"
description: >-
  Kurze Erklärungen zu ASN, Siegel, Hash-Kette, Sperre, Art, GoBD sowie Z1 und Z3.
---

# Glossar

Die Begriffe, die in Belegt vorkommen, in einfacher Sprache. Zu den ersten fünf führt das „?“ neben dem Begriff in der
Oberfläche hierher.

## ASN { #asn }

Die Archivnummer (Archive Serial Number): eine fortlaufende Nummer, die jedes Dokument beim Eingang bekommt. Sie ändert
sich nie, auch wenn du das Dokument später einordnest. Die Suche findet ein Dokument über seine ASN.

## Siegel { #siegel }

Ein Fingerabdruck der Angaben zum Dokument und zu jeder Einordnung. Ändert sich etwas daran, passt er nicht mehr, und die
[Prüfung](pruefung.md) meldet es. Die Datenbank erstellt das Siegel selbst, nicht die App.

## Hash-Kette { #hash-kette }

Das Protokoll aller Änderungen. Jeder Eintrag enthält den Fingerabdruck (Hash) des Eintrags davor. Wer einen Eintrag
ändert oder entfernt, bricht die Kette; die [Prüfung](pruefung.md) findet die Stelle. Den Kopf der Kette notierst du dir
als Prüfwert.

## Sperre { #sperre }

Eine Sperre hält alle Dokumente eines Zeitraums fest, auch nach Ende ihrer Frist, etwa während einer Betriebsprüfung.
Mehr dazu unter [Fristen und Löschen](fristen.md#sperren). Davon zu trennen ist die Sperre eines Dokuments durch seine
Art: Solange die Frist läuft, lässt es sich nicht löschen.

## Art { #art }

Die Art legt beim Einordnen fest, wie lange ein Dokument bleiben muss:

- **Pflicht**: gesetzliche Frist nach § 147 AO, je nach Art 6, 8 oder 10 Jahre.
- **Freiwillig**: bis zu einem Tag, den du selbst wählst.
- **Frei**: keine Frist; löschbar, solange keine [Sperre](#sperre) den Tag umfasst, an dem es entstanden ist.

Die Fristen stehen unter [Fristen und Löschen](fristen.md).

## GoBD { #gobd }

Die „Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in
elektronischer Form sowie zum Datenzugriff“ des Bundesfinanzministeriums. Sie verlangen unter anderem, dass Unterlagen unveränderbar,
nachvollziehbar und bis zum Fristende auffindbar bleiben. Belegt setzt das mit Siegeln, Hash-Kette und Sperren um; eine
Steuer- oder Rechtsberatung ist es nicht.

## Z1 und Z3 { #z1-z3 }

Die Zugriffsarten bei einer Betriebsprüfung. **Z1** ist der unmittelbare Zugriff: Der Prüfer liest selbst in Belegt, mit
einem eigenen Zugang für einen Zeitraum. **Z3** ist die Datenträgerüberlassung: Du übergibst die Daten auf einem
Datenträger. Beides steht unter [Prüfung, Z1 und Z3](pruefung.md).
