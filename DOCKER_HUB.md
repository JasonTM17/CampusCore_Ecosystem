# Docker Hub Images

CampusCore publishes two application images:

- `campuscore-backend`
- `campuscore-frontend`

Use the namespace that matches your Docker Hub account.

## Image contract

| Image                 | Internal port | Notes                                                          |
| --------------------- | ------------- | -------------------------------------------------------------- |
| `campuscore-backend`  | `4000`        | NestJS API, health at `/api/v1/health`, Swagger at `/api/docs` |
| `campuscore-frontend` | `3000`        | Next.js app served behind nginx in the compose stack           |

The published images do not include the reverse proxy. In the compose stacks, nginx is the public entrypoint.

## Pull

```bash
docker pull <namespace>/campuscore-backend:latest
docker pull <namespace>/campuscore-frontend:latest
```

## Build and push

```bash
DOCKERHUB_NAMESPACE=<namespace> ./scripts/docker-publish.sh latest
```

The script pushes both the chosen tag and the short git SHA.

## GitHub Actions publish

The release pipeline now uses two workflows:

- `CI Build and Test` as the quality gate for backend, frontend, compose contracts, image smoke, edge E2E, and security scanning
- `CD - Gated Registry Publish` for registry publishing after the matching CI run succeeds

Required secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_PASSWORD`

Optional secret:

- `DOCKERHUB_NAMESPACE` targets an organization or namespace. If it is not set, `DOCKERHUB_USERNAME` is used as the legacy namespace alias.

Manual runs accept an image tag input. Pushes to branches publish `latest` plus the commit SHA; version tags publish the tag name plus the commit SHA. Registry publishing is blocked until the same commit clears the CI quality gate.

## GitHub Packages

The same CD workflow also publishes container packages to GitHub Container Registry:

- `ghcr.io/jasontm17/campuscore-backend`
- `ghcr.io/jasontm17/campuscore-frontend`

GitHub Packages uses the repository owner namespace automatically, so no extra registry secret is required for that path.
New GHCR container packages are private on first publish by default. If you want anonymous pulls or a public package page, change the package visibility to `Public` once in GitHub Package settings.

## Compose usage

```yaml
services:
  backend:
    image: <namespace>/campuscore-backend:latest
    environment:
      PORT: 4000
      FRONTEND_URL: http://localhost
  frontend:
    image: <namespace>/campuscore-frontend:latest
    environment:
      NODE_ENV: production
```

In the full stack, users should open `http://localhost` instead of the backend or frontend containers directly.

## Description updates

```bash
DOCKERHUB_TOKEN=... DOCKERHUB_NAMESPACE=<namespace> ./scripts/update-hub-description.sh
```

## Notes

- Keep the Docker Hub namespace configurable through `DOCKERHUB_NAMESPACE` and accept `DOCKERHUB_USERNAME` as a legacy alias.
- Keep tags deterministic when releasing, and treat `latest` as a convenience tag only.
- If you change the runtime contract, update the descriptions and compose docs together.
