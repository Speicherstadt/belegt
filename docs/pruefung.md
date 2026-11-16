---
title: "Prüfung, Z1 und Z3"
description: >-
  Prüfung von Hash-Kette, Siegeln und Dateien, Prüfbericht, Prüferzugang mit Zeitraum, Datenträger nach dem Beschreibungsstandard und Zeitstempel.
---

# Prüfung

Unter **Prüfung** prüft Belegt Hash-Kette, Kopf und Siegel; „Auch alle Dateien prüfen“ liest zusätzlich jedes
Original und vergleicht es mit seinem Hash. Darunter steht der Prüfbericht: Zeitpunkt, Ergebnis, wie viele Dokumente, Siegel und
Einträge geprüft wurden, und der Prüfwert, der Kopf der Hash-Kette. Wer ihn notiert, kann später zeigen, dass bis zu
diesem Eintrag nichts verändert wurde. „Drucken oder als PDF sichern“ gibt den Bericht ohne Navigation aus.

Inhaber und Steuerberatung sehen dort auch den **Datenbankzugriff**: ob die App mit einer eigenen, eingeschränkten Rolle
arbeitet ([Getrennte Datenbankrollen](betrieb.md#getrennte-datenbankrollen)), sonst eine Warnung mit dem Grund, und die
wirksamen Rechte je Tabelle, so wie die Datenbank sie meldet. Daneben steht der Stand der
[Sicherung](betrieb.md#sichern): letztes Backup, letzter bestandener Test-Restore und Fehler.

## Tägliche Prüfung { #taegliche-pruefung }

Der Worker prüft Hash-Kette, Kopf und Siegel einmal am Tag und speichert Zeitpunkt, Ergebnis, Befunde und die Zahl der
Einträge im Audit-Log (Tabelle `kettenpruefungen`, nur ergänzen, mit Audit-Log). Die Startseite zeigt diesen Lauf,
statt bei jedem Aufruf die ganze Kette zu lesen; ist er älter als zwei Tage, weist sie darauf hin. **Jetzt prüfen**
(nur der Inhaber) startet einen Lauf sofort. Meldet ein Lauf Befunde, kommt die
[Benachrichtigung](betrieb.md#benachrichtigungen) „Kette“. Die Prüfung unter **Prüfung** rechnet wie bisher bei jedem
Aufruf neu.

## Prüferzugang (Z1)

Unter **[Zugänge](zugaenge.md)** lädst du einen Prüfer mit einem Zeitraum ein, etwa den Prüfungszeitraum aus der Prüfungsanordnung.
Der Prüfer liest nur: Eingang, Archiv und Prüfung, und von den Dokumenten nur die, deren Tag (Entstanden, sonst
Eingang) im Zeitraum liegt. Mail und Anhänge sieht er nur gemeinsam: die Mail nur, wenn auch jeder Anhang darin liegt
(ihre Datei enthält die Anhänge), und einen Anhang findet die Suche nicht über Absender und Betreff einer Mail außerhalb
(Regel wie bei [Mitarbeitern](zugaenge.md#mitarbeiter)). Seinen Z3-Export schneidet
Belegt auf diesen Zeitraum zu, im Protokoll stehen nur die Einträge zu diesen Dokumenten. Eine Mail im Zeitraum geht dabei
vollständig als Original mit allen Anhängen in den Export, auch wenn ein Anhang einem anderen Tag zugeordnet ist: Sie ist
ein Geschäftsbrief, und das Original wird unverändert übergeben. Fristen, Sperren, Löschungen,
Regeln, Postfächer und Notizen sieht er nicht. Den Zeitraum ändern geht nicht; für einen anderen lädst du neu ein und entziehst den alten Zugang.

## Datenträger für die Betriebsprüfung (Z3)

Für die Datenträgerüberlassung (GoBD Rz. 167) wählst du einen Zeitraum und lädst ein ZIP herunter. Ein Dokument
gehört zum Zeitraum, wenn der Tag seiner Einordnung („Entstanden“) darin liegt, sonst der Tag des Eingangs. Gelöschte
Dokumente fehlen, ihr Löschnachweis steht im Protokoll. Steuerberatung und Prüfer dürfen ebenfalls exportieren, Mitarbeiter nicht.

| Datei | Inhalt |
| --- | --- |
| `dokumente/<ID>/<Dateiname>` | die Originale, Byte für Byte; abgeleitete Fassungen (Ansicht, durchsuchbares PDF, Vorschaubild) nicht, sie sind keine Unterlagen |
| `dokumente.csv` | je Dokument Typ, Größe, SHA-256, Eingang, Quelle, Einordnung, Frist, Pfad im ZIP, Archivnummer, Dokumenttyp, Tags und Korrespondent zweimal: „Korrespondent“ wie in der versiegelten Einordnung festgehalten, „Korrespondent (Liste)“ mit dem heutigen Namen ([Ordnung](ordnung.md#korrespondenten)) |
| `mails.csv` | Kopf der Mails (Message-ID, Antwort auf, Von, An, Betreff, Gesendet) |
| `tags.csv` | je Dokument und Tag eine Zeile ([Ordnung](ordnung.md)) |
| `felder.csv` | je Dokument und eigenem Feld eine Zeile; Betrag in Euro mit zwei Nachkommastellen, Zahl, Datum, Text oder Ja/Nein in eigener Spalte |
| `protokoll.csv` | Einträge des Audit-Logs im Zeitraum, je mit dem Hash des Vorgängers und dem eigenen |
| `index.xml` | Beschreibung der Tabellen nach dem Beschreibungsstandard, mit dem Typ jeder Spalte |
| `pruefwert.txt` | Nummer und Hash des letzten Eintrags im Audit-Log beim Export |
| `pruefsummen.sha256` | SHA-256 jeder Datei im ZIP, prüfbar mit `sha256sum -c pruefsummen.sha256` |

Die Tabellen sind UTF-8 mit BOM, Semikolon als Trenner und CRLF als Zeilenende. Fehlt ein Original oder passt es
nicht mehr zu seinem Hash, bricht der Download ab; die Prüfung zeigt dann, welche Datei es ist.

## Zeitstempel (RFC 3161)

Mit `TSA_URL` (etwa `https://freetsa.org/tsr` oder der Dienst eines Vertrauensdiensteanbieters) lässt der Worker
einmal am Tag den Kopf der Hash-Kette von diesem Zeitstempeldienst bestätigen, wenn seit dem letzten etwas dazukam.
Das Token belegt, dass alle Einträge bis zu dieser Nummer zu diesem Zeitpunkt so bestanden; die Zeitstempel sind
versiegelt. Der Prüfbericht nennt den neuesten mit dem Token zum Herunterladen, der Z3-Export enthält alle
(`zeitstempel.csv`, `zeitstempel/<Nr>.tst`). Prüfen lässt sich ein Token unabhängig von Belegt, mit dem Hash aus der
Liste und dem Zertifikat des Dienstes:

```bash
openssl ts -verify -token_in -in zeitstempel-123.tst -digest <Hash> -CAfile tsa.pem
```
