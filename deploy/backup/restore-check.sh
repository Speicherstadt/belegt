#!/bin/bash
# Test-Restore: prüft, ob sich ein Backup von backup.sh wirklich einspielen lässt und unverändert ist, ohne etwas zu
# ersetzen. backup.sh ruft ihn alle RESTORE_CHECK_DAYS Tage auf, von Hand: restore-check.sh [snapshot-id]
#
#  1. restic check liest einen Teil der Daten im Repository (RESTORE_CHECK_SUBSET, Standard 5%).
#  2. Der Snapshot wird in ein Arbeitsverzeichnis geholt (RESTORE_CHECK_DIR, Standard im temporären Verzeichnis), der
#     Dump gegen seine Prüfsumme geprüft und in eine Wegwerf-Datenbank <PGDATABASE>_restore_check_<Zeit>_<Zufall>
#     eingespielt.
#  3. Darin die Prüfung von Belegt (server/pruefung/cli.ts, wie „Prüfung“ mit „Auch alle Dateien prüfen“): Hash-Kette,
#     Kopf, Siegel und jedes Original aus dem Snapshot gegen seinen Hash; bei S3 die Originale im Bucket. Der Kopf der
#     Kette muss als Eintrag in der laufenden Datenbank stehen.
#  4. Die Wegwerf-Datenbank und das Arbeitsverzeichnis werden gelöscht, das Ergebnis steht in backup_status.
#
# Platzbedarf: kurzzeitig eine zweite Kopie der Datenbank auf dem Datenbankserver und der Snapshot hier.
set -euo pipefail
. "${BASH_SOURCE[0]%/*}/backup-status.sh"
snapshot="${1:-latest}"
subset="${RESTORE_CHECK_SUBSET:-5%}"
app="${BELEGT_APP:-/app}"
live="$PGDATABASE"
check_db="${PGDATABASE}_restore_check_$(date +%Y%m%d%H%M%S)_$RANDOM"
work="$(mktemp -d "${RESTORE_CHECK_DIR:-${TMPDIR:-/tmp}}/belegt-restore-check.XXXXXX")"
errlog="$work/fehler.log"
exec 3>&2 2> >(tee -a "$errlog" >&3)
tee_pid=$!
ok=false
message=""
finish() {
  local rc=$?
  exec 2>&3
  wait "$tee_pid" 2> /dev/null || true
  dropdb --if-exists "$check_db" 2> /dev/null || echo "Wegwerf-Datenbank $check_db ließ sich nicht löschen." >&2
  if [ "$rc" = 0 ] && [ "$ok" = true ]; then
    record_status restore_check true "$snapshot" "" "$message"
    echo "Test-Restore bestanden: $message"
  else
    record_status restore_check false "$snapshot" "" "$(last_error "$errlog")"
  fi
  rm -rf "$work"
}
trap finish EXIT
fail() { echo "$*" >&2; exit 1; }
q() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }

echo "Prüfe das Repository (restic check, $subset der Daten) …"
restic check --retry-lock 10m --read-data-subset "$subset" > /dev/null

# latest heißt der neueste Stand dieses Hosts (Filter wirken nur darauf); danach gilt die kurze ID
filters=()
[ "$snapshot" != latest ] || filters=(--host "$BACKUP_HOST" --tag belegt)
snapshot="$(restic snapshots --json "${filters[@]}" "$snapshot" | { grep -o '"short_id":"[0-9a-f]*"' || true; } | tail -n 1 | cut -d'"' -f4)"
[ -n "$snapshot" ] || fail "Kein Snapshot ${1:-latest} für Host $BACKUP_HOST gefunden."
echo "Hole Snapshot $snapshot …"
restic restore "$snapshot" --target "$work/snapshot" > /dev/null
dump="$(find "$work/snapshot" -type f -path '*/stage/belegt.dump' | head -n 1)"
[ -n "$dump" ] || fail "Snapshot $snapshot enthält keinen Dump (belegt.dump)."
(cd "${dump%/*}" && sha256sum --quiet -c belegt.dump.sha256) \
  || fail "Der Dump in Snapshot $snapshot passt nicht zu seiner Prüfsumme."
dokumente="$(cat "${dump%/*}/dokumente")"

echo "Spiele Snapshot $snapshot in $check_db ein …"
createdb "$check_db"
"$(pg_bin pg_restore)" --no-owner --no-acl --exit-on-error --dbname="$check_db" "$dump" \
  || fail "Der Dump aus Snapshot $snapshot ließ sich nicht einspielen."

# Die Prüfung von Belegt: Kette, Kopf, Siegel und alle Originale
pruefen=(env -u DATABASE_URL PGDATABASE="$check_db")
if [ "$dokumente" = s3 ]; then
  [ -n "${S3_ENDPUNKT:-}" ] || fail "Snapshot $snapshot hat die Originale in S3, aber S3_ENDPUNKT ist nicht gesetzt."
else
  [ -d "$work/snapshot$dokumente" ] || fail "Im Snapshot $snapshot fehlen die Originale ($dokumente)."
  pruefen+=(DOCUMENTS_DIR="$work/snapshot$dokumente" S3_ENDPUNKT=)
fi
rc=0
summary="$("${pruefen[@]}" bun "$app/server/pruefung/cli.ts" --text)" || rc=$?
[ "$rc" = 0 ] || fail "Prüfung des Backups: $summary"

# Der Stand im Backup muss ein Anfang der laufenden Kette sein: derselbe Eintrag mit demselben Hash
read -r seq hash <<< "$(q -d "$check_db" -F ' ' -c "SELECT seq, encode(hash, 'hex') FROM audit_chain")"
[ -n "${seq:-}" ] || fail "Im Backup fehlt der Kopf der Kette (audit_chain)."
if [ "$seq" != 0 ]; then
  live_hash="$(q -d "$live" -v seq="$seq" <<< "SELECT encode(row_hash, 'hex') FROM audit_log WHERE seq = :'seq'")"
  [ -n "$live_hash" ] || fail "Eintrag Nr. $seq aus dem Backup fehlt in der laufenden Datenbank."
  [ "$live_hash" = "$hash" ] || fail "Eintrag Nr. $seq hat im Backup einen anderen Hash als in der laufenden Datenbank."
fi

message="$summary, Kette bis Nr. $seq gleich der laufenden Datenbank, $subset der Daten gelesen"
ok=true
