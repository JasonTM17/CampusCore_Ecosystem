#!/usr/bin/env bash
# Build and push CampusCore release images for Docker Hub.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_TAG="${1:-${IMAGE_TAG:-}}"
DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-${DOCKERHUB_USERNAME:-}}"
SHA="$(git rev-parse --short HEAD)"

usage() {
  cat <<'EOF'
Usage: DOCKERHUB_NAMESPACE=<namespace> ./scripts/docker-publish.sh <semver-tag>
Legacy alias: DOCKERHUB_USERNAME=<namespace> ./scripts/docker-publish.sh <semver-tag>
Legacy alias: DOCKERHUB_USERNAME

Builds and pushes:
  - <namespace>/campuscore-backend:<tag>
  - <namespace>/campuscore-notification-service:<tag>
  - <namespace>/campuscore-frontend:<tag>
  - matching commit-SHA tags
  - latest automatically when <tag> is a semver release such as v1.0.0
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

if [[ -z "${IMAGE_TAG}" ]]; then
  echo "Set IMAGE_TAG or pass an explicit semver tag such as v1.0.0."
  usage
  exit 1
fi

if [[ ! "$IMAGE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Refusing to publish non-semver tag: ${IMAGE_TAG}"
  echo "Public release publishing is semver-only."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found. Install Docker Desktop / Docker CLI first."
  exit 1
fi

IMAGES=(
  "campuscore-backend|backend/Dockerfile"
  "campuscore-notification-service|notification-service/Dockerfile"
  "campuscore-frontend|frontend/Dockerfile"
)

PUSH_LATEST=true

for ENTRY in "${IMAGES[@]}"; do
  IMAGE_NAME="${ENTRY%%|*}"
  DOCKERFILE="${ENTRY##*|}"
  FULL_IMAGE="${DOCKERHUB_NAMESPACE}/${IMAGE_NAME}"

  echo "Building ${FULL_IMAGE}:${IMAGE_TAG} from ${DOCKERFILE}"
  docker build -f "$DOCKERFILE" -t "${FULL_IMAGE}:${IMAGE_TAG}" .

  echo "Tagging ${FULL_IMAGE}:${SHA}"
  docker tag "${FULL_IMAGE}:${IMAGE_TAG}" "${FULL_IMAGE}:${SHA}"

  if [[ "$PUSH_LATEST" == true ]]; then
    echo "Tagging ${FULL_IMAGE}:latest"
    docker tag "${FULL_IMAGE}:${IMAGE_TAG}" "${FULL_IMAGE}:latest"
  fi

  echo "Pushing ${FULL_IMAGE}:${IMAGE_TAG}"
  docker push "${FULL_IMAGE}:${IMAGE_TAG}"
  echo "Pushing ${FULL_IMAGE}:${SHA}"
  docker push "${FULL_IMAGE}:${SHA}"

  if [[ "$PUSH_LATEST" == true ]]; then
    echo "Pushing ${FULL_IMAGE}:latest"
    docker push "${FULL_IMAGE}:latest"
  fi
done

echo "Docker images pushed for release tag ${IMAGE_TAG} and commit ${SHA}"
