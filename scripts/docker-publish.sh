#!/usr/bin/env bash
# Build and push frontend + backend images with a single command.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_TAG="${1:-${IMAGE_TAG:-latest}}"
DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-${DOCKERHUB_USERNAME:-}}"
SHA="$(git rev-parse --short HEAD)"

usage() {
  cat <<'EOF'
Usage: DOCKERHUB_NAMESPACE=<namespace> ./scripts/docker-publish.sh [tag]
Legacy: DOCKERHUB_USERNAME=<namespace> ./scripts/docker-publish.sh [tag]
Legacy alias: DOCKERHUB_USERNAME

Builds and pushes:
  - <namespace>/campuscore-backend:<tag>
  - <namespace>/campuscore-frontend:<tag>
  - matching commit-SHA tags
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${DOCKERHUB_NAMESPACE}" ]]; then
  echo "Set DOCKERHUB_NAMESPACE (preferred) or DOCKERHUB_USERNAME before publishing."
  usage
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found. Install Docker Desktop / Docker CLI first."
  exit 1
fi

IMAGES=(
  "campuscore-backend|backend/Dockerfile"
  "campuscore-frontend|frontend/Dockerfile"
)

for ENTRY in "${IMAGES[@]}"; do
  IMAGE_NAME="${ENTRY%%|*}"
  DOCKERFILE="${ENTRY##*|}"
  FULL_IMAGE="${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}"

  echo "Building ${FULL_IMAGE}:${IMAGE_TAG} from ${DOCKERFILE}"
  docker build -f "$DOCKERFILE" -t "${FULL_IMAGE}:${IMAGE_TAG}" .

  echo "Tagging ${FULL_IMAGE}:${SHA}"
  docker tag "${FULL_IMAGE}:${IMAGE_TAG}" "${FULL_IMAGE}:${SHA}"

  echo "Pushing ${FULL_IMAGE}:${IMAGE_TAG}"
  docker push "${FULL_IMAGE}:${IMAGE_TAG}"
  echo "Pushing ${FULL_IMAGE}:${SHA}"
  docker push "${FULL_IMAGE}:${SHA}"
done

echo "Docker images pushed for tag ${IMAGE_TAG} and commit ${SHA}"
