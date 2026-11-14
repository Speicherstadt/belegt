# Schnittstelle

Alles unter `/api` außer `/api/auth` verlangt eine Sitzung (Cookie von Better Auth). Das erste Konto
(`POST /api/auth/sign-up/email`) ist der Inhaber; jede weitere Registrierung lehnt Belegt ab, weitere Zugänge kommen
per Einladung. Schreiben darf nur der Inhaber, Steuerberatung und Prüfer lesen (`403` sonst). Das Audit-Log nennt
als Akteur `nutzer:<E-Mail>`.

| Aufruf | Wirkung |
| --- | --- |
| `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out` | Einrichten, Anmelden, Abmelden (Better Auth) |
| `GET /api/ich` | der angemeldete Zugang mit Rolle |
| `POST /api/dokumente` (multipart, Feld `datei`, höchstens 100 MB) | nimmt ein Original auf und antwortet mit `201` und dem Dokument |
| `GET /api/dokumente?suche=…&limit=…` | Dokumente, neueste zuerst; die Suche trifft vorerst den Dateinamen |
| `GET /api/dokumente/:id` | ein Dokument |
| `GET /api/dokumente/:id/datei` | das Original; `409`, wenn die Datei fehlt oder ihr Hash nicht mehr stimmt |
| `GET /api/pruefung` | Befunde zu Hash-Kette, Kopf und Siegeln, `ok: true`, wenn es keine gibt |

Ein Original liegt unter seinem SHA-256 im Speicher (`DOCUMENTS_DIR`); den Typ erkennt Belegt am Inhalt, nicht an der
Endung. Die Zeile in `dokumente` ist ab dem Einfügen versiegelt: Ändern, Löschen und `TRUNCATE` lehnt Postgres ab,
und die Prüfung findet eine Änderung an den Triggern vorbei.
