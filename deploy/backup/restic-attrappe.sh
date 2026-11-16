#!/bin/bash
# Nachbau von restic für die Tests (backup.test.ts), nur die Befehle und Ausgaben, die backup.sh, restore.sh und
# restore-check.sh nutzen: Snapshots liegen unverschlüsselt als Verzeichnisse unter RESTIC_REPOSITORY, mit den absoluten
# Pfaden wie bei restic. So lassen sich Dateien in einer Sicherung gezielt verändern. Nicht im Image.
set -euo pipefail
repo="$RESTIC_REPOSITORY"
befehl="${1:-}"
shift || true
host="" tag="" target="" json=false args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --host) host="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --target) target="$2"; shift 2 ;;
    --json) json=true; shift ;;
    --retry-lock | --read-data-subset | --group-by | --keep-daily | --keep-monthly | --keep-yearly) shift 2 ;;
    --prune | --quiet) shift ;;
    *) args+=("$1"); shift ;;
  esac
done

# Snapshot-ID zu latest (neuester des Hosts) oder zu einem Präfix
aufloesen() {
  local wahl="$1" id
  if [ "$wahl" = latest ]; then
    for id in $(ls -1 "$repo/snapshots" 2> /dev/null | sort -r); do
      [ -z "$host" ] || [ "$(cat "$repo/snapshots/$id/host")" = "$host" ] || continue
      echo "$id"; return
    done
  else
    ls -1 "$repo/snapshots" 2> /dev/null | grep "^[0-9]*-$wahl" | head -n 1 || true
  fi
}
kurz() { echo "${1#*-}" | cut -c1-8; }

case "$befehl" in
  cat)
    [ -f "$repo/config" ] || { echo "Fatal: repository does not exist" >&2; exit 10; } ;;
  init)
    mkdir -p "$repo/snapshots" && touch "$repo/config" ;;
  check)
    [ ! -f "$repo/kaputt" ] || { echo "Fatal: repository contains errors" >&2; exit 1; } ;;
  forget) ;;
  backup)
    nr="$(printf '%06d' "$(($(ls -1 "$repo/snapshots" | wc -l) + 1))")"
    id="$nr-$(head -c 32 /dev/urandom | sha256sum | cut -c1-64)"
    dir="$repo/snapshots/$id"
    mkdir -p "$dir/data"
    echo "$host" > "$dir/host"
    for p in "${args[@]}"; do
      mkdir -p "$dir/data$(dirname "$p")"
      cp -a "$p" "$dir/data$p"
    done
    files="$(find "$dir/data" -type f | wc -l)"
    bytes="$(find "$dir/data" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')"
    echo "{\"message_type\":\"summary\",\"total_files_processed\":$files,\"total_bytes_processed\":$bytes,\"snapshot_id\":\"${id#*-}\"}" ;;
  snapshots)
    ids=()
    if [ ${#args[@]} -gt 0 ]; then
      id="$(aufloesen "${args[0]}")"
      [ -z "$id" ] || ids=("$id")
    else
      mapfile -t ids < <(ls -1 "$repo/snapshots")
    fi
    if $json; then
      printf '['; sep=""
      for id in "${ids[@]}"; do printf '%s{"short_id":"%s"}' "$sep" "$(kurz "$id")"; sep=","; done
      echo ']'
    else
      for id in "${ids[@]}"; do echo "$(kurz "$id") $(cat "$repo/snapshots/$id/host")"; done
    fi ;;
  restore)
    id="$(aufloesen "${args[0]}")"
    [ -n "$id" ] || { echo "Fatal: no snapshot found" >&2; exit 1; }
    mkdir -p "$target"
    cp -a "$repo/snapshots/$id/data/." "$target/" ;;
  *)
    echo "restic-attrappe: unbekannter Befehl $befehl" >&2; exit 1 ;;
esac
