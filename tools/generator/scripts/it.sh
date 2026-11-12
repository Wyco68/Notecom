#!/usr/bin/env bash
# Runs the generator's integration test (internal/it) against a throwaway
# Postgres and NATS in Docker, then removes both.
#
#   tools/generator/scripts/it.sh
set -euo pipefail
cd "$(dirname "$0")/.."

pg=notecom-it-pg
nats=notecom-it-nats
cleanup() { docker rm -f "$pg" "$nats" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$pg" -e POSTGRES_PASSWORD=it -p 127.0.0.1:55432:5432 postgres:17-alpine >/dev/null
docker run -d --name "$nats" -p 127.0.0.1:54222:4222 nats:2.11-alpine -js >/dev/null

for _ in $(seq 1 60); do
  docker exec "$pg" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 1

IT_ADMIN_URL="postgres://postgres:it@127.0.0.1:55432/postgres?sslmode=disable" \
IT_NATS_URL="nats://127.0.0.1:54222" \
  go test -tags integration -count=1 "$@" ./internal/it/
