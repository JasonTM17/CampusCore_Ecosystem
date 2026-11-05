# Course Release Checklist

This checklist proves a reproducible local/course demo only. It does not
authorize production deployment.

## Clean candidate

- Record exact `main`, candidate and tree SHA.
- Verify `git status --short` is empty before review.
- Confirm no legacy backend, K8s, monitoring or retired image reference
  remains. The internal `rag-service` sidecar is an intentional course-runtime
  component and is addressed only through its token-protected
  `/internal/rag/**` contract. This repository does not contain an image
  publishing workflow: the local compose stack builds from the working tree,
  and any registry-published image is an optional external artefact pinned by
  full commit SHA (never `latest`).

## API and database

```powershell
node scripts/compose-secrets.mjs --ensure  # includes ASSISTANT_RAG_OWNER_ASSERTION_SECRET
mvn -q -f java-services/pom.xml verify
docker compose -f docker-compose.yml -f docker-compose.local.yml config -q
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build postgres mailpit rag-service restful-api web
curl.exe http://127.0.0.1:4010/api/v1/health/liveness
$env:HEALTH_READINESS_KEY = ((Get-Content .env | Select-String '^HEALTH_READINESS_KEY=').Line -split '=', 2)[1]
curl.exe -H "X-Health-Key: $env:HEALTH_READINESS_KEY" http://127.0.0.1:4010/api/v1/health/readiness
curl.exe http://127.0.0.1:4010/v3/api-docs
curl.exe http://127.0.0.1:3000/
curl.exe http://127.0.0.1:8025/
```

Verify a fresh PostgreSQL database, Flyway versions, deterministic seed
counts, login, role isolation, enrollment transaction rules, grade publishing,
thesis group limits and assistant citations/locale fallback/outage behavior.
Also verify the forward-only V12 assistant migration, conversation ownership,
idempotency ledger, quota buckets, terminal CAS/cancel race and knowledge
revision workflow. Provider tests must use a no-network fake by default; a live
DeepSeek smoke is optional, chargeable and only allowed after a rotated runtime
key is injected explicitly. Java 21 is the course compile, CI, and Docker runtime authority for this
successor. A local run on another JDK is recorded as NOT_RUN for that gate.

If an image set was published externally for a reviewed commit, it mirrors the
local stack and can be smoked without a rebuild. Pin `CAMPUSCORE_IMAGE_TAG` to
the reviewed full commit SHA for a reproducible smoke. The published-artifact
overlay rejects an unset tag so a moving registry alias cannot be selected
accidentally. This includes `student-management-ute-database`, a thin
`postgres:15-alpine` wrapper with no migrations or credentials. Flyway in the
Java services (rag-service in compose / REST API standalone) remains the only
schema/seed owner; upgrading PostgreSQL requires a fresh database and the same
Flyway/health checks above:

```powershell
$env:CAMPUSCORE_IMAGE_TAG = "<full-commit-sha>"
docker compose -f docker-compose.yml -f docker-compose.rag.override.yml -f docker-compose.local.yml up -d --no-build postgres mailpit rag-service restful-api web
```

The overlay is optional; the default local path builds every image from source.
If an external publisher produced images, each registry must receive an
immutable full-commit-SHA tag bound to `org.opencontainers.image.revision`,
with BuildKit provenance and SBOM attestations, and no non-atomic
cross-registry `latest` move. Verify the manifests of whichever registries you
actually published to before announcing a release:

```powershell
docker manifest inspect docker.io/nguyenson1710/student-management-ute-frontend:<full-commit-sha>
docker manifest inspect ghcr.io/jasontm17/student-management-ute-frontend:<full-commit-sha>
```

## Clients

```powershell
npm test --prefix frontend
npm run typecheck --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
npm test --prefix mobile
npm run typecheck --prefix mobile
```

Review web routes at 1440px, 768px and 390px. Review authenticated student,
lecturer and admin flows, keyboard/focus behavior, loading/empty/error/
forbidden states, console output and failed network requests.

### Mobile verification & Android emulator test path

Review mobile login, refresh, logout and core student flows on an emulator or device:

1. **Maestro device e2e smoke** (requires running emulator/device e.g. `emulator-5554`):
   ```powershell
   npm run test:device --prefix mobile -- --platform android --device <id> --flow core
   ```
2. **Text scaling validation**:
   ```powershell
   adb shell settings put system font_scale 2.0   # test 200% scaling
   adb shell settings put system font_scale 1.0   # restore baseline
   ```
3. **App links & deep link verification**:
   ```powershell
   adb shell am start -a android.intent.action.VIEW -d "https://www.campusute.io.vn/news" io.campuscore.mobile
   adb shell pm get-app-links io.campuscore.mobile
   ```
4. **Release build & signing**: Release tasks fail closed without operator keystore credentials (`CAMPUSCORE_RELEASE_STORE_FILE`, `CAMPUSCORE_RELEASE_STORE_PASSWORD`, `CAMPUSCORE_RELEASE_KEY_PASSWORD`, `CAMPUSCORE_RELEASE_KEY_ALIAS`); see [mobile/README.md](../mobile/README.md). Tests run on an emulator must be recorded as `EMULATOR_ONLY` and do not substitute for physical device acceptance.

## Git and cleanup

- Run `git diff --check` and `git fsck --connectivity-only --no-progress`.
- Obtain fresh Advisor, Kongming, Wukong, exact-head reviewer and Stitch
  verdicts on the same SHA.
- Treat unavailable reviewer capability as `BLOCKED_CAPABILITY`, never PASS.
- Report source/push and production cutover separately. Local tests, Compose,
  screenshots and a provider stub do not prove production readiness.
- Remove obsolete branches only with `git branch -d` after containment proof.
- Remove only exact old local microservice image tags after runtime proof.
- Never run `docker system prune`, `docker volume prune` or
  `docker compose down -v`.
