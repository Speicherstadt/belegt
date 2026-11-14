# Schnittstelle

Alles unter `/api` außer `/api/auth`, `/api/status` und `/api/einladung/:token` verlangt eine Sitzung (Cookie von
Better Auth). Das erste Konto (`POST /api/auth/sign-up/email`) ist der Inhaber und braucht den Einrichtungscode, den der
Server beim Start ins Log schreibt (Kopfzeile `x-belegt-einrichtungscode`). Jedes weitere Konto entsteht nur mit einer
Einladung (Kopfzeile `x-belegt-einladung` mit dem Token aus dem Link) und bekommt deren Rolle. Name, E-Mail und Rolle
lassen sich nicht über Better Auth ändern. Schreiben darf nur der Inhaber, Steuerberatung und Prüfer lesen (`403` sonst). Schreibt ein
Browser von einer anderen Adresse als `BETTER_AUTH_URL` (`Origin`, `Sec-Fetch-Site`), antwortet Belegt ebenfalls mit
`403`. Das Audit-Log nennt als Akteur `nutzer:<E-Mail>`.

| Aufruf | Wirkung |
| --- | --- |
| `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out` | Einrichten, Anmelden, Abmelden (Better Auth) |
| `GET /api/status` | `eingerichtet: true`, sobald es einen Inhaber gibt; ohne Sitzung |
| `GET /api/ich` | der angemeldete Zugang mit Rolle |
| `GET /api/zugaenge`, `POST /api/einladungen` (`rolle`: `steuerberatung` oder `pruefer`), `POST /api/einladungen/:id/zurueckziehen` | Zugänge und Einladungen, nur für den Inhaber; die Antwort beim Einladen enthält den Link einmal, gespeichert ist nur der Hash des Tokens, gültig 72 Stunden |
| `GET /api/einladung/:token` | öffentlich: ob ein Link noch gilt und für welche Rolle |
| `POST /api/dokumente` (multipart, Feld `datei`, höchstens 100 MB) | nimmt ein Original auf und antwortet mit `201` und dem Dokument |
| `GET /api/dokumente?suche=…&limit=…` | Dokumente, neueste zuerst; `suche` geht über den Volltext (deutsch, mit Anführungszeichen und Minus wie bei einer Suchmaschine) aus Dateiname, Einordnung und Mail und über Teile von Dateiname und Titel |
| `GET /api/dokumente/:id` | ein Dokument |
| `GET /api/dokumente/:id/datei` | das Original; `409`, wenn die Datei fehlt oder ihr Hash nicht mehr stimmt |
| `POST /api/dokumente/:id/einordnung` (`art`, `entstanden`, optional `freiwilligBis`, `titel`, `korrespondent`) | ordnet ein; die Frist rechnet Belegt nach § 147 AO |
| `GET /api/dokumente?gruppe=offen\|pflicht\|freiwillig\|frei\|loeschbar\|geloescht` | nur der Eingang, eine Art der Aufbewahrung, was gelöscht werden darf, oder die Löschnachweise; ohne `gruppe` keine gelöschten |
| `POST /api/mails` (multipart, Feld `datei`: `.eml` oder MBOX) | nimmt Mails samt Anhängen auf; Antwort `neu` und `doppelt` (Dokument-IDs) |
| `GET /api/dokumente/:id/mail` | Kopf, Text, Anhänge und Unterhaltung; für einen Anhang mit `ausMail` |
| `GET /api/dokumente/:id/vorschlag` | Vorschlag der ersten passenden aktiven Regel oder `null` |
| `GET /api/regeln`, `POST /api/regeln` (`name`, `wenn`, `dann`), `POST /api/regeln/:id/aktivieren`, `…/deaktivieren` | Regeln |
| `GET /api/quellen`, `POST /api/quellen` (`name`, `host`, `port`, `tls`, `benutzer`, `passwort`, `ordner`), `POST /api/quellen/:id/abrufen`, `…/aktivieren`, `…/deaktivieren` | Postfächer; das Passwort geht nur hinein; `503` ohne `BELEGT_SCHLUESSEL` |
| `GET /api/sperren`, `POST /api/sperren` (`grund`, `von`, `bis`), `POST /api/sperren/:id/aufheben` | Sperren |
| `POST /api/dokumente/:id/loeschung` | beantragt die Löschung (frei Abgelegtes: sofort gelöscht); `409` mit Grund, wenn die Frist läuft, eine Sperre greift oder nicht eingeordnet ist |
| `GET /api/loeschungen`, `POST /api/loeschungen/:id/bestaetigen`, `DELETE /api/loeschungen/:id` | Anträge, Bestätigung durch eine zweite Person (auch die Steuerberatung), Antrag zurückziehen; `GET /api/dokumente/:id/datei` antwortet danach mit `410` |
| `GET /api/fristen/uebersicht` | Zahlen für die Seite Fristen |
| `GET /api/dokumente/:id/verlauf` | Einträge des Audit-Logs zum Dokument und sein Siegel |
| `GET /api/pruefung` | Befunde zu Hash-Kette, Kopf und Siegeln, `ok: true`, wenn es keine gibt |

Ein Original liegt unter seinem SHA-256 im Speicher (`DOCUMENTS_DIR`); den Typ erkennt Belegt am Inhalt, nicht an der
Endung. Die Zeile in `dokumente` ist ab dem Einfügen versiegelt: Ändern, Löschen und `TRUNCATE` lehnt Postgres ab,
und die Prüfung findet eine Änderung an den Triggern vorbei.
