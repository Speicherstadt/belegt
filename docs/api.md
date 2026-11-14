# Schnittstelle

Alles unter `/api` außer `/api/auth`, `/api/status` und `/api/einladung/:token` verlangt eine Sitzung (Cookie von
Better Auth). Das erste Konto (`POST /api/auth/sign-up/email`) ist der Inhaber und braucht den Einrichtungscode, den der
Server beim Start ins Log schreibt (Kopfzeile `x-belegt-einrichtungscode`). Jedes weitere Konto entsteht nur mit einer
Einladung (Kopfzeile `x-belegt-einladung` mit dem Token aus dem Link) und bekommt deren Rolle. Name, E-Mail und Rolle
lassen sich nicht über Better Auth ändern. Schreiben darf nur der Inhaber, Steuerberatung und Prüfer lesen (`403` sonst). Ein Prüfer liest nur Dokumente, Export und Prüfung, und nur in seinem Zeitraum (`404` für ein Dokument außerhalb, [`pruefung.md`](pruefung.md)). Schreibt ein
Browser von einer anderen Adresse als `BETTER_AUTH_URL` (`Origin`, `Sec-Fetch-Site`), antwortet Belegt ebenfalls mit
`403`. Das Audit-Log nennt als Akteur `nutzer:<E-Mail>`.

Programme melden sich statt mit dem Cookie mit einem API-Token an: `Authorization: Bearer belegt_…`. Der Inhaber legt
Tokens unter „Quellen und Schnittstellen“ an; gespeichert ist nur der Hash. Ein Token mit dem Recht `lesen` liest
Dokumente (`GET /api/dokumente`, `/:id`, `/:id/datei`, `/:id/mail`, `/:id/verlauf`), mit `schreiben` nimmt es zusätzlich
Dokumente und Mails auf und ordnet ein; `POST /api/mcp` steht jedem Token offen, mit den Werkzeugen seines Rechts.
Alles andere antwortet `403`, ein widerrufenes oder falsches Token `401`. Im Audit-Log steht `token:<Name>`.

