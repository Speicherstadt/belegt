# Eingang

Was ankommt, wird zuerst unverändert gesichert und landet dann im Eingang. Dort legst du fest, was es ist; die Art
bestimmt die Frist ([Fristen](fristen.md)).

## Mails

Eine Mail wird als Original (`.eml`) aufbewahrt. Daraus liest Belegt Absender, Empfänger, Betreff, Datum, den Text
und die Anhänge; Anhänge bekommen ihren eigenen SHA-256. Antworten hängen über `In-Reply-To` und `References` an
ihrer Unterhaltung.

Mails importierst du im Eingang oder Archiv mit „Mails importieren“, als `.eml` oder als MBOX (Export aus
Thunderbird oder Google Takeout); Belegt teilt ein Archiv in einzelne Mails. Jede Mail wird ein Dokument
(`message/rfc822`), jeder Anhang ein eigenes Dokument mit Verweis auf seine Mail; beides ist versiegelt. Eine Mail mit
denselben Rohdaten nimmt Belegt nicht zweimal auf, ein wiederholter Import desselben Archivs ist also harmlos. Auf der
Seite einer Mail stehen Kopf, Text, Anhänge und die Unterhaltung.

## Regeln

Regeln (Seite Quellen) schlagen eine Art vor, etwa „Mails von `telekom.de` mit PDF sind Belege“. Für einen Anhang
gelten die Merkmale seiner Mail. Eine Regel kann auf Absender,
Domain (auch Subdomains), einen Teil des Betreffs und den Typ eines Anhangs prüfen; alle Bedingungen müssen
zutreffen, die erste passende Regel gewinnt. Eine Regel ohne Bedingung trifft nichts.

Ein Vorschlag setzt noch keine Frist. Erst wenn du ihn übernimmst, wird das Dokument eingeordnet und gesperrt.
