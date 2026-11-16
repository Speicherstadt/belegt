#!/bin/bash
# Stellt Datenbank und Originale aus einem restic-Backup von backup.sh wieder her. Läuft im Image belegt-backup mit
# schreibbar eingehängtem DOKUMENTE_DIR; Server, Worker und SMTP-Journal müssen gestoppt sein.
#
#   docker compose stop server worker smtp
#   docker compose run --rm restore              # verfügbare Stände anzeigen
#   docker compose run --rm restore latest       # oder eine Snapshot-ID
#   docker compose up -d
#
# Achtung: ersetzt die Datenbank PGDATABASE und die Dateien in DOKUMENTE_DIR vollständig; gibt es die Datenbank noch
# nicht, wird sie angelegt. Liegen die Originale in S3, stellt es nur die Datenbank wieder her. Belegt muss danach mit
# demselben BELEGT_SCHLUESSEL laufen wie beim Backup. Die Rechte der App-Rolle vergibt der nächste Start des Servers.
set -euo pipefail
. "${BASH_SOURCE[0]%/*}/backup-status.sh"
DOKUMENTE_DIR="${DOKUMENTE_DIR:-/belegt/dokumente}"
snapshot="${1:-}"
if [ -z "$snapshot" ]; then
  restic snapshots --tag belegt
  echo "Aufruf: restore.sh <snapshot-id|latest>; latest ist der neueste Stand von Host $BACKUP_HOST." >&2
  exit 2
fi
db="$PGDATABASE"
admin() { psql -X -d postgres -v ON_ERROR_STOP=1 --quiet "$@"; }
# Nur Verbindungen von Clients zählen; Autovacuum beendet DROP DATABASE selbst
client_connections() {
  admin -At -v db="$db" <<< "SELECT count(*) FROM pg_stat_activity WHERE datname = :'db' AND backend_type = 'client backend'"
}
# Ein gerade beendeter Client steht noch kurz in der Liste; daher mehrmals prüfen
app_running() {
  local attempt
  for attempt in 1 2 3 4 5; do
    [ "$(client_connections)" = 0 ] && return 1
    [ "$attempt" = 5 ] || sleep 1
  done
  return 0
}
# PGDATABASE gibt es vielleicht noch nicht; pg_bin fragt dann die Datenbank postgres
version_db="postgres"
if app_running; then
  echo "Mit der Datenbank $db sind noch Verbindungen offen. Erst Server, Worker und SMTP-Journal stoppen; nichts geändert." >&2
  exit 1
fi

printf 'Datenbank %s und Originale werden durch Snapshot %s ersetzt. Fortfahren? [ja/nein] ' "$db" "$snapshot"
read -r answer || true
[ "$answer" = "ja" ] || { echo "Abgebrochen."; exit 1; }

work="$(mktemp -d "${RESTORE_DIR:-${TMPDIR:-/tmp}}/belegt-restore.XXXXXX")"
trap 'rm -rf "$work"' EXIT
echo "Hole Snapshot $snapshot …"
# Filter wirken nur auf latest; eine Snapshot-ID gilt unabhängig vom Host
restic restore "$snapshot" --host "$BACKUP_HOST" --tag belegt --target "$work" > /dev/null
dump="$(find "$work" -type f -path '*/stage/belegt.dump' | head -n 1)"
[ -n "$dump" ] || { echo "Im Snapshot fehlt der Dump (belegt.dump); nichts geändert." >&2; exit 1; }
# Erst prüfen, dann ersetzen: Prüfsumme und Inhaltsverzeichnis des Dumps
(cd "${dump%/*}" && sha256sum --quiet -c belegt.dump.sha256) \
  || { echo "Der Dump im Snapshot passt nicht zu seiner Prüfsumme; nichts geändert." >&2; exit 1; }
pg_restore_bin="$(PGDATABASE="$version_db" pg_bin pg_restore)"
"$pg_restore_bin" --list "$dump" > /dev/null \
  || { echo "Der Dump im Snapshot ist beschädigt; nichts geändert." >&2; exit 1; }
dokumente="$(cat "${dump%/*}/dokumente")"
if [ "$dokumente" != s3 ]; then
  source="$work$dokumente"
  [ -d "$source" ] || { echo "Im Snapshot fehlen die Originale; nichts geändert." >&2; exit 1; }
  mkdir -p "$DOKUMENTE_DIR"
  [ -w "$DOKUMENTE_DIR" ] || { echo "$DOKUMENTE_DIR ist nicht schreibbar eingehängt; nichts geändert." >&2; exit 1; }
fi

echo "Spiele die Datenbank in ${db}_restore ein …"
dropdb --if-exists "${db}_restore"
createdb "${db}_restore"
if ! "$pg_restore_bin" --no-owner --no-acl --exit-on-error --dbname="${db}_restore" "$dump"; then
  dropdb --if-exists "${db}_restore"
  echo "Einspielen fehlgeschlagen; die bisherige Datenbank ist unverändert." >&2
  exit 1
fi
# Inzwischen gestartet?
if app_running; then
  dropdb --if-exists "${db}_restore"
  echo "Belegt hat sich inzwischen mit $db verbunden. Erst stoppen; nichts geändert." >&2
  exit 1
fi
echo "Ersetze die Datenbank $db …"
dropdb --if-exists "$db"
admin -v alt="${db}_restore" -v neu="$db" <<< 'ALTER DATABASE :"alt" RENAME TO :"neu"'

if [ "$dokumente" = s3 ]; then
  echo "Die Originale liegen im S3-Bucket mit Object Lock; nur die Datenbank wurde ersetzt."
else
  echo "Stelle die Originale wieder her …"
  find "$DOKUMENTE_DIR" -mindepth 1 -delete
  cp -a "$source/." "$DOKUMENTE_DIR/"
  # Belegt läuft als Benutzer bun (UID 1000)
  chown -R "${DOKUMENTE_UID:-1000}:${DOKUMENTE_UID:-1000}" "$DOKUMENTE_DIR" 2> /dev/null \
    || echo "Eigentümer der Originale ließ sich nicht auf ${DOKUMENTE_UID:-1000} setzen." >&2
fi
echo "Fertig. Belegt starten (der Start vergibt die Rechte der App-Rolle neu), dann unter „Prüfung“ mit „Auch alle Dateien prüfen“ prüfen."
