# Local image tags and registry publishing (deferred)

The local stack builds its images from the working tree and tags them
`student-management-ute-*:local`:

| Component | Local tag |
| --- | --- |
| Database | `student-management-ute-database:local` |
| REST API | `student-management-ute-restful-api:local` |
| RAG service | `student-management-ute-rag-service:local` |
| Frontend | `student-management-ute-frontend:local` |

`node scripts/local-dev.mjs up` builds every image from source and starts the
stack. `--no-build` only works when matching images already exist locally or were
pulled from a registry.

## External image digests

The external executables the stack does not build (`axllent/mailpit`, `node`,
`postgres`, `caddy`) run as `tag@sha256:<digest>` — the tag is for humans, the
OCI index (multi-arch) digest is what executes. `scripts/image-reference-policy.mjs`
enforces this without Docker: a new floating reference (`latest`, a missing tag,
a bare tag, or a malformed digest) fails the suite. The only exceptions are the
`student-management-ute-*:local` builds, the
`${E2E_CORE_API_IMAGE:-student-management-ute-restful-api:e2e-local}` default,
`scratch`, and the GHCR full-commit-SHA interpolation described below.

To refresh a pin: resolve the new OCI index digest for the tag from the
registry, update every occurrence of the reference together —
`docker-compose.yml`, `docker-compose.e2e.yml`, `scripts/caddy-validate.mjs`
and any Dockerfile `FROM` sharing the tag must move in lockstep — then rerun
`node --test scripts/image-reference-policy.test.mjs scripts/caddy-validate.test.mjs`,
`node scripts/dependency-baseline.mjs --check` and `git diff --check`. Runtime
overrides (`--image`, `CADDY_IMAGE`, `E2E_CORE_API_IMAGE`) stay the owner's
responsibility to keep digest-pinned or locally built.

## Publishing is deferred

This repository ships **no image publishing workflow**: `.github/workflows/ci.yml`
builds and tests only. Pushing these images to Docker Hub or GHCR is
**deferred — future deployment work** and is not authorized by the workspace's
local-first status.

If a commit is ever published externally, [RELEASE.md](RELEASE.md) holds the
rules: an immutable full-commit-SHA tag bound to
`org.opencontainers.image.revision`, BuildKit provenance and SBOM attestations,
no cross-registry `latest` move, and the no-build overlay
(`docker-compose.rag.override.yml`) pinned via `CAMPUSCORE_IMAGE_TAG` to that
same SHA.

## Hub namespace lookup

Do not guess the Docker Hub namespace from GitHub. Read it from the signed-in
Docker Desktop account: `%APPDATA%\Docker\login-info.json`, field `0` is Base64
JSON, decode it and use `Username`. Never commit that file; it is machine-local
login state.
