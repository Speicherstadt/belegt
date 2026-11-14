# Fristen

Jedes Dokument bekommt beim Einordnen eine Art. Die Art bestimmt, wie lange es gesperrt bleibt.

| Art | Frist | Grundlage |
| --- | --- | --- |
| Bücher, Aufzeichnungen, Abschlüsse, Organisationsunterlagen | 10 Jahre | § 147 Abs. 1 Nr. 1, Abs. 3 AO |
| Unterlagen zum Zoll | 10 Jahre | § 147 Abs. 1 Nr. 4a, Abs. 3 AO |
| Buchungsbelege | 8 Jahre (10 Jahre für Kredit- und Wertpapierinstitute und unter Versicherungsaufsicht) | § 147 Abs. 1 Nr. 4, Abs. 3 AO; Art. 97 § 19a EGAO |
| Handels- und Geschäftsbriefe, empfangen und abgesandt | 6 Jahre | § 147 Abs. 1 Nr. 2 und 3, Abs. 3 AO |
| Sonstige Unterlagen, die für die Besteuerung von Bedeutung sind | 6 Jahre | § 147 Abs. 1 Nr. 5, Abs. 3 AO |
| Freiwillig mit Frist | bis zum gewählten Tag | – |
| Frei | keine | – |

Die Frist beginnt mit dem Schluss des Kalenderjahres, in dem das Dokument entstanden, empfangen oder abgesandt
worden ist (§ 147 Abs. 4 AO). Ein Beleg vom März 2026 bleibt also bis zum 31.12.2034.

Die acht Jahre für Buchungsbelege gelten seit dem 1. Januar 2025 für alles, dessen Frist bis Ende 2024 noch nicht
abgelaufen war; ein Beleg von 2017 darf deshalb seit dem 1. Januar 2026 gelöscht werden.

> [!IMPORTANT]
> Die Frist läuft nicht ab, solange die Unterlagen für eine Steuer von Bedeutung sind, deren Festsetzungsfrist noch
> läuft, etwa wegen einer Außenprüfung oder eines offenen Einspruchs (§ 147 Abs. 3 Satz 5 AO). Belegt kann das nicht
> wissen. Das Fristende ist deshalb der früheste Tag einer Löschung; gelöscht wird erst, wenn du bestätigst, und am
> besten nach Rücksprache mit deiner Steuerberatung.

Quellen: [§ 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html),
[Art. 97 § 19a EGAO](https://www.gesetze-im-internet.de/aoeg_1977/art_97__19a.html).

## Einordnen

Ein neues Dokument liegt im Eingang, bis es eingeordnet ist. Auf seiner Seite wählst du die Art und den Tag, an dem es
entstanden, empfangen oder abgesandt wurde; Belegt rechnet daraus die Frist und speichert sie mit. Jede Einordnung
ist versiegelt. Eine Änderung kommt als neue Version dazu, die alte bleibt im Verlauf; es gilt die neueste.

## Sperren

Eine Sperre hält alle Dokumente, die in ihrem Zeitraum entstanden sind, auch nach Fristende fest, etwa während einer
Betriebsprüfung oder eines Rechtsstreits. Grund und Zeitraum lassen sich nicht ändern; eine Sperre wird einmal
aufgehoben und bleibt mit dem Zeitpunkt im Verlauf. Die Seite Fristen zählt, was im Archiv und im Eingang liegt, was
gesperrt ist und was gelöscht werden dürfte.

## Löschen

Ist die Frist abgelaufen und liegt keine Sperre über dem Dokument, beantragt der Inhaber auf der Seite des Dokuments
die Löschung. Eine zweite Person (die Steuerberatung) bestätigt sie unter Fristen › Offene Löschungen; wer beantragt
hat, kann nicht selbst bestätigen. Frei Abgelegtes löscht der Inhaber sofort.

Ob gelöscht werden darf, prüft Postgres bei Antrag und Bestätigung selbst: Einordnung vorhanden, Frist abgelaufen
(Tag in Deutschland) oder frei, keine offene Sperre, zwei Personen. Nach der Bestätigung ist die Datei entfernt, außer
ein anderes Dokument hat denselben Inhalt. Die Zeile mit Hash, Angaben und Verlauf bleibt als Löschnachweis,
versiegelt; das Dokument lässt sich danach nicht mehr einordnen. Im Archiv zeigt der Filter „Gelöscht“ diese
Nachweise.
