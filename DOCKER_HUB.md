# Docker Hub Guide

CampusCore publishes two application images to Docker Hub:

- `campuscore-backend`
- `campuscore-frontend`

The target namespace is `nguyenson1710`.

## Namespace Rules

- `DOCKERHUB_NAMESPACE` is the preferred namespace input.
- `DOCKERHUB_USERNAME` is kept as a legacy alias for compatibility with older scripts and workflows.
- When both are present, automation should prefer `DOCKERHUB_NAMESPACE`.

## Image Contract

| Image | Internal port | Notes |
| --- | --- | --- |
| `campuscore-backend` | `4000` | NestJS 11 API, liveness at `/api/v1/health/liveness`, readiness at `/api/v1/health/readiness`, Swagger at `/api/docs` |
| `campuscore-frontend` | `3000` | Next.js frontend served in production-like mode with the standalone runtime |

The published images do not include nginx. In the compose stacks, nginx is the public entrypoint.

## Tag Strategy

Every release publishes the same image under these tags:

- `latest`
- semver tag such as `v1.0.0`
- immutable commit SHA tag such as `0f8bc44`

The important rule is simple: **`latest` only moves when a semver release is published**. Branch pushes do not advance public release tags.

## Pull Example

```bash
docker pull nguyenson1710/campuscore-backend:v1.0.0
docker pull nguyenson1710/campuscore-frontend:v1.0.0
docker pull nguyenson1710/campuscore-backend:0f8bc44
docker pull nguyenson1710/campuscore-frontend:0f8bc44
```

## Build and Push

The release pipeline builds from the real Dockerfiles:

- `backend/Dockerfile`
- `frontend/Dockerfile`

The normal release flow is:

1. CI verifies the exact commit.
2. CD publishes only after the commit clears the quality gate.
3. Public images are pushed only for semver tags `vX.Y.Z`.
4. The same release also pushes the immutable SHA tag.
5. `latest` is updated only alongside the semver release.

## Rollback

Prefer one of these rollback targets:

- the immutable digest reported by Docker Hub or `docker manifest inspect`
- the immutable SHA tag such as `0f8bc44`

That keeps rollback predictable and avoids depending on a moving `latest` tag.

## GitHub Actions

The repository uses GitHub Actions for both quality checks and release publishing:

- `CI Build and Test` runs the full quality matrix
- `CD - Gated Registry Publish` publishes to Docker Hub only when the triggering ref is a semver tag and the matching CI run has passed

Required Docker Hub secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_PASSWORD`

Optional secret:

- `DOCKERHUB_NAMESPACE`

## GitHub Container Registry

The same release process also publishes:

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-frontend`

GHCR uses the repository owner namespace automatically. New packages are private by default on first push, so visibility may need to be set to `Public` once in GitHub settings if anonymous pulls are desired.

## Compose Usage

```yaml
services:
  backend:
    image: nguyenson1710/campuscore-backend:v1.0.0
    environment:
      PORT: 4000
  frontend:
    image: nguyenson1710/campuscore-frontend:v1.0.0
```

Users should open `http://localhost` through nginx rather than talking to the backend or frontend containers directly.

## Description Updates

If you have a Docker Hub token, descriptions can be updated through the repo script:

```bash
DOCKERHUB_TOKEN=... DOCKERHUB_NAMESPACE=nguyenson1710 ./scripts/update-hub-description.sh
```

If no token is available, image publishing can still succeed, but repository description updates must be done manually or through an API token later.

## Notes

- Keep release tags deterministic.
- Treat `latest` as a convenience tag, not as the source of truth.
- If the runtime contract changes, update this guide together with the compose docs and release notes.
