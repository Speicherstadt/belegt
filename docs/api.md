# Schnittstelle

> [!WARNING]
> Noch ohne Anmeldung: Jeder, der den Server erreicht, kann lesen und hochladen. Belegt gehört bis dahin nicht ins
> Internet. Das Audit-Log schreibt als Akteur „unangemeldet“.

| Aufruf | Wirkung |
| --- | --- |
| `POST /api/dokumente` (multipart, Feld `datei`, höchstens 100 MB) | nimmt ein Original auf und antwortet mit `201` und dem Dokument |
| `GET /api/dokumente?suche=…&limit=…` | Dokumente, neueste zuerst; die Suche trifft vorerst den Dateinamen |
| `GET /api/dokumente/:id` | ein Dokument |
| `GET /api/dokumente/:id/datei` | das Original; `409`, wenn die Datei fehlt oder ihr Hash nicht mehr stimmt |
| `GET /api/pruefung` | Befunde zu Hash-Kette, Kopf und Siegeln, `ok: true`, wenn es keine gibt |

Ein Original liegt unter seinem SHA-256 im Speicher (`DOCUMENTS_DIR`); den Typ erkennt Belegt am Inhalt, nicht an der
Endung. Die Zeile in `dokumente` ist ab dem Einfügen versiegelt: Ändern, Löschen und `TRUNCATE` lehnt Postgres ab,
und die Prüfung findet eine Änderung an den Triggern vorbei.