| Aufruf | Wirkung |
| --- | --- |
| `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out` | Einrichten, Anmelden, Abmelden (Better Auth) |
| `GET /api/status` | `eingerichtet: true`, sobald es einen Inhaber gibt; ohne Sitzung |
| `GET /api/ich` | der angemeldete Zugang mit Rolle |
| `GET /api/zugaenge`, `POST /api/einladungen` (`rolle`: `steuerberatung`, oder `pruefer` mit `zeitraum`: `{von, bis}`), `POST /api/einladungen/:id/zurueckziehen` | Zugänge und Einladungen, nur für den Inhaber; die Antwort beim Einladen enthält den Link einmal, gespeichert ist nur der Hash des Tokens, gültig 72 Stunden |
| `GET /api/tokens`, `POST /api/tokens` (`name`, `recht`: `lesen` oder `schreiben`), `POST /api/tokens/:id/widerrufen` | API-Tokens, nur für den Inhaber mit Sitzung; die Antwort beim Anlegen enthält den Klartext einmal (`klartext`) |
| `POST /api/mcp` | Model Context Protocol (JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`) für KI-Assistenten, mit API-Token; `GET` antwortet `405` ([`schnittstelle.md`](schnittstelle.md)) |
| `GET /api/openapi.json` | OpenAPI 3.1 für Programme; ohne Sitzung |
| `GET /api/webhooks`, `POST /api/webhooks` (`name`, `url`, `arten`), `POST /api/webhooks/:id/aktivieren`, `…/deaktivieren` | Webhooks, nur für den Inhaber; das Geheimnis steht einmal in der Antwort (`geheimnis`); `503` ohne `BELEGT_SCHLUESSEL` ([`schnittstelle.md`](schnittstelle.md)) |
| `GET /api/einladung/:token` | öffentlich: ob ein Link noch gilt und für welche Rolle |
| `POST /api/dokumente` (multipart, Feld `datei`, höchstens 100 MB) | nimmt ein Original auf und antwortet mit `201` und dem Dokument |
| `GET /api/dokumente?suche=…&limit=…` | Dokumente, neueste zuerst; `suche` geht über den Volltext (deutsch, mit Anführungszeichen und Minus wie bei einer Suchmaschine) aus Dateiname, Einordnung und Mail und über Teile von Dateiname und Titel |
| `GET /api/dokumente/:id` | ein Dokument |
| `GET /api/dokumente/:id/datei` | das Original; `409`, wenn die Datei fehlt oder ihr Hash nicht mehr stimmt |
| `POST /api/dokumente/:id/einordnung` (`art`, `entstanden`, optional `freiwilligBis`, `titel`, `korrespondent`) | ordnet ein; die Frist rechnet Belegt nach § 147 AO |
| `GET /api/dokumente?gruppe=offen\|pflicht\|freiwillig\|frei\|loeschbar\|geloescht` | nur der Eingang, eine Art der Aufbewahrung, was gelöscht werden darf, oder die Löschnachweise; ohne `gruppe` keine gelöschten |
| `POST /api/mails` (multipart, Feld `datei`: `.eml` oder MBOX) | nimmt Mails samt Anhängen auf; Antwort `neu` und `doppelt` (Dokument-IDs) |
| `GET /api/dokumente/:id/mail` | Kopf, Text, Anhänge und Unterhaltung; für einen Anhang mit `ausMail` |
| `GET /api/dokumente/:id/vorschlag` | `vorschlag`: die erste passende aktive Regel oder `null`; `erechnung`: Kopfdaten einer erkannten E-Rechnung oder `null` |
| `GET /api/dokumente/:id/inhalt` | Was der Worker gelesen hat: `erechnung` (Beträge in Cent), `textLaenge`, `fehler`; `null`, solange nichts gelesen ist |
| `GET /api/regeln`, `POST /api/regeln` (`name`, `wenn`, `dann`), `POST /api/regeln/:id/aktivieren`, `…/deaktivieren` | Regeln |
| `GET /api/quellen`, `POST /api/quellen` (`name`, `host`, `port`, `tls`, `benutzer`, `passwort`, `ordner`), `POST /api/quellen/:id/abrufen`, `…/aktivieren`, `…/deaktivieren` | Postfächer; das Passwort geht nur hinein; `503` ohne `BELEGT_SCHLUESSEL` |
| `GET /api/sperren`, `POST /api/sperren` (`grund`, `von`, `bis`), `POST /api/sperren/:id/aufheben` | Sperren |
| `POST /api/dokumente/:id/loeschung` | beantragt die Löschung (frei Abgelegtes: sofort gelöscht); `409` mit Grund, wenn die Frist läuft, eine Sperre greift oder nicht eingeordnet ist |
| `GET /api/loeschungen`, `POST /api/loeschungen/:id/bestaetigen`, `DELETE /api/loeschungen/:id` | Anträge, Bestätigung durch eine zweite Person (auch die Steuerberatung), Antrag zurückziehen; `GET /api/dokumente/:id/datei` antwortet danach mit `410` |
| `GET /api/fristen/uebersicht` | Zahlen für die Seite Fristen |
| `GET /api/dokumente/:id/verlauf` | Einträge des Audit-Logs zum Dokument und sein Siegel |
| `GET /api/einstellungen`, `POST /api/einstellungen` (`firma`, `anschrift`, `verantwortlich`, `aufsicht`, `datensicherung`, `scannen`, `ergaenzungen`) | Angaben zum Betrieb; ändern nur der Inhaber |
| `GET /api/verfahrensdoku` | Verfahrensdokumentation als Abschnitte, mit `luecken` und `vollstaendig` ([`verfahrensdoku.md`](verfahrensdoku.md)) |
| `GET /api/export?von=JJJJ-MM-TT&bis=JJJJ-MM-TT` | Datenträger (Z3) als ZIP, gestreamt; Inhalt in [`pruefung.md`](pruefung.md) |
| `GET /api/pruefung` | Befunde zu Hash-Kette, Kopf und Siegeln, `ok: true`, wenn es keine gibt; mit `?dateien=1` auch jede Datei gegen ihren Hash; `bericht` mit Zeitpunkt, Prüfwert und Zahlen |

Ein Original liegt unter seinem SHA-256 im Speicher (`DOCUMENTS_DIR`); den Typ erkennt Belegt am Inhalt, nicht an der
Endung. Die Zeile in `dokumente` ist ab dem Einfügen versiegelt: Ändern, Löschen und `TRUNCATE` lehnt Postgres ab,
und die Prüfung findet eine Änderung an den Triggern vorbei.
