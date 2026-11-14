# Eingang

Was ankommt, wird zuerst unverändert gesichert und landet dann im Eingang. Dort legst du fest, was es ist; die Art
bestimmt die Frist ([Fristen](fristen.md)).

## Mails

Eine Mail wird als Original (`.eml`) aufbewahrt. Daraus liest Belegt Absender, Empfänger, Betreff, Datum, den Text
und die Anhänge; Anhänge bekommen ihren eigenen SHA-256. Antworten hängen über `In-Reply-To` und `References` an
ihrer Unterhaltung.

Alte Postfächer kommen als MBOX (Export aus Thunderbird oder Google Takeout): Belegt teilt die Datei in einzelne
Mails und behandelt jede wie eine neue.

## Regeln

Regeln schlagen eine Art vor, etwa „Mails von `telekom.de` mit PDF sind Belege“. Eine Regel kann auf Absender,
Domain (auch Subdomains), einen Teil des Betreffs und den Typ eines Anhangs prüfen; alle Bedingungen müssen
zutreffen, die erste passende Regel gewinnt. Eine Regel ohne Bedingung trifft nichts.

Ein Vorschlag setzt noch keine Frist. Erst wenn du ihn übernimmst, wird das Dokument eingeordnet und gesperrt.
