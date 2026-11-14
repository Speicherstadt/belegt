---
title: "REST-API"
description: >-
  Alle Aufrufe der HTTP-Schnittstelle von Belegt mit Rechten und Antworten.
---

# Schnittstelle

Alles unter `/api` außer `/api/auth`, `/api/status`, `/api/einladung/:token` und `/api/freigabe/:token` verlangt eine Sitzung (Cookie von
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
| `GET /api/status` | `eingerichtet: true`, sobald es einen Inhaber gibt; `oidc` (Name des Anbieters oder `null`), `embedOrigin`, `version` und `oeffnenMit` (Name der App oder `null`); ohne Sitzung |
| `GET /api/ich` | der angemeldete Zugang mit Rolle |
| `GET /api/zugaenge`, `POST /api/einladungen` (`rolle`: `steuerberatung`, oder `pruefer` mit `zeitraum`: `{von, bis}`), `POST /api/einladungen/:id/zurueckziehen` | Zugänge und Einladungen, nur für den Inhaber; die Antwort beim Einladen enthält den Link einmal, gespeichert ist nur der Hash des Tokens, gültig 72 Stunden |
| `GET /api/tokens`, `POST /api/tokens` (`name`, `recht`: `lesen` oder `schreiben`), `POST /api/tokens/:id/widerrufen` | API-Tokens, nur für den Inhaber mit Sitzung; die Antwort beim Anlegen enthält den Klartext einmal (`klartext`) |
| `POST /api/mcp` | Model Context Protocol (JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`) für KI-Assistenten, mit API-Token; `GET` antwortet `405` ([`schnittstelle.md`](schnittstelle.md)) |
| `GET /api/openapi.json` | OpenAPI 3.1 für Programme; ohne Sitzung |
| `GET /api/webhooks`, `POST /api/webhooks` (`name`, `url`, `arten`), `POST /api/webhooks/:id/aktivieren`, `…/deaktivieren` | Webhooks, nur für den Inhaber; das Geheimnis steht einmal in der Antwort (`geheimnis`); `503` ohne `BELEGT_SCHLUESSEL` ([`schnittstelle.md`](schnittstelle.md)) |
| `GET /api/einladung/:token` | öffentlich: ob ein Link noch gilt und für welche Rolle |
| `POST /api/dokumente/:id/freigabe` | Link für „Öffnen mit …“ ([`schnittstelle.md`](schnittstelle.md#öffnen-mit-einer-anderen-app)): `url` (Adresse der App mit Link), `gueltigBis`; auch die Steuerberatung |
| `GET /api/freigabe/:token` | öffentlich, nur mit dem Link: das Original, zehn Minuten lang; `404` danach, `410` nach der Löschung |
| `POST /api/dokumente` (multipart, Feld `datei`, höchstens 100 MB) | nimmt ein Original auf und antwortet mit `201` und dem Dokument |
| `POST /api/dokumente?trennen=1` | teilt ein PDF an Trennblättern ([`eingang.md`](eingang.md#trennblätter)) und antwortet mit `{dokumente: [...]}`, ohne Trennblatt mit dem einen Dokument darin |
| `GET /api/trennblatt.pdf` | ein Trennblatt zum Ausdrucken |
| `GET /api/dokumente?suche=…&limit=…` | Dokumente, neueste zuerst; `suche` geht über den Volltext (deutsch, mit Anführungszeichen und Minus wie bei einer Suchmaschine) aus Dateiname, Einordnung und Mail, über Teile von Dateiname und Titel und über die Archivnummer (`ASN 123` oder `123`) |
| `GET /api/dokumente/:id` | ein Dokument; jedes Dokument hat das Feld `asn`, seine Archivnummer |
| `GET /api/dokumente/:id/datei` | das Original; `409`, wenn die Datei fehlt oder ihr Hash nicht mehr stimmt |
| `GET /api/dokumente/:id/ansicht` | die Ansicht einer Office-Datei als PDF, abgeleitet; `404` ohne Ansicht (`ansicht: false` in `GET /api/dokumente/:id`) |
| `POST /api/dokumente/:id/einordnung` (`art`, `entstanden`, optional `freiwilligBis`, `titel`, `korrespondent`) | ordnet ein; die Frist rechnet Belegt nach § 147 AO |
| `GET /api/dokumente?gruppe=offen\|pflicht\|freiwillig\|frei\|loeschbar\|geloescht` | nur der Eingang, eine Art der Aufbewahrung, was gelöscht werden darf, oder die Löschnachweise; ohne `gruppe` keine gelöschten |
| `POST /api/mails` (multipart, Feld `datei`: `.eml`, MBOX, PST oder OST) | nimmt Mails samt Anhängen auf; Antwort `neu` und `doppelt` (Dokument-IDs), bei PST/OST dazu `pst` (das Dokument der Datei) |
| `GET /api/dokumente/:id/mail` | Kopf, Text, Anhänge und Unterhaltung; für einen Anhang mit `ausMail` |
| `GET /api/dokumente/:id/vorschlag` | `vorschlag`: die erste passende aktive Regel oder `null`; `erechnung`: Kopfdaten einer erkannten E-Rechnung oder `null`; `ki`: Vorschlag des Sprachmodells oder `null` |
| `GET /api/dokumente/:id/inhalt` | Was der Worker gelesen hat: `erechnung` (Beträge in Cent), `textLaenge`, `fehler`; `null`, solange nichts gelesen ist |
| `GET /api/regeln`, `POST /api/regeln` (`name`, `wenn`, `dann`), `POST /api/regeln/:id/aktivieren`, `…/deaktivieren` | Regeln |
| `GET /api/quellen`, `POST /api/quellen` (`name`, `host`, `port`, `tls`, `benutzer`, `passwort`, `ordner`, `art`: `imap` oder `jmap`), `POST /api/quellen/:id/abrufen`, `…/aktivieren`, `…/deaktivieren` | Postfächer; das Passwort geht nur hinein; `503` ohne `BELEGT_SCHLUESSEL` |
| `GET /api/oauth`, `GET /api/oauth/:anbieter/start?name=&ordner=`, `GET /api/oauth/rueckkehr` | Postfächer bei `microsoft` oder `google` per OAuth verbinden, nur der Inhaber; leitet zum Anbieter und zurück nach `/quellen?oauth=…` |
| `GET /api/sperren`, `POST /api/sperren` (`grund`, `von`, `bis`), `POST /api/sperren/:id/aufheben` | Sperren |
| `POST /api/dokumente/:id/loeschung` | beantragt die Löschung (frei Abgelegtes: sofort gelöscht); `409` mit Grund, wenn die Frist läuft, eine Sperre greift oder nicht eingeordnet ist |
| `GET /api/loeschungen`, `POST /api/loeschungen/:id/bestaetigen`, `DELETE /api/loeschungen/:id` | Anträge, Bestätigung durch eine zweite Person (auch die Steuerberatung), Antrag zurückziehen; `GET /api/dokumente/:id/datei` antwortet danach mit `410` |
| `GET /api/fristen/uebersicht` | Zahlen für die Seite Fristen |
| `GET /api/dokumente/:id/verlauf` | Einträge des Audit-Logs zum Dokument und sein Siegel |
| `GET /api/einstellungen`, `POST /api/einstellungen` (`firma`, `anschrift`, `verantwortlich`, `aufsicht`, `datensicherung`, `scannen`, `ergaenzungen`) | Angaben zum Betrieb; ändern nur der Inhaber |
| `GET /api/verfahrensdoku` | Verfahrensdokumentation als Abschnitte, mit `luecken` und `vollstaendig` ([`verfahrensdoku.md`](verfahrensdoku.md)) |
| `GET /api/export?von=JJJJ-MM-TT&bis=JJJJ-MM-TT` | Datenträger (Z3) als ZIP, gestreamt; Inhalt in [`pruefung.md`](pruefung.md) |
| `GET /api/zeitstempel`, `GET /api/zeitstempel/:id/token` | Zeitstempel nach RFC 3161 über die Kette und das Token zum Prüfen mit openssl (auch für Prüfer) |
| `GET /api/pruefung` | Befunde zu Hash-Kette, Kopf und Siegeln, `ok: true`, wenn es keine gibt; mit `?dateien=1` auch jede Datei gegen ihren Hash; `bericht` mit Zeitpunkt, Prüfwert und Zahlen |

Ein Original liegt unter seinem SHA-256 im Speicher (`DOCUMENTS_DIR`); den Typ erkennt Belegt am Inhalt, nicht an der
Endung. Die Zeile in `dokumente` ist ab dem Einfügen versiegelt: Ändern, Löschen und `TRUNCATE` lehnt Postgres ab,
und die Prüfung findet eine Änderung an den Triggern vorbei.
