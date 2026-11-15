---
title: "Teilen per Link"
description: >-
  Das Original eines Dokuments per Link an jemanden ohne Zugang geben, für 1, 7 oder 30 Tage, mit Widerruf und Protokoll
  jedes Abrufs.
---

# Teilen per Link

Auf der Seite eines Dokuments legt der Inhaber unter **Teilen per Link** einen Link auf das Original an, gültig für 1, 7
oder 30 Tage, etwa für die Bank oder einen Handwerker. Wer den Link hat, lädt diese eine Datei ohne Anmeldung herunter,
sonst nichts: kein anderes Dokument, keine Angaben aus dem Archiv. Den Link zeigt Belegt nur direkt nach dem Anlegen;
gespeichert ist nur sein Hash.

Darunter stehen die gültigen Links mit Ablauf und Abrufen. **Widerrufen** beendet einen Link sofort. Nach Ablauf oder
Widerruf antwortet der Link mit 404, nach der [Löschung](fristen.md) des Dokuments mit 410.

- **Wer**: nur der Inhaber. Steuerberatung und Prüfer lesen nur, und ein API-Token teilt nicht; ein Original an Dritte
  zu geben, entscheidet der Inhaber.
- **Protokoll**: Anlegen und Widerruf stehen mit Person im Protokoll, jeder Abruf mit Zeitpunkt. Belegt speichert dabei
  keine IP-Adresse und nichts anderes über die abrufende Person: Das Protokoll wächst nur an und ließe sich nicht mehr
  bereinigen, und für den Nachweis reicht, ob und wann der Link benutzt wurde. Eine Vorschau im Messenger, die die
  Datei lädt, zählt als Abruf.
- **Kein Kennwort**: Der Link enthält 256 Bit Zufall und ist damit so schwer zu erraten wie ein starkes Kennwort. Ein
  zusätzliches Kennwort bräuchte eine eigene Seite und Schutz gegen Durchprobieren; kurz gültige Links und der
  Widerruf leisten hier mehr. Schicke den Link nur an die Person, für die er gedacht ist.
- **Verfahrensdokumentation**: Sobald es einen geteilten Link gab, beschreibt sie das Teilen unter „Zugriff“.

Postgres hält das fest, nicht nur die App: Länger als 30 Tage lässt sich ein Link nicht anlegen, Links, Widerrufe und
Abrufe lassen sich weder ändern noch löschen, und einen abgelaufenen oder widerrufenen Link nimmt die Datenbank nicht
als Abruf an. Die Aufrufe stehen in [`api.md`](api.md).
