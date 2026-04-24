# Release

## Release policy

- Branch pushes run CI only.
- Public registries publish only from semver tags such as `vX.Y.Z`.
- `latest` moves only with a semver release.
- GitHub Actions prefers `DOCKERHUB_TOKEN`; `DOCKERHUB_PASSWORD` remains a legacy fallback only.
- The CD badge in [README.md](../README.md) should point to the latest public semver tag because the gated publish workflow runs from release tags.

The current public release is **`v1.4.0`**. It follows the earlier `v1.3.6` Kubernetes and local-edge hardening baseline.

## Required quality gate

A release tag is valid only when `quality-gate` succeeds on that exact SHA.

Current required lanes:

- `core-quality`
- `core-integration`
- `auth-quality`
- `auth-integration`
- `notification-quality`
- `notification-integration`
- `finance-quality`
- `finance-integration`
- `academic-quality`
- `academic-integration`
- `engagement-quality`
- `engagement-integration`
- `people-quality`
- `people-integration`
- `analytics-quality`
- `analytics-integration`
- `frontend-quality`
- `frontend-fast-e2e`
- `compose-contract`
- `image-smoke`
- `edge-e2e`
- `security-scan`
- `quality-gate`

## Public images

Each public release must publish these nine images:

1. `campuscore-backend`
2. `campuscore-auth-service`
3. `campuscore-notification-service`
4. `campuscore-finance-service`
5. `campuscore-academic-service`
6. `campuscore-engagement-service`
7. `campuscore-people-service`
8. `campuscore-analytics-service`
9. `campuscore-frontend`

Every release is verified with:

- a semver tag such as `v1.4.0`
- an immutable short SHA tag
- `latest`

## Post-publish verification

After CD finishes, verify:

- manifests for all nine images with `node scripts/verify-release-manifests.mjs`
- published GHCR images with image smoke
- published Docker Hub images when Docker Hub credentials are configured

Example local verification:

```powershell
$env:RELEASE_TAG='v1.4.0'
$env:RELEASE_SHORT_SHA=(git rev-parse --short HEAD).Trim()
node scripts/verify-release-manifests.mjs
```

The verifier checks GHCR and Docker Hub for all nine images across the semver tag, short SHA, and `latest`. It uses modest concurrency, per-request timeouts, and retries to reduce false negatives from transient registry behavior.

## Kubernetes handoff

The repository ships Kustomize manifests under `k8s/` for the full nine-image topology.

Local-first path:

- `node scripts/run-k8s-preflight.mjs`
- `node scripts/run-k8s-local-smoke.mjs`
- `node scripts/run-k8s-local-deploy.mjs`
- `node scripts/run-k8s-local-edge.mjs`

Public/operator handoff path:

- `k8s/overlays/staging-generic`
- `k8s/overlays/prod-generic`
- `k8s/overlays/staging-operator`
- `k8s/overlays/prod-operator`
- `k8s/templates/private-operator/staging`
- `k8s/templates/private-operator/prod`

Use [docs/K8S_HANDOFF.md](./K8S_HANDOFF.md) for staging and production overlay handoff, and [docs/CLOUDFLARE.md](./CLOUDFLARE.md) when the public domain is fronted through Cloudflare.
