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
image="${IMAGE_REPO:-ghcr.io/wyco68/notecom-generator}:$tag"
# The image is public. Pull it anonymously: this box's ghcr.io login belongs
# to the other apps' private packages, and GHCR refuses it for this one
# rather than falling back to anonymous access. A tag that isn't on GHCR (an
# image loaded by hand) is used as it is.
anon=$(mktemp -d)
trap 'rm -rf "$anon"' EXIT
DOCKER_CONFIG="$anon" docker pull -q "$image" || echo "pull failed; using the local $image if there is one" >&2
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
