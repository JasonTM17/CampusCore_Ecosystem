#!/usr/bin/env bash
# Docker Hub Description Updater
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: DOCKERHUB_TOKEN=<token> DOCKERHUB_NAMESPACE=<namespace> ./scripts/update-hub-description.sh
Legacy: DOCKERHUB_TOKEN=<token> DOCKERHUB_USERNAME=<namespace> ./scripts/update-hub-description.sh
Legacy alias: DOCKERHUB_USERNAME
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

: "${DOCKERHUB_TOKEN:?Error: DOCKERHUB_TOKEN environment variable not set}"

DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-${DOCKERHUB_USERNAME:-}}"

if [ -z "${DOCKERHUB_NAMESPACE}" ]; then
    echo "Error: set DOCKERHUB_NAMESPACE (preferred) or DOCKERHUB_USERNAME"
    usage
    exit 1
fi

BACKEND_DESC="NestJS backend API for CampusCore academic management platform. Runtime includes PostgreSQL, Redis, RabbitMQ, MinIO, Swagger docs, and JWT auth."
FRONTEND_DESC="Next.js 15 standalone frontend for CampusCore academic platform. The app is designed to run behind the shared nginx reverse proxy in the compose stack."

update_description() {
    local repo_name="$1"
    local description="$2"
    local escaped_description

    escaped_description="$(printf '%s' "${description}" | sed ':a;N;$!ba;s/\\/\\\\/g;s/"/\\"/g;s/\n/\\n/g')"

    curl -fsS -X PATCH \
        "https://hub.docker.com/v2/repositories/${DOCKERHUB_NAMESPACE}/${repo_name}/" \
        -H "Authorization: Bearer ${DOCKERHUB_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"description\":\"${escaped_description}\"}" >/dev/null
}

echo "Updating Docker Hub descriptions for ${DOCKERHUB_NAMESPACE}..."

update_description "campuscore-backend" "${BACKEND_DESC}"
echo "Updated campuscore-backend"

update_description "campuscore-frontend" "${FRONTEND_DESC}"
echo "Updated campuscore-frontend"

echo "All Docker Hub descriptions updated successfully."
