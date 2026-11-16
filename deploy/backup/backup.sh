#!/bin/bash
# Backup: pg_dump (custom format) über das Netz und die Originale, verschlüsselt mit restic. Läuft im Image
# belegt-backup. Erwartet die Verbindung zur Datenbank als Eigentümer (PGHOST, PGUSER, PGDATABASE, PGPASSWORD),
# RESTIC_REPOSITORY, RESTIC_PASSWORD oder RESTIC_PASSWORD_FILE und die Originale lesend unter DOKUMENTE_DIR. Liegen die
# Originale in S3 mit Object Lock (S3_ENDPUNKT gesetzt), sichert es nur die Datenbank.
# Zum Wiederherstellen braucht es außerdem denselben BELEGT_SCHLUESSEL (Postfach-Passwörter im Dump).
# Das Ergebnis steht danach in backup_status; alle RESTORE_CHECK_DAYS Tage (Standard 7, 0 aus) folgt auf ein
# erfolgreiches Backup ein Test-Restore mit restore-check.sh.
set -euo pipefail
. "${BASH_SOURCE[0]%/*}/backup-status.sh"
DOKUMENTE_DIR="${DOKUMENTE_DIR:-/belegt/dokumente}"
stage="$STATE_DIR/stage"
mkdir -p "$stage"
days="${RESTORE_CHECK_DAYS:-7}"
if [[ "$days" =~ ^[0-9]{1,4}$ ]]; then
  days=$((10#$days))
else
  echo "RESTORE_CHECK_DAYS muss eine Zahl bis 9999 sein, ist aber: $days; der Test-Restore läuft alle 7 Tage." >&2
  days=7
fi
# Ein Lauf zur Zeit: Der Dump liegt immer unter demselben Pfad. Ein zweiter wartet bis zu einer Stunde.
exec 9> "$STATE_DIR/lock"
flock -w 3600 9 || { echo "Ein anderes Backup läuft seit über einer Stunde, Backup abgebrochen." >&2; exit 1; }
errlog="$STATE_DIR/backup.err"
: > "$errlog"
exec 3>&2 2> >(tee -a "$errlog" >&3)
tee_pid=$!
# Ergebnis für den Healthcheck (ok oder fehler mit Zeitpunkt) und bei einem Fehlschlag für die App
finish() {
  local rc=$? result=ok
  exec 2>&3
  wait "$tee_pid" 2> /dev/null || true
  rm -f "$stage"/*
  if [ "$rc" != 0 ]; then
    result=fehler
    record_status backup false "" "" "$(last_error "$errlog")"
  fi
  echo "$result $(date -Iseconds)" > "$STATE_DIR/status"
}
trap finish EXIT

[ -n "${RESTIC_PASSWORD:-}${RESTIC_PASSWORD_FILE:-}" ] \
  || { echo "RESTIC_PASSWORD fehlt (in .env setzen); ohne Passwort kein Backup." >&2; exit 1; }
paths=("$stage")
if [ -n "${S3_ENDPUNKT:-}" ]; then
  # Die Originale liegen im Bucket mit Object Lock; gesichert wird nur die Datenbank
  echo "s3" > "$stage/dokumente"
else
  [ -d "$DOKUMENTE_DIR" ] || { echo "Die Originale liegen nicht unter $DOKUMENTE_DIR, Backup abgebrochen." >&2; exit 1; }
  # Wo die Originale im Snapshot liegen; restic speichert absolute Pfade
  realpath "$DOKUMENTE_DIR" > "$stage/dokumente"
  paths+=("$(realpath "$DOKUMENTE_DIR")")
fi

# Beim ersten Lauf das Repository anlegen; ein fehlendes meldet restic mit Exit-Code 10
rc=0
err="$(restic cat config 2>&1 > /dev/null)" || rc=$?
if [ "$rc" = 10 ]; then
  echo "Lege das restic-Repository $(ziel_ohne_zugang) an …"
  restic init
elif [ "$rc" != 0 ]; then
  echo "$err" >&2
  exit 1
fi

"$(pg_bin pg_dump)" --format=custom --file="$stage/belegt.dump"
# Ein abgebrochener Dump darf nicht als Backup durchgehen: pg_restore liest das Inhaltsverzeichnis
"$(pg_bin pg_restore)" --list "$stage/belegt.dump" > /dev/null \
  || { echo "Dump unvollständig oder beschädigt, Backup abgebrochen." >&2; exit 1; }
(cd "$stage" && sha256sum belegt.dump > belegt.dump.sha256)

# Fester Host: Aufbewahrt wird je Host und Tag; mehrere Instanzen in einem Repository brauchen je einen BACKUP_HOST.
# 11 Jahresstände decken die längste Frist ab, 10 Jahre für Bücher und Aufzeichnungen (§ 147 Abs. 3 AO).
summary="$(restic backup --json --retry-lock 10m --host "$BACKUP_HOST" --tag belegt "${paths[@]}" | grep '"message_type":"summary"')"
snapshot="$(sed -n 's/.*"snapshot_id":"\([0-9a-f]\{8\}\)[0-9a-f]*".*/\1/p' <<< "$summary")"
bytes="$(sed -n 's/.*"total_bytes_processed":\([0-9]*\).*/\1/p' <<< "$summary")"
files="$(sed -n 's/.*"total_files_processed":\([0-9]*\).*/\1/p' <<< "$summary")"
[ -n "$snapshot" ] || { echo "restic hat keinen Snapshot gemeldet, Backup abgebrochen." >&2; exit 1; }
echo "Snapshot $snapshot: ${files:-?} Dateien, ${bytes:-?} Byte"
restic forget --retry-lock 10m --tag belegt --group-by host,tags \
  --keep-daily 14 --keep-monthly 24 --keep-yearly 11 --prune
if [ -n "${S3_ENDPUNKT:-}" ]; then
  record_status backup true "$snapshot" "$bytes" "Datenbank; Originale im S3-Bucket mit Object Lock"
else
  record_status backup true "$snapshot" "$bytes" "Datenbank und ${files:-?} Dateien"
fi

# Test-Restore: fällig, wenn in den letzten RESTORE_CHECK_DAYS Tagen (12 Stunden Spielraum) keiner erfolgreich lief;
# ohne Tabelle sonntags. Sein Ergebnis steht für sich, das Backup bleibt erfolgreich.
due=false
if [ "$days" != 0 ]; then
  if status_table; then
    due="$(psql -X -At -c "SELECT NOT EXISTS (SELECT 1 FROM backup_status WHERE art = 'restore_check' AND ok
      AND am > now() - interval '1 day' * $days + interval '12 hours')")" \
      || { echo "Ob ein Test-Restore fällig ist, ließ sich nicht abfragen; er entfällt diesmal." >&2; due=false; }
  elif [ "$(date +%u)" = 7 ]; then
    due=t
  fi
fi
if [ "$due" = t ]; then
  "${BASH_SOURCE[0]%/*}/restore-check.sh" "$snapshot" || echo "Test-Restore fehlgeschlagen; das Backup selbst ist erfolgreich." >&2
fi
