# belegt-backup

Backup für [Belegt](https://github.com/firsttris/belegt), das selbst gehostete Dokumentenarchiv: ein Dump der Datenbank
(`pg_dump`, custom format, mit Prüfsumme) und die Originale, verschlüsselt mit [restic](https://restic.net). Der
Test-Restore spielt eine Sicherung in eine Wegwerf-Datenbank ein und prüft sie mit der Prüfung von Belegt: Hash-Kette,
Kopf, Siegel und jedes Original gegen seinen Hash. Basis ist `postgres:18` mit den Programmen ab Version 16.

- Compose: Profil `backup` in [`deploy/compose.yml`](https://github.com/firsttris/belegt/blob/main/deploy/compose.yml), sichert täglich um `BACKUP_TIME` (Standard 03:15).
- Aufbewahrung: 14 tägliche, 24 monatliche und 11 jährliche Stände (10 Jahre für Bücher und Aufzeichnungen, § 147 Abs. 3 AO).
- Ziel standardmäßig das Volume unter `/backups`, mit `RESTIC_REPOSITORY` (`sftp:…`, `s3:…`, `rest:…`) ein zweites System.
- Liegen die Originale in S3 mit Object Lock (`S3_ENDPUNKT`), sichert es nur die Datenbank.

| Befehl | |
| --- | --- |
| (keiner) | Zeitplan: `backup.sh` täglich um `BACKUP_TIME` |
| `backup.sh` | Ein Backup jetzt; alle `RESTORE_CHECK_DAYS` Tage (Standard 7) folgt ein Test-Restore |
| `restore-check.sh` / `restore-check.sh <id>` | Test-Restore jetzt, ersetzt nichts |
| `restore.sh` | Verfügbare Stände anzeigen |
| `restore.sh latest` / `restore.sh <id>` | Sicherung prüfen, dann Datenbank und Originale ersetzen (Belegt vorher stoppen); bei Befunden nur mit `--trotz-befunden` |

Die Tags folgen Belegt (`:latest`, `:0.2`, `:0.2.0`, `:next`). Einrichten und Wiederherstellen:
[Betrieb › Sichern](https://firsttris.github.io/belegt/betrieb.html#sichern).
