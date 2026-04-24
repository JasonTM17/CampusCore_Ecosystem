# CampusCore Load Testing

CampusCore load tests validate the local microservices stack without exposing
operator ports or secrets. The default path is intentionally staged: prove the
app is healthy, run targeted student-core flows, then increase pressure only
when the previous lane is clean.

## Quick start

Run from the repository root:

```powershell
node scripts/run-production-validation.mjs --profile=smoke
node scripts/run-production-validation.mjs --profile=balanced
```

The production validation runner checks the local app, container inventory,
observability smoke, finance E2E, and k6 scenarios. If `k6` is not installed on
the host, it automatically uses the official Docker image.

## Production validation profiles

| Profile | Purpose | Default pressure | Mutates data |
| --- | --- | --- | --- |
| `smoke` | Health and login sanity check | 1 VU for 30s | Login/session only |
| `balanced` | Realistic local validation for student core, checkout, admin analytics, and registration posture | 2-5 VUs for about 1-2 minutes | Checkout attempts may be created |
| `stress` | Higher local pressure after balanced is clean | Up to 35 read VUs plus checkout arrival rate | Checkout attempts may be created |

Registration contention is read-safe by default. To actively submit enrollment
requests during contention, set:

```powershell
$env:K6_ENABLE_MUTATING_REGISTRATION = "1"
$env:K6_HOT_SECTION_ID = "<section-id>"
node scripts/run-production-validation.mjs --profile=stress
```

Only enable mutating registration tests against a database prepared for load
testing. Confirmed enrollments, waitlists, and payment attempts can change local
state.

## Dockerized k6 fallback

If host `k6` is missing, the runner executes the official Docker image:

```powershell
docker run --rm -v <repo>:/work -w /work grafana/k6:0.52.0 run load-tests/src/production-validation.js
```

Dockerized k6 reaches the local app through `host.docker.internal` by default.
Override these values when needed:

```powershell
$env:DOCKER_K6_BASE_URL = "http://host.docker.internal"
$env:DOCKER_K6_API_BASE_URL = "http://host.docker.internal/api/v1"
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `BASE_URL` | `http://127.0.0.1` | Host URL for local app probes and host k6 |
| `API_BASE_URL` | `http://127.0.0.1/api/v1` | API URL for host k6 |
| `DOCKER_K6_BASE_URL` | `http://host.docker.internal` | App URL from inside the k6 container |
| `DOCKER_K6_API_BASE_URL` | `http://host.docker.internal/api/v1` | API URL from inside the k6 container |
| `K6_USERS_EMAIL` | `student1@campuscore.edu` | Seeded student account |
| `K6_USERS_PASSWORD` | `password123` | Seeded student password |
| `K6_ADMIN_EMAIL` | `admin@campuscore.edu` | Seeded admin account |
| `K6_ADMIN_PASSWORD` | `admin123` | Seeded admin password |
| `K6_PAYMENT_PROVIDERS` | `MOMO,ZALOPAY,VNPAY,PAYPAL,CARD` | Providers to rotate during checkout pressure |
| `K6_ENABLE_MUTATING_REGISTRATION` | `0` | Set to `1` to submit enrollment attempts |
| `K6_HOT_SECTION_ID` | unset | Optional section id for contention tests |

## Legacy runner

The original k6 entrypoint remains available:

```powershell
.\load-tests\scripts\run-tests.ps1 smoke
.\load-tests\scripts\run-tests.ps1 load
.\load-tests\scripts\run-tests.ps1 stress
```

Use the production validation runner for current release-readiness checks.

## Scenarios covered

- Public health and login.
- Student workspace reads: sections, enrollments, grades, schedule, transcript,
  invoices, and notifications.
- Student checkout initiation across MoMo, ZaloPay, VNPay, PayPal, and hosted
  card checkout.
- Admin analytics cockpit reads.
- Registration contention posture and optional mutating enrollment attempts.
- Payment replay/idempotency checks through repeated checkout initiation.

## Reports

Generated summaries are written to:

```text
load-tests/reports/
```

This directory is ignored by Git. Attach reports manually only when they are
needed for an issue or release investigation, and never include secrets, tokens,
or raw customer data.

## Interpreting failures

- `health` or `login` failure usually means the local edge or auth service is
  unavailable.
- High p95/p99 latency on local Docker can come from CPU, memory, or home
  network limits. Re-run `node scripts/run-container-inventory.mjs` before
  assuming a code regression.
- 4xx responses during checkout or registration are acceptable only when they
  represent known product states such as duplicate enrollment, active checkout,
  closed windows, or validation errors. 5xx responses are blockers.
- Cloudflare Tunnel performance is bounded by the local machine and network.
  Use local Compose/edge for repeatable load tests and use the tunnel for visual
  review or light external smoke only.

## Acceptance posture

A production-like local validation pass means:

- Local CampusCore containers are healthy or documented.
- Observability smoke passes for Prometheus, Grafana, Loki, and Tempo.
- Finance E2E completes a sandbox checkout and syncs the invoice timeline.
- k6 balanced profile completes without 5xx spikes or threshold failures.
- Registration invariants remain safe: no over-capacity confirmations, no
  duplicate enrollment, and no inconsistent waitlist ordering.
