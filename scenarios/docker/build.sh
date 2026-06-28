#!/usr/bin/env bash
# Build the T5a pi-coding L4 harness image (ADR-0022).
# Rebuilds the vfkb dist first (the image bakes it), then docker-builds from the repo
# root so `COPY dist/` and `COPY scenarios/docker/models.json` resolve.
#
#   scenarios/docker/build.sh            # build + tag vfkb-l4-pi:dev
#   VFKB_L4_PI_IMAGE=foo:bar  ...       # override the tag
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${VFKB_L4_PI_IMAGE:-vfkb-l4-pi:dev}"

cd "$REPO"
echo "==> building dist (the image bakes the built substrate)"
npm run build >/dev/null

echo "==> docker build -t $IMAGE -f scenarios/docker/pi.Dockerfile ."
docker build -t "$IMAGE" -f scenarios/docker/pi.Dockerfile .

DIGEST="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
echo "==> built $IMAGE  ($DIGEST)"
