#!/usr/bin/env bash
# Build and push frontend + backend images with a single command.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="${1:-latest}"
SHA="$(git rev-parse --short HEAD)"

declare -A DOCKERFILES=(
  ["nguyenson1710/campuscore-backend"]="backend/Dockerfile"
  ["nguyenson1710/campuscore-frontend"]="frontend/Dockerfile"
)

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found. Install Docker Desktop / Docker CLI first."
  exit 1
fi

for IMAGE in "${!DOCKERFILES[@]}"; do
  DOCKERFILE="${DOCKERFILES[$IMAGE]}"
  echo "🧱 Building ${IMAGE}:${TAG} from ${DOCKERFILE}"
  docker build -f "$DOCKERFILE" -t "${IMAGE}:${TAG}" .

  echo "🏷 Tagging ${IMAGE}:${SHA}"
  docker tag "${IMAGE}:${TAG}" "${IMAGE}:${SHA}"

  echo "📤 Pushing ${IMAGE}:${TAG}"
  docker push "${IMAGE}:${TAG}"
  echo "📤 Pushing ${IMAGE}:${SHA}"
  docker push "${IMAGE}:${SHA}"
done

echo "✅ Docker images pushed for tag ${TAG} and commit ${SHA}"
