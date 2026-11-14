---
title: "Unterlagen für ein Testat"
description: >-
  Anforderungen der GoBD mit Umsetzung und Tests als Nachweis, für eine Prüfung nach IDW PS 880.
---

# Unterlagen für ein Testat

Ein Testat zu Belegt erteilt ein Wirtschaftsprüfer, etwa nach IDW PS 880 (Prüfung von Softwareprodukten). Belegt hat
keins. Diese Seite sammelt, was eine solche Prüfung braucht: welche Anforderung der GoBD Belegt wie erfüllt, wo das
steht und welcher Test es zeigt. Ein Testat sagt nur, dass die Software ordnungsmäßiges Arbeiten ermöglicht; ob der
Betrieb ordnungsmäßig arbeitet, hängt auch an seinen eigenen Abläufen (unten).

## Anforderungen und Nachweise

| Anforderung (GoBD) | Umsetzung in Belegt | Nachweis |
| --- | --- | --- |
| Unveränderbarkeit | Dokumente, Einordnungen, Mails, Anhänge, Löschnachweise und Zeitstempel sind ab dem Einfügen versiegelt; Ändern, Löschen und `TRUNCATE` lehnt PostgreSQL per Trigger ab (`drizzle/0000_gobd_kern.sql` aus dem Paket `@firsttris/gobd-kern`). Originale liegen unter ihrem SHA-256, mit S3 zusätzlich mit Object Lock (COMPLIANCE) bis Fristende. | `server/dokumente/dokumente.test.ts`, `server/einordnung/einordnung.test.ts`, `server/loeschung/loeschung.test.ts`, `server/speicher/s3.test.ts`, `server/zeitstempel/zeitstempel.test.ts` |
| Nachvollziehbarkeit | Jede Änderung an protokollierten Tabellen steht im Audit-Log mit Akteur und Zeit; die Einträge sind eine Hash-Kette. Eine neue Einordnung ersetzt die alte nicht. Die Prüfung rechnet Kette, Kopf und Siegel nach. | `server/dokumente/dokumente.test.ts` (Prüfung findet Änderungen an den Triggern vorbei), `server/auth.test.ts`, `server/zugang/tokens.test.ts` (Akteure) |
| Nachweis eines Stands zu einem Zeitpunkt | Täglicher Zeitstempel nach RFC 3161 über den Kopf der Kette, unabhängig prüfbar mit `openssl ts -verify`. | `server/zeitstempel/rfc3161.test.ts`, `server/zeitstempel/zeitstempel.test.ts` (gegen OpenSSL als Zeitstempeldienst) |
| Vollständigkeit | Mails kommen über SMTP-Journal, IMAP, JMAP, Microsoft 365, Google, MBOX, EML und PST unverändert ins Archiv; doppelte erkennt Belegt am Hash; Abrufe sind nur lesend und merken sich ihren Stand. | `server/mail/smtp.test.ts`, `server/mail/abruf.test.ts`, `server/mail/jmap.test.ts`, `server/mail/oauth.test.ts`, `server/mail/import.test.ts`, `server/mail/pst.test.ts` |
| Ordnung, Auffindbarkeit | Einordnung nach Art, Volltextsuche über Dateiname, Einordnung, Mail, PDF-Text, Texterkennung und E-Rechnung. | `server/dokumente/suche.test.ts`, `server/inhalt/inhalt.test.ts`, `server/inhalt/ocr.test.ts`, `e2e/dokumente.spec.ts` |
| Aufbewahrungsfristen | Fristen nach § 147 Abs. 3 und 4 AO und Art. 97 § 19a EGAO; Löschen erst nach Fristende, nicht unter einer Sperre, mit einer zweiten Person; die Datenbank prüft diese Regeln selbst. | `shared/fristen.test.ts`, `server/loeschung/loeschung.test.ts`, `e2e/loeschung.spec.ts` |
| Datenzugriff (Z1, Z3) | Prüferzugang mit Zeitraum, nur lesend; Datenträger als ZIP mit `index.xml` nach dem Beschreibungsstandard, Prüfwert und Prüfsummen. | `server/zugang/pruefer.test.ts`, `server/export/z3.test.ts`, `e2e/export.spec.ts`, `e2e/zugaenge.spec.ts` |
| Zugriffsschutz | Konten nur per Einladung, Rollen Inhaber, Steuerberatung, Prüfer; API-Tokens mit festen Rechten; Anmeldung über einen Anbieter nur für verbundene Konten; Geheimnisse verschlüsselt (AES-256-GCM). | `server/auth.test.ts`, `server/zugang/tokens.test.ts`, `server/oidc.test.ts`, `server/crypto.test.ts`, `server/mcp/mcp.test.ts` |
| Verfahrensdokumentation | Aus Code, Datenbank und den Angaben des Betriebs erzeugt; nennt fehlende Angaben. | `server/verfahrensdoku/verfahrensdoku.test.ts`, `e2e/verfahrensdoku.spec.ts` |
| Vorschläge statt Automatik | Regeln, E-Rechnung und Sprachmodell schlagen nur vor; eingeordnet wird erst, was ein Mensch bestätigt. | `server/ki/ki.test.ts`, `e2e/einordnung.spec.ts`, `e2e/erechnung.spec.ts` |

Die Tests laufen gegen eine echte PostgreSQL-Datenbank, die Oberflächentests mit Playwright und axe gegen einen echten
Server ([`entwicklung.md`](entwicklung.md)). Die CI führt bei jeder Änderung alle aus, dazu `bun audit` und einen Bau
und Start des Containers. Jeden Funktionsbereich hat nach dem Einbau ein unabhängiges Review geprüft; jeder Fund kam mit einem
roten Test und blieb als Test erhalten.

## Was der Betrieb beiträgt

- Verfahrensdokumentation vollständig ausfüllen und aktuell halten (Datensicherung, Scannen, Verantwortliche).
- Datenbank, Dateien oder Bucket und `.env` sichern und die Wiederherstellung prüfen, danach „Prüfung“ mit Dateien.
- Zugänge pflegen: Einladungen nur an die richtigen Personen, ausgeschiedene Zugänge und Tokens widerrufen.
- Dokumente zeitnah einordnen und Sperren bei Außenprüfungen oder Rechtsstreit anlegen.
- Den Server aktuell halten (Updates von Belegt, Betriebssystem, PostgreSQL) und den Zugang von außen schützen.
- Für Zeitstempel einen Dienst wählen, dem der Betrieb vertraut, und dessen Zertifikat aufbewahren.
