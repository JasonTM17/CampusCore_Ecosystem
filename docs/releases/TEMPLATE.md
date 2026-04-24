# CampusCore vX.Y.Z

Release date: YYYY-MM-DD

## Summary

Describe the release in one short paragraph. State whether public APIs, auth/session contracts, service topology, or runtime ownership changed.

## Highlights

### Product and UX

- 

### Services and Runtime

- 

### Observability and Operations

- 

### Release Hardening

- 

## Compatibility

State any compatibility guarantees or migration notes. If nothing breaks, say that clearly.

## Published Images

1. `campuscore-backend`
2. `campuscore-auth-service`
3. `campuscore-notification-service`
4. `campuscore-finance-service`
5. `campuscore-academic-service`
6. `campuscore-engagement-service`
7. `campuscore-people-service`
8. `campuscore-analytics-service`
9. `campuscore-frontend`

## Verification

- CI quality gate:
- CD publish run:
- Manifest verification:
- Image smoke:
- Edge E2E:
- Security scan:

## Operator Notes

- Keep Grafana, Prometheus, Loki, Tempo, and metrics endpoints operator-only.
- Keep SMTP, payment provider, registry, and Kubernetes secrets out of repo-tracked docs and screenshots.
- Confirm release social preview and GitHub release body are synced after publish.
