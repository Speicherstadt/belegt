# Prüfung

Unter **Prüfung** prüft Belegt Hash-Kette, Kopf und Siegel; „Auch alle Dateien prüfen“ liest zusätzlich jedes
Original und vergleicht es mit seinem Hash. Darunter steht der Prüfbericht: Zeitpunkt, Ergebnis, wie viele Dokumente, Siegel und
Einträge geprüft wurden, und der Prüfwert, der Kopf der Hash-Kette. Wer ihn notiert, kann später zeigen, dass bis zu
diesem Eintrag nichts verändert wurde. „Drucken oder als PDF sichern“ gibt den Bericht ohne Navigation aus.

## Prüferzugang (Z1)

Unter **Zugänge** lädst du einen Prüfer mit einem Zeitraum ein, etwa den Prüfungszeitraum aus der Prüfungsanordnung.
Der Prüfer liest nur: Eingang, Archiv und Prüfung, und von den Dokumenten nur die, deren Tag (Entstanden, sonst
Eingang) im Zeitraum liegt; die Mail zu einem Anhang nur, wenn auch sie darin liegt. Seinen Z3-Export schneidet
Belegt auf diesen Zeitraum zu, im Protokoll stehen nur die Einträge zu diesen Dokumenten. Fristen, Sperren, Löschungen,
Regeln und Postfächer sieht er nicht. Den Zeitraum ändern geht nicht; für einen anderen lädst du neu ein.

## Datenträger für die Betriebsprüfung (Z3)

Für die Datenträgerüberlassung (GoBD Rz. 167) wählst du einen Zeitraum und lädst ein ZIP herunter. Ein Dokument
gehört zum Zeitraum, wenn der Tag seiner Einordnung („Entstanden“) darin liegt, sonst der Tag des Eingangs. Gelöschte
Dokumente fehlen, ihr Löschnachweis steht im Protokoll. Steuerberatung und Prüfer dürfen ebenfalls exportieren.

| Datei | Inhalt |
| --- | --- |
| `dokumente/<ID>/<Dateiname>` | die Originale, Byte für Byte |
| `dokumente.csv` | je Dokument Typ, Größe, SHA-256, Eingang, Quelle, Einordnung, Frist und Pfad im ZIP |
| `mails.csv` | Kopf der Mails (Message-ID, Antwort auf, Von, An, Betreff, Gesendet) |
| `protokoll.csv` | Einträge des Audit-Logs im Zeitraum, je mit dem Hash des Vorgängers und dem eigenen |
| `index.xml` | Beschreibung der drei Tabellen nach dem Beschreibungsstandard |
| `pruefwert.txt` | Nummer und Hash des letzten Eintrags im Audit-Log beim Export |
| `pruefsummen.sha256` | SHA-256 jeder Datei im ZIP, prüfbar mit `sha256sum -c pruefsummen.sha256` |

Die Tabellen sind UTF-8 mit BOM, Semikolon als Trenner und CRLF als Zeilenende. Fehlt ein Original oder passt es
nicht mehr zu seinem Hash, bricht der Download ab; die Prüfung zeigt dann, welche Datei es ist.
