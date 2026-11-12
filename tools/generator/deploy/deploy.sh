#!/usr/bin/env bash
# Deploys one generator image on the VPS: pulls it, restarts on it, and
# waits for it to report healthy. Run in ~/server/apps/notecom-generator:
#
#   ./deploy.sh sha-<commit>      # a specific build
#   ./deploy.sh                   # latest
#
# Running jobs are handed back to the queue on stop (stop_grace_period) and
# picked up by the new container, continuing any reply cut short.
set -euo pipefail
cd "$(dirname "$0")"

tag="${1:-latest}"
[ -f .env ] || { echo "missing .env (NATS_TOKEN=\$(openssl rand -hex 32))" >&2; exit 1; }
[ -f .env.production ] || { echo "missing .env.production (copy .env.example)" >&2; exit 1; }

export IMAGE_TAG="$tag"
# A tag that isn't on GHCR yet (an image loaded by hand) is used as it is.
docker compose pull --ignore-pull-failures generator
docker compose up -d --remove-orphans

for _ in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' notecom-generator 2>/dev/null || echo starting)
  if [ "$state" = healthy ]; then
    echo "notecom-generator $tag is healthy"
    exit 0
  fi
  sleep 2
done
echo "notecom-generator did not become healthy; last logs:" >&2
docker logs --tail 50 notecom-generator >&2
exit 1
