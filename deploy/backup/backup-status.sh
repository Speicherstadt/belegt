# shellcheck shell=bash
# Von backup.sh und restore-check.sh eingebunden: gemeinsame Werkzeuge und der Eintrag des Ergebnisses in die Tabelle
# backup_status (Startseite, „Prüfung“ und Verfahrensdokumentation). Fehlt die Tabelle (Belegt älter als das Image)
# oder scheitert das Eintragen, bleibt es bei einer Meldung im Log; der Lauf selbst scheitert daran nicht.

STATE_DIR="${STATE_DIR:-/var/lib/belegt-backup}"
BACKUP_HOST="${BACKUP_HOST:-belegt}"
# Keine NOTICE-Zeilen von dropdb --if-exists und pg_restore
export PGOPTIONS="-c client_min_messages=warning"

# Programme von PostgreSQL in der Major-Version des Servers, sonst die im PATH: Ein neueres pg_dump schreibt Befehle,
# die eine ältere Datenbank nicht kennt, ein älteres pg_restore liest keinen neueren Dump.
pg_bin() {
  local major
  major="$(psql -X -At -d "${PGDATABASE:-postgres}" -c "SELECT current_setting('server_version_num')::int / 10000")"
  if [ -x "/usr/lib/postgresql/$major/bin/$1" ]; then echo "/usr/lib/postgresql/$major/bin/$1"; else echo "$1"; fi
}

# Ziel ohne Zugangsdaten für die App, etwa rest:https://nutzer:passwort@host/ → rest:https://host/; bis zum letzten @
# vor dem Pfad wie url.Parse von Go, das restic nutzt (ein Passwort darf @ enthalten)
ziel_ohne_zugang() {
  sed -E 's#(://)[^/]*@#\1#' <<< "${RESTIC_REPOSITORY:-}"
}

zeitplan() {
  local days="${RESTORE_CHECK_DAYS:-7}"
  if [ "$days" = 0 ]; then
    echo "täglich um ${BACKUP_TIME:-03:15}, ohne Test-Restore"
  else
    echo "täglich um ${BACKUP_TIME:-03:15}, Test-Restore alle $days Tage"
  fi
}

# Gibt es die Tabelle backup_status?
status_table() {
  [ "$(psql -X -At -c "SELECT to_regclass('public.backup_status') IS NOT NULL" 2> /dev/null)" = t ]
}

# record_status <backup|restore_check> <true|false> <snapshot> <bytes> <meldung>
# Mit dem Eigentümerzugang; die App darf die Tabelle nur lesen. Der Akteur steht im Audit-Log.
record_status() {
  if ! status_table; then
    echo "Tabelle backup_status fehlt (Belegt älter als dieses Image); Ergebnis nicht eingetragen." >&2
    return 0
  fi
  psql -X -q -v ON_ERROR_STOP=1 -v art="$1" -v ok="$2" -v snapshot="$3" -v bytes="$4" -v meldung="$5" \
    -v ziel="$(ziel_ohne_zugang)" -v zeitplan="$(zeitplan)" > /dev/null <<'SQL' \
    || echo "Ergebnis konnte nicht in backup_status eingetragen werden." >&2
BEGIN;
SELECT set_config('belegt.actor', 'backup', true);
INSERT INTO backup_status (art, ok, snapshot, bytes, meldung, ziel, zeitplan)
VALUES (:'art', :'ok'::boolean, nullif(:'snapshot', ''), nullif(:'bytes', '')::bigint, :'meldung',
        nullif(:'ziel', ''), :'zeitplan');
COMMIT;
SQL
}

# Die letzten Zeilen einer Fehlerausgabe als eine Meldung für die App. restic --json meldet Abbrüche als
# {"message_type":"exit_error",…,"message":"Fatal: …"}; davon zählt nur die Meldung.
last_error() {
  [ -s "$1" ] || { echo "Abgebrochen ohne Meldung"; return; }
  grep -v '^[[:space:]]*$' "$1" | tail -n 3 \
    | sed 's/^{"message_type":"exit_error".*"message":"\(.*\)"}$/\1/' \
    | tr '\n' ' ' | sed 's/ *$//' | cut -c1-500
}
