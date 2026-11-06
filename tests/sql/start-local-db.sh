#!/usr/bin/env bash
# Starts a throwaway Postgres for tests/sql (used on a dev machine; CI uses a service container).
# Prints the connection URL to use as DATABASE_URL.
set -euo pipefail
DIR="${1:-/var/tmp/my-budget-testdb}"
PORT="${PGPORT:-54329}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
RUN=""; [ "$(id -u)" = "0" ] && RUN="runuser -u postgres --"
rm -rf "$DIR"; mkdir -p "$DIR"; [ -n "$RUN" ] && chown postgres "$DIR"
$RUN "$BIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
$RUN "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
echo "postgresql://postgres@/postgres?host=$DIR&port=$PORT"
