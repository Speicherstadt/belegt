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

## Postfächer

Unter Quellen trägst du Postfächer ein (IMAP: Server, Port, TLS, Benutzer, Passwort, Ordner). Der Worker
(`bun server/worker.ts`, eigener Prozess) holt alle `ABRUF_MINUTEN` neue Mails ab, nur lesend: Belegt markiert nichts
als gelesen und löscht nichts. Er merkt sich je Postfach die letzte UID; nummeriert der Server das Postfach neu
(UIDVALIDITY), beginnt er von vorn, und doppelte Mails erkennt der Import. „Jetzt abrufen“ startet einen Abruf sofort.
Fehler stehen am Postfach. Das Passwort liegt verschlüsselt in der Datenbank (AES-256-GCM, Schlüssel
`BELEGT_SCHLUESSEL`) und erscheint weder in der Oberfläche noch im Audit-Log.

Mit der Art **JMAP** (etwa bei Stalwart) holt Belegt die Sitzung unter `https://<Server>:<Port>/.well-known/jmap` und
meldet sich mit Benutzer und Passwort an. Zeigt die Sitzung für API oder Download auf einen anderen Host oder Port,
bricht der Abruf ab, damit die Zugangsdaten nur an diesen Server gehen. Der Ordner ist sein Name oder seine Rolle (`INBOX` für den Posteingang).
Beim ersten Abruf kommt der ganze Ordner, danach nur, was seit dem letzten Abruf neu hineinkam oder hineinverschoben
wurde (`Email/changes`). Kennt der Server den alten Stand nicht mehr, holt Belegt den Ordner neu.

### Microsoft 365 und Google

Bei Microsoft 365 und Google meldet sich Belegt per OAuth an statt mit einem Passwort. Dafür registrierst du einmal
eine App beim Anbieter, mit `<BELEGT_URL>/api/oauth/rueckkehr` als Weiterleitungsadresse:

- **Microsoft Entra ID:** App-Registrierung (Web), delegierte Berechtigungen `IMAP.AccessAsUser.All` (Office 365
  Exchange Online) und `offline_access`, ein geheimer Clientschlüssel. In `.env`: `MICROSOFT_CLIENT_ID`,
  `MICROSOFT_CLIENT_SECRET`, für ein einzelnes Unternehmen `MICROSOFT_TENANT` (sonst `common`).
- **Google Cloud:** OAuth-Client vom Typ Webanwendung, Gmail-API aktiviert, Bereich `https://mail.google.com/`. In
  `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Für Konten außerhalb deiner eigenen Workspace-Organisation
  verlangt Google für diesen Bereich eine Prüfung der App.

Unter Quellen erscheint dann „Mit Microsoft 365 verbinden“ oder „Mit Google verbinden“. Nach der Anmeldung beim
Anbieter legt Belegt das Postfach mit der Adresse des Kontos an. Gespeichert ist nur das Refresh-Token, verschlüsselt
wie ein Passwort; vor jedem Abruf holt Belegt damit ein Access-Token.

## Regeln

Regeln (Seite Quellen) schlagen eine Art vor, etwa „Mails von `telekom.de` mit PDF sind Belege“. Für einen Anhang
gelten die Merkmale seiner Mail. Eine Regel kann auf Absender,
Domain (auch Subdomains), einen Teil des Betreffs und den Typ eines Anhangs prüfen; alle Bedingungen müssen
zutreffen, die erste passende Regel gewinnt. Eine Regel ohne Bedingung trifft nichts.

Ein Vorschlag setzt noch keine Frist. Erst wenn du ihn übernimmst, wird das Dokument eingeordnet und gesperrt.

## Suche

Die Suche im Archiv geht über den Volltext: Dateiname, Titel und Korrespondent der Einordnung, bei Mails Absender,
Betreff und Text, bei Anhängen dazu Absender und Betreff ihrer Mail, dazu der Text aus PDFs und Nummer und Verkäufer
einer E-Rechnung. Sie versteht deutsche Wortformen („Rechnungen“ findet „Rechnung“), Wortgruppen in Anführungszeichen
und Ausschlüsse mit Minus.

## SMTP-Journal

Statt Postfächer abzurufen, kann der Mailserver jede Mail zusätzlich per SMTP an Belegt schicken (Journal, etwa per
Kopie an eine eigene Adresse mit Weiterleitung zu Belegt). Belegt archiviert sie unverändert, so wie sie ankommt. Der
Dienst läuft als eigener Prozess (`bun server/smtp.ts`, in Compose mit `--profile journal`) auf `SMTP_PORT` (2525).

Der Mailserver meldet sich mit AUTH an: Benutzername beliebig, Passwort ein API-Token mit dem Recht schreiben. Im
Protokoll steht dann `token:<Name>`, und ein widerrufenes Token wird abgelehnt. `SMTP_EMPFAENGER` beschränkt die
angenommenen Empfänger (mit Komma getrennt). Mit `SMTP_TLS_KEY` und `SMTP_TLS_CERT` bietet Belegt STARTTLS an; ohne
geht die Anmeldung im Klartext, das nur in einem eigenen, geschützten Netz. Eine Mail, die schon im Archiv liegt, nimmt
Belegt an, legt sie aber nicht doppelt ab. Klappt die Aufnahme nicht, antwortet es mit 451, und der Mailserver versucht
es später noch einmal.

## Text und E-Rechnungen

Kurz nach dem Eingang liest der Worker jedes PDF und XML: den Text eines PDFs für die Suche und die Kopfdaten einer
E-Rechnung nach EN 16931, als XRechnung (UBL oder CII) oder eingebettet in ein PDF (ZUGFeRD, Factur-X). Auf der Seite
des Dokuments stehen dann Nummer, Datum, Verkäufer, Käufer und Gesamtbetrag (BT-1, BT-2, BT-27, BT-44, BT-112). Beim
Einordnen übernimmt „Übernehmen“ Datum, „Rechnung <Nummer>“ als Titel und den Verkäufer; die Art kommt aus einer
passenden Regel, sonst „Buchungsbeleg“. Geprüft wird die Rechnung dabei nicht, und maßgeblich bleibt das Original.
Bilder (JPEG, PNG, WebP) und PDFs ohne Textebene gehen durch die Texterkennung (Tesseract, Deutsch und Englisch);
die Seite des Dokuments sagt dann „aus der Texterkennung“. HEIC liest sie nicht.
