#!/usr/bin/env bash
# Backup → restore → verify drill (docs/runbooks/backup-restore.md).
#
#   SOURCE_URL=postgresql://... TARGET_ADMIN_URL=postgresql://.../postgres ./infra/scripts/restore-drill.sh
#
# Restores a logical dump of SOURCE into a NEW, throwaway database
# (takawise_restore_drill_<timestamp>) on the target server, runs
# verify-ledger.sql on both, compares the fingerprints and drops the drill
# database. It never writes to the source database.
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is required}"
: "${TARGET_ADMIN_URL:?TARGET_ADMIN_URL (a maintenance DB, e.g. /postgres) is required}"
DRILL_DB="takawise_restore_drill_$(date -u +%Y%m%d%H%M%S)"
DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TARGET_URL="${TARGET_ADMIN_URL%/*}/${DRILL_DB}"

echo "1/5 dump source"
time pg_dump --format=custom --no-owner --no-privileges --file="$WORK/takawise.dump" "$SOURCE_URL"

echo "2/5 create $DRILL_DB"
psql "$TARGET_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DRILL_DB\""

echo "3/5 restore"
time pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_URL" "$WORK/takawise.dump"

echo "4/5 verify"
psql "$SOURCE_URL" -v ON_ERROR_STOP=1 -f "$DIR/verify-ledger.sql" > "$WORK/source.txt"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f "$DIR/verify-ledger.sql" > "$WORK/restored.txt"
cat "$WORK/restored.txt"
if grep -E '^violations\.' "$WORK/restored.txt" | grep -vE '\|0$'; then
  echo "FAIL: integrity violations in the restored database" >&2; exit 1
fi
if ! diff -u "$WORK/source.txt" "$WORK/restored.txt"; then
  echo "FAIL: restored fingerprint differs from the source" >&2; exit 1
fi

echo "5/5 drop $DRILL_DB"
psql "$TARGET_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$DRILL_DB\""
echo "PASS: restore drill completed"
