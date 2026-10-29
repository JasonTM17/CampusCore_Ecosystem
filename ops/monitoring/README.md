# CampusCore Ecosystem Monitoring & Alert Rule Catalog

> **Operational Notice:**
> The Prometheus alert rules defined in this directory (`alerts-api-slo.yml`, `alerts-infrastructure.yml`, `alerts-assistant.yml`)
> are **declarative specifications only** (**NOT_RUN** against a live monitoring backend in this audit phase).
> They establish the service level objectives (SLOs), threshold baselines, and runbook linkage required
> for production deployment (Wave 3 / Backlog Lane F).

---

## 1. Metric Inventory: Code Verification vs "TO INSTRUMENT"

To ensure zero phantom metrics, every metric used in our operational contracts is explicitly audited
against the `java-services/restful-api` and `frontend` source code.

| Metric / Endpoint / Surface | Source File in Repository | Status in Code | Operational Purpose |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/health/liveness` | `java-services/restful-api/.../web/HealthController.java:43` | **VERIFIED_IN_CODE** | Container process liveness probe. Answers `{"status":"ok"}`. No dependency check. |
| `GET /api/v1/health/readiness` | `java-services/restful-api/.../web/HealthController.java:53` | **VERIFIED_IN_CODE** | Readiness probe. Requires `X-Health-Key`. Executes `SELECT 1` on PostgreSQL and verifies RLS. |
| `GET /actuator/health` | `java-services/restful-api/.../resources/application.yml:156` | **VERIFIED_IN_CODE** | Spring Boot Actuator health endpoint. Publicly permitted in `SecurityConfig.java:181`. |
| `GET /actuator/health/liveness` | `java-services/restful-api/.../resources/application.yml:159` | **VERIFIED_IN_CODE** | Built-in Actuator liveness probe (`management.endpoint.health.probes.enabled=true`). |
| `GET /actuator/health/readiness` | `java-services/restful-api/.../resources/application.yml:159` | **VERIFIED_IN_CODE** | Built-in Actuator readiness probe (`management.endpoint.health.probes.enabled=true`). |
| `GET /health` (Web Frontend) | `frontend/src/app/health/route.ts:6` | **VERIFIED_IN_CODE** | Edge/SSR health route. Proxies to `${JAVA_API_ORIGIN}/api/v1/health/liveness`. |
| `X-Request-Id` (Header & Attribute) | `java-services/restful-api/.../security/RequestIdFilter.java:19` | **VERIFIED_IN_CODE** | Validates `[A-Za-z0-9._:-]{1,128}` or generates UUID. Included in all error responses. |
| `X-RateLimit-*` & `Retry-After` | `java-services/restful-api/.../security/ratelimit/RateLimitFilter.java:121` | **VERIFIED_IN_CODE** | Rate limit quota headers and 429 response formatting with `RATE_LIMIT_EXCEEDED`. |
| `api.client.request` (Ring buffer) | `frontend/src/lib/observability.ts:18` & `mobile/.../observability.ts` | **VERIFIED_IN_CODE** | In-memory 100-entry ring buffer on client for diagnostic and future OTel telemetry. |
| `http_server_requests_seconds_*` | `pom.xml` (Actuator present, registry pending) | **TO INSTRUMENT** | Standard Spring Boot HTTP request timer. Requires `micrometer-registry-prometheus`. |
| `hikaricp_connections_*` | `pom.xml` (HikariCP pool configured in `application.yml:284`) | **TO INSTRUMENT** | HikariCP pool connection stats. Requires `micrometer-registry-prometheus`. |
| `campuscore_assistant_requests_total` | `ThesisAssistantController.java` | **TO INSTRUMENT** | Custom Micrometer meter with tags `{degraded="true|false", reason_code="..."}`. |
| `campuscore_assistant_quota_consumed`| `ThesisAssistantTurnRepository.java` | **TO INSTRUMENT** | Custom Micrometer gauge/counter for user & global daily quota tracking. |
| `campuscore_assistant_turn_stale_recovered`| `ThesisAssistantService.java:recovery` | **TO INSTRUMENT** | Counter incremented on recovery sweep of expired `RESERVED`/`DISPATCHED` leases. |
| `campuscore_assistant_rls_verified` | `AssistantDatabaseConfiguration.java` | **TO INSTRUMENT** | Gauge tracking verified (1) vs degraded (0) Assistant RLS database state. |

---

## 2. Alert Manifests

The alerting rules are partitioned into three portable Prometheus rule files:

### 1. `alerts-api-slo.yml`
Enforces API availability and latency/error-rate SLOs across critical user journeys:
- **Sign-in Journey** (`POST /api/v1/auth/login`, `POST /oauth2/token`):
  - Latency: P95 < 800ms (`SignInLatencyP95Breached`)
  - Server Error Rate: 5xx < 0.1% (`SignInServerErrorRateHigh`)
- **Course Registration Journey** (`POST /api/v1/academic/me/enrollments`, `POST /api/v1/academic/enrollments`, `DELETE /api/v1/academic/me/enrollments/{sectionId}`):
  - Latency: P95 < 500ms (`RegistrationLatencyP95Breached`)
  - Server Error Rate: 5xx < 0.2% (`RegistrationServerErrorRateHigh`)
- **Attendance Check-in Journey** (`POST /api/v1/attendance/sessions/{id}/checkin`):
  - Latency: P95 < 600ms (`AttendanceCheckinLatencyP95Breached`)
  - Server Error Rate: 5xx < 0.1% (`AttendanceCheckinServerErrorRateHigh`)
- **Grades & Transcript Read Journey** (`GET /api/v1/enrollments/my/grades`, `GET /api/v1/enrollments/my/transcript`, `GET /api/v1/grades/.*`):
  - Latency: P95 < 300ms (`GradesReadLatencyP95Breached`)
  - Server Error Rate: 5xx < 0.05% (`GradesReadServerErrorRateHigh`)
- **Rate-Limit Anomalies** (`RateLimitFilter`):
  - Global 429 response rate > 5% (`RateLimitSurgeDetected`)
  - Login 429 response rate > 50 req/min (`RateLimitLoginBruteForceSpike` — possible brute force / credential stuffing)

### 2. `alerts-infrastructure.yml`
Monitors platform health, connection pool capacity, and container lifecycles:
- **Database Connection Pool (HikariCP)**:
  - Warning: Active connections > 80% for 3m (`DatabaseConnectionPoolSaturationWarning`)
  - Critical: Active connections >= 95% or pending requests > 2 (`DatabaseConnectionPoolSaturationCritical`)
  - Critical: Connection acquisition timeouts > 0 (`DatabaseConnectionAcquisitionTimeout`)
- **Liveness vs Readiness Probe Health**:
  - Critical: Liveness probe failed for > 30s (`ServiceLivenessFailed` — container hung; restart authorized)
  - Warning: Readiness probe failed for > 1m (`ServiceReadinessFailed` — cut ingress; do NOT restart container)
- **Cold-Start Operations**:
  - Warning: Instance running but unready for > 90s (`ProlongedColdStartUnready`)
- **Frontend Health**:
  - Critical: Web route `/health` failing for > 1m (`WebFrontendHealthFailed`)

### 3. `alerts-assistant.yml`
Monitors AI campus assistant service health, provider availability, and quotas:
- **Degraded Response Rate**: > 20% of turns served as degraded lexical fallback over 10m (`AssistantHighDegradedRate`)
- **Quota Exhaustion**: Global daily synthesis attempts reach >= 90% (180/200) (`AssistantGlobalQuotaExhaustionRisk`)
- **RLS Degraded**: Assistant database RLS state degraded (`AssistantRlsStateDegraded` — causes 503 on chat)
- **Turn Recovery Surge**: Expired turn leases recovered > 5 in 10m (`AssistantStaleLeaseRecoverySurge`)

---

## 3. Severity Matrix & Incident Routing

| Severity | Operational Response Target | Escalation Channel | Example Triggers |
| :--- | :--- | :--- | :--- |
| `critical` | Immediate (< 15 minutes) | On-call paging, emergency release channel | Database pool exhausted; Liveness failure; Global 5xx > 1%; Login/Registration 5xx spike |
| `warning` | Within 2 hours | Ops/Engineering triage channel | HikariCP pool > 80%; Assistant quota > 90%; P95 latency breach; High 429 surge |
| `info` | Business hours review | Asynchronous metrics review | Daily quota reset; Routine instance restart |

---

## 4. Cold-Start & Probe Best Practices

When deploying onto platforms with container sleep/wake cycles (such as Render free tier or serverless containers):

1. **Health is NOT Readiness**:
   - `/api/v1/health/liveness` confirms the Spring Boot process is alive.
   - `/api/v1/health/readiness` confirms the database connection pool is warm, migrations are settled, and queries succeed.
2. **Probe Timing**:
   - Set orchestrator `initialDelaySeconds: 45` for liveness probes to avoid reboot loops while the JVM warms up and Flyway runs.
   - Configure readiness probe interval to `10s` with `failureThreshold: 3`.
3. **Client-Side Absorption**:
   - The web axios client automatically retries idempotent `GET` requests once with a 3-second backoff when receiving gateway 502/503/504 errors during instance wake-up.

---

## 5. Correlating Incidents Across Tiers (`X-Request-Id`)

When an alert fires or a user reports an error:
1. Extract `requestId` from the client response envelope (`ErrorResponse.requestId`), response header `X-Request-Id`, or client metric ring.
2. Search application logs:
   ```bash
   # Docker Compose / local container logs
   docker compose logs api | grep "<requestId>"

   # Production / aggregator log query (Loki / CloudWatch)
   {service="restful-api"} |= "<requestId>"
   ```
3. Join with web/mobile logs using the exact same identifier.
4. **Redaction Notice:** All logs pass through `redactForLog()`. Passwords, Bearer tokens, cookies, and student PII are redacted. Verify log hygiene using `node scripts/check-assistant-secrets.mjs`.

---

## 6. Runbook References

- Production Deployment & Operations: [PRODUCTION_RUNBOOK.md](file:///D:/CampusUTE_EcoSystem/docs/PRODUCTION_RUNBOOK.md)
- Demo Environment Operations: [DEMO_RUNBOOK.md](file:///D:/CampusUTE_EcoSystem/docs/DEMO_RUNBOOK.md)
- Assistant & RAG Operations: [deepseek-assistant.md](file:///D:/CampusUTE_EcoSystem/docs/integrations/deepseek-assistant.md)
- Supabase Assistant Knowledge: [supabase-assistant.md](file:///D:/CampusUTE_EcoSystem/docs/integrations/supabase-assistant.md)
- Observability & Telemetry Contract: [observability.md](file:///D:/CampusUTE_EcoSystem/docs/ecosystem/observability.md)
- Host & Edge Policy: [host-policy.md](file:///D:/CampusUTE_EcoSystem/docs/ecosystem/host-policy.md)
