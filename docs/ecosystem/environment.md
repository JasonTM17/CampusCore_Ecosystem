# Runtime environment variables (operator reference)

Single inventory of every runtime variable referenced by
`java-services/restful-api/src/main/resources/application.yml` (115 `${...}` names),
`frontend/.env.example` + `frontend/next.config.mjs` + `process.env` usage,
`mobile/` `EXPO_PUBLIC_*` usage, `docker-compose*.yml`, and `render.yaml`.
Closes audit item AUD-27.

## Rules

- **Secret values live only in the host's secret manager** (Render dashboard,
  Docker `ops/secrets/*` files read via `*_FILE` indirection in prod compose, or
  gitignored `.env*` files) — **never in this repository, never in the mobile
  bundle.** `EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` are inlined into public
  bundles: public by definition, secrets forbidden.
- **Class:** `secret` | `public` (shipped to browsers/apps) | `config`
  (server-side operator setting).
- **Required in:** `local` (jar/dev), `compose` (local stack), `prod` (prod
  compose), `render`, `vercel`, `mobile-build`, `e2e`, `sso-preview`.
- **Default policy:** `safe default` | `required` (no usable default) |
  `forbidden in prod` (must stay off/absent publicly).
- Indexed bindings (`IDENTITY_CLIENTS_*`, `IDENTITY_KEYS_*`,
  `IDENTITY_BFF_SURFACES_*`, `SPRING_MAIL_PROPERTIES_MAIL_SMTP_*` overrides) are
  relaxed-binding families — one row each below.

## 1. Runtime / server

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `SERVER_PORT`, `PORT` | HTTP port of restful-api (`PORT` = PaaS/Render alias) | config | all | safe default `4010` |
| `SERVER_FORWARD_HEADERS_STRATEGY` | Tomcat forwarded-header handling behind proxy | config | prod | safe default (`native`) |
| `TOMCAT_MAX_THREADS`, `TOMCAT_MIN_SPARE_THREADS` | Tomcat worker pool sizing | config | optional tuning | safe default |
| `SPRING_PROFILES_ACTIVE` | Active Spring profile (`e2e` in e2e compose) | config | e2e | safe default |
| `JAVA_TOOL_OPTIONS` | JVM flags (Render memory tuning) | config | render | safe default |
| `APP_PUBLIC_BASE_URL` | Public origin used in outbound mail links | config | prod (links correct) | safe default localhost |
| `APP_CORS_ALLOWED_ORIGIN_PATTERNS` | Extra CORS origins for non-web clients | config | optional | safe default (empty) |

## 2. Sessions & security

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `JWT_SECRET` | HMAC key for access tokens | secret | all | required, no safe default |
| `JWT_REFRESH_SECRET` | HMAC key for refresh tokens | secret | all | required, no safe default |
| `JWT_ACCESS_TOKEN_TTL_SECONDS`, `JWT_REFRESH_TOKEN_TTL_SECONDS` | Token lifetimes | config | optional | safe default |
| `SECURITY_JWT_REJECT_KNOWN_DEFAULTS` | Fail-fast if demo JWT secrets leak to prod | config | prod | safe default `false` (set `true` in prod) |
| `ACCESS_TOKEN_COOKIE`, `REFRESH_TOKEN_COOKIE` | Cookie names for web session tokens | config | optional | safe default |
| `CSRF_COOKIE`, `CSRF_HEADER` | CSRF cookie/header names | config | optional | safe default |
| `COOKIE_SECURE` | `Secure` flag on cookies | config | all | safe default dev; must be `true` behind HTTPS |
| `HEALTH_READINESS_KEY` | Bearer key for `X-Health-Key` readiness probe | secret | all | required |
| `INTERNAL_SERVICE_TOKEN` | Internal service-to-service auth token | secret | e2e | required when used |

## 3. Databases & pools

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` | Main JDBC connection (local DB or Neon) | secret (URL+password) | local, render | required outside compose |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Postgres container bootstrap credentials | secret | compose, prod, e2e | required by compose |
| `POSTGRES_HOST_PORT` | Host port published to postgres | config | compose, e2e | safe default `5432` |
| `FLYWAY_ENABLED` | Run Flyway migrations on boot | config | all | safe default `true` |
| `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_KEEPALIVE_MS` | Hikari pool sizing/idle | config | tuning | safe default |
| `DB_CONNECTION_TIMEOUT_MS`, `DB_VALIDATION_TIMEOUT_MS` | Hikari acquire/validate timeouts | config | tuning | safe default |
| `ASSISTANT_DB_URL`, `ASSISTANT_DB_USERNAME`, `ASSISTANT_DB_PASSWORD` | Separate assistant (RAG) datasource, prod | secret | prod | required when sidecar DB split |
| `ASSISTANT_DB_POOL_MAX`, `ASSISTANT_DB_CONNECTION_TIMEOUT_MS`, `ASSISTANT_DB_IDLE_TIMEOUT_MS`, `ASSISTANT_DB_KEEPALIVE_TIME_MS` | Assistant pool tuning | config | tuning | safe default |

## 4. Mail (SMTP)

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `MAIL_ENABLED` | Enable outbound email (2FA OTP, notifications) | config | all | safe default `false` |
| `SPRING_MAIL_HOST`, `SPRING_MAIL_PORT` | SMTP host/port (Mailpit local, real SMTP prod) | config | compose, prod | safe default Mailpit |
| `SPRING_MAIL_USERNAME`, `SPRING_MAIL_PASSWORD` | SMTP credentials | secret | prod | required when auth enabled |
| `SPRING_MAIL_PROPERTIES_MAIL_SMTP_*` (`_AUTH`, `_STARTTLS_ENABLE`, `_STARTTLS_REQUIRED`, `_CONNECTIONTIMEOUT`, `_TIMEOUT`, `_WRITETIMEOUT`) | Relaxed-binding overrides for `spring.mail.properties.mail.smtp.*` | config | optional | safe default |
| `MAIL_FROM`, `MAIL_SENDER_NAME` | Envelope/header sender identity | config | optional | safe default |

## 5. Rate limiting, demo gate, academic

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `RATE_LIMIT_ENABLED` | Global rate-limit switch | config | optional | safe default `true` |
| `RATE_LIMIT_TRUST_PROXY_HEADERS`, `RATE_LIMIT_TRUST_REAL_IP` | Trust `X-Forwarded-For`/real IP from proxy | config | prod behind proxy | forbidden unless proxy strips spoofed headers |
| `RATE_LIMIT_PROXY_TOKEN` | Shared token proving request came via trusted edge | secret | prod (with trusted proxy) | required only with trusted-proxy mode |
| `RATE_LIMIT_LOGIN`, `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_WINDOW_SECONDS` | Bucket sizes + window | config | tuning | safe default |
| `DEMO_ACCOUNTS_ENABLED` | Unlocks seeded demo accounts each boot | config | local demo only | **forbidden in prod** (`render.yaml` sets `false`) |
| `DEMO_ACCOUNTS_ROLES` | Restrict which demo roles unlock | config | local demo | safe default all demo roles |
| `REGISTRATION_CREDIT_LIMIT_OVERRIDE` | Override credit cap for enrollment (0 = rule-driven) | config | optional | safe default `0` |
| `ACADEMIC_ENROLLED_COUNT_RECONCILE_DELAY_MS`, `_INITIAL_DELAY_MS`, `ACADEMIC_ENROLLED_COUNT_REPAIR` | Enrolled-count reconciliation cadence + repair mode | config | tuning | safe default |

## 6. Identity (OIDC issuer + BFF)

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `IDENTITY_OIDC_ENABLED` | Enable in-app OIDC issuer (`id.campusute.io.vn`) | config | optional | safe default `false` |
| `IDENTITY_OIDC_AUTHORIZE_PAUSED` | Pause authorize endpoint while issuer up | config | rollout | safe default |
| `IDENTITY_DEV_KEYGEN` | Generate ephemeral dev signing keys | config | local only | **forbidden in prod** |
| `IDENTITY_ISSUER_URI` | Public issuer URL (prod `https://id.campusute.io.vn`) | config | sso-preview, prod issuer | required when OIDC on |
| `IDENTITY_LOGIN_PAGE` | Hosted login page URL | config | OIDC on | safe default |
| `IDENTITY_TOKEN_ENCRYPTION_KEY` | Encrypts stored OIDC tokens at rest | secret | OIDC on | required |
| `IDENTITY_NATIVE_REFRESH_CLIENT_IDS` | Client ids allowed native refresh | config | mobile prod | safe default |
| `IDENTITY_RETENTION_ENABLED`, `IDENTITY_RETENTION_CRON`, `IDENTITY_RETENTION_GRACE` | Purge cadence for expired OIDC artifacts | config | OIDC on | safe default |
| `IDENTITY_BFF_ENABLED`, `IDENTITY_BFF_DEV_HTTP` | Backend-for-frontend edge + dev http tolerance | config | optional | `DEV_HTTP` forbidden in prod |
| `IDENTITY_BFF_ISSUER_LOOPBACK`, `IDENTITY_BFF_ISSUER_PUBLIC` | Server-side vs public issuer base URLs | config | BFF on | safe default |
| `IDENTITY_BFF_SESSION_TTL`, `IDENTITY_BFF_TX_TTL` | BFF session + transaction lifetimes | config | BFF on | safe default |
| `IDENTITY_CLIENTS_*`, `IDENTITY_KEYS_*`, `IDENTITY_BFF_SURFACES_*` | Indexed families: OIDC clients, signing keys, BFF surface hosts | mixed (keys secret) | per feature | required when feature on |
| `SSO_PREVIEW_PROXY_TOKEN`, `SSO_PREVIEW_PORTAL_BASE`, `SSO_PREVIEW_LEARN_BASE`, `SSO_PREVIEW_APPLY_BASE` | SSO-preview stack edge token + surface URLs | `PROXY_TOKEN` secret; bases config | sso-preview | required for sso-preview stack |

## 7. Assistant, RAG, DeepSeek, Supabase, storage

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `ASSISTANT_RAG_BASE_URL`, `ASSISTANT_RAG_SERVICE_MODE` | Sidecar URL (`:4011`) + embedded/sidecar mode | config | compose, prod | safe default |
| `ASSISTANT_RAG_SERVICE_TOKEN` | Token backend→rag-service auth | secret | compose, prod | required for sidecar mode |
| `ASSISTANT_RAG_CONNECT_TIMEOUT_MS`, `ASSISTANT_RAG_READ_TIMEOUT_MS` | Sidecar HTTP timeouts | config | tuning | safe default |
| `ASSISTANT_KNOWLEDGE_SNAPSHOT_CACHE`, `ASSISTANT_KNOWLEDGE_SNAPSHOT_TTL_MS` | Knowledge snapshot cache on/TTL | config | tuning | safe default |
| `ASSISTANT_TOP_K`, `ASSISTANT_LEXICAL_FAST_PATH`, `ASSISTANT_LEXICAL_CONFIDENT_SCORE` | Retrieval size + lexical fast-path threshold | config | tuning | safe default |
| `ASSISTANT_MAX_MESSAGE_CHARS`, `ASSISTANT_MAX_CONTEXT_CHARS` | Input/context truncation limits | config | tuning | safe default |
| `ASSISTANT_USER_DAILY_QUOTA`, `ASSISTANT_GLOBAL_DAILY_QUOTA`, `ASSISTANT_QUOTA_ENFORCED` | Per-user/global daily quotas + enforcement | config | compose, prod, render | safe default |
| `ASSISTANT_RETENTION_DAYS` | Assistant history retention window | config | optional | safe default |
| `ASSISTANT_RLS_TEST_MODE` | Row-level-security test mode | config | tests only | forbidden in prod |
| `ASSISTANT_RECOVERY_DELAY_MS`, `ASSISTANT_RECOVERY_INITIAL_DELAY_MS`, `ASSISTANT_RECOVERY_ACTIVE_WINDOW_MS`, `ASSISTANT_RECOVERY_SAFETY_INTERVAL_MS`, `ASSISTANT_RECOVERY_ACTIVITY_AWARE` | Recovery-job cadence + activity awareness | config | tuning | safe default |
| `ASSISTANT_KNOWLEDGE_AUTHORITY_MODE` | Which snapshot source is authoritative | config | optional | safe default |
| `DEEPSEEK_ENABLED` | Enable DeepSeek LLM escalation | config | all | safe default `false` |
| `DEEPSEEK_API_KEY` | DeepSeek API credential | secret | when enabled | required |
| `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | Endpoint + model (`deepseek-v4-flash`) | config | when enabled | safe default |
| `DEEPSEEK_TIMEOUT_MS`, `DEEPSEEK_MAX_CONCURRENT`, `DEEPSEEK_MAX_OUTPUT_TOKENS` | LLM call timeout/concurrency/tokens | config | tuning | safe default |
| `DEEPSEEK_MAX_FRAME_BYTES`, `DEEPSEEK_MAX_RESPONSE_BYTES` | Stream frame/response size caps | config | tuning | safe default |
| `SUPABASE_URL`, `SUPABASE_SCHEMA`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DOCUMENT_TABLE`, `SUPABASE_RELEASE_TABLE`, `ASSISTANT_SUPABASE_ENABLED` | Supabase release/document storage (key = service-role!) | URL/schema config; `SERVICE_ROLE_KEY` secret | prod | key required when enabled |
| `ASSISTANT_SUPABASE_CONNECT_TIMEOUT_MS`, `ASSISTANT_SUPABASE_READ_TIMEOUT_MS`, `ASSISTANT_SUPABASE_RECONCILE_DELAY_MS`, `ASSISTANT_SUPABASE_RECONCILE_INITIAL_DELAY_MS` | Supabase HTTP timeouts + reconcile cadence | config | tuning | safe default |
| `THESIS_REPORT_STORAGE_PROVIDER`, `THESIS_REPORT_STORAGE_BUCKET`, `THESIS_REPORT_STORAGE_LOCAL_ROOT`, `THESIS_REPORT_STORAGE_TIMEOUT_MS` | Thesis report object store (local vs bucket) | config | compose, prod | safe default `local` |

## 8. Web frontend (Next.js)

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | API base seen by browser (`/api/v1` same-origin) | public | vercel, local | safe default `/api/v1` |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL for metadata | public | vercel | safe default localhost |
| `NEXT_PUBLIC_BFF_LANE`, `NEXT_PUBLIC_SURFACE_HOSTS` | BFF lane selection + allowed surface hosts | public | BFF on | safe default |
| `NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS` | Show "fill demo" button on login | public | local demo only | **forbidden in prod** |
| `NEXT_PUBLIC_DEMO_STUDENT_PASSWORD`, `NEXT_PUBLIC_DEMO_LECTURER_PASSWORD`, `NEXT_PUBLIC_DEMO_DEAN_PASSWORD` | Prefill values for demo button | public (demo only) | local demo only | **forbidden in prod** |
| `JAVA_API_ORIGIN`, `BACKEND_INTERNAL_ORIGIN` | Server-side proxy target (compose arg/runtime) | config | compose, vercel | safe default |
| `CAMPUSCORE_PROXY_TOKEN` | Edge→backend shared secret for proxy routes | secret | when edge token used | required then |
| `OUTPUT_STANDALONE` | `output: 'standalone'` for slim Docker image | config | docker build | safe default `false` |
| `NODE_ENV`, `PORT`, `HOSTNAME` | Next runtime env (standalone server) | config | docker run | safe default |
| `VERCEL`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | Vercel-injected deployment context | public | vercel | platform-injected |

## 9. Mobile (Expo)

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `EXPO_PUBLIC_API_MODE` | `preview` (offline sample data) or `live` | public | mobile-build | safe default `preview` |
| `EXPO_PUBLIC_API_URL` | REST base (`10.0.2.2` emulator / LAN IP / prod host) | public | mobile-build live | required in live mode |
| `EXPO_PUBLIC_ISSUER_URL` | OIDC issuer when it differs from API host | public | prod sign-in | required for prod login |
| `EXPO_PUBLIC_PORTAL_URL` | Deep-link back to web portal | public | optional | safe default |
| `EXPO_PUBLIC_ASSISTANT_TRANSPORT` | Assistant SSE/fetch transport selection | public | optional | safe default |
| `EXPO_PUBLIC_LANE_DEAN`, `EXPO_PUBLIC_LANE_STAFF`, `EXPO_PUBLIC_LANE_ADMIN` | Lane feature flags | public | optional | safe default |

## 10. Compose / hosting only (not read by Spring)

| Variable | Purpose | Class | Required in | Default policy |
| --- | --- | --- | --- | --- |
| `RESTFUL_API_HOST_PORT`, `FRONTEND_HOST_PORT`, `MAILPIT_UI_HOST_PORT`, `MAILPIT_SMTP_HOST_PORT` | Host port publishes | config | compose | safe defaults `4010/3000/8025/1025` |
| `CAMPUSCORE_IMAGE_REGISTRY`, `CAMPUSCORE_IMAGE_TAG` | Image coordinates for prod compose | config | prod | required |
| `CAMPUSCORE_DOMAIN`, `ACME_EMAIL` | Caddy domain + ACME registration email | config | prod | required |
| `E2E_CORE_API_IMAGE`, `E2E_API_HOST_PORT` | Image under test + e2e host port | config | e2e | required/safe default |
| `SWAGGER_ENABLED`, `*_READ_ENABLED`, `*_WRITE_ENABLED`, `AUTH_LOGIN_ENABLED`, `THESIS_ASSISTANT_ENABLED`, `ACADEMIC_*_ENABLED`, `ENGAGEMENT_*_ENABLED`, `PEOPLE_READ_ENABLED`, `FINANCE_READ_ENABLED`, `ANALYTICS_READ_ENABLED`, `NOTIFICATIONS_READ_ENABLED`, `THESIS_READ_ENABLED`, `ACADEMIC_ENROLLMENT_READ_ENABLED`, `ACADEMIC_SCHEDULE_READ_ENABLED`, `ACADEMIC_WAITLIST_READ_ENABLED`, `ACADEMIC_ATTENDANCE_READ_ENABLED`, `ACADEMIC_SECTION_READ_ENABLED`, `ACADEMIC_CONTEXT_ENABLED` | E2E feature-gate matrix toggles | config | e2e | safe default |

## AUD-27 reconciliation

The 68 names the audit found undocumented are all documented in the tables
above: `ACADEMIC_ENROLLED_COUNT_*` (3), `ACCESS_TOKEN_COOKIE`,
`APP_PUBLIC_BASE_URL`, `ASSISTANT_DB_*` (5: `URL`, `POOL_MAX`,
`CONNECTION_TIMEOUT_MS`, `IDLE_TIMEOUT_MS`, `KEEPALIVE_TIME_MS`),
`ASSISTANT_KNOWLEDGE_SNAPSHOT_*` (2), `ASSISTANT_RAG_*` (4),
`ASSISTANT_RECOVERY_*` (2: `ACTIVE_WINDOW_MS`, `SAFETY_INTERVAL_MS`),
`ASSISTANT_RLS_TEST_MODE`, `ASSISTANT_SUPABASE_*` (4), `ASSISTANT_TOP_K`,
`CSRF_COOKIE`, `CSRF_HEADER`, `DB_POOL_*` (4), `DEEPSEEK_MAX_*` (3),
`IDENTITY_*` (15: `BFF_ENABLED`, `BFF_ISSUER_LOOPBACK`, `BFF_ISSUER_PUBLIC`,
`BFF_SESSION_TTL`, `BFF_TX_TTL`, `DEV_KEYGEN`, `ISSUER_URI`, `LOGIN_PAGE`,
`NATIVE_REFRESH_CLIENT_IDS`, `OIDC_AUTHORIZE_PAUSED`, `OIDC_ENABLED`,
`RETENTION_CRON`, `RETENTION_ENABLED`, `RETENTION_GRACE`,
`TOKEN_ENCRYPTION_KEY`), `JWT_*_TTL_SECONDS` (2), `MAIL_SENDER_NAME`,
`RATE_LIMIT_*` (5: `DEFAULT`, `ENABLED`, `LOGIN`, `PROXY_TOKEN`,
`WINDOW_SECONDS`), `REFRESH_TOKEN_COOKIE`,
`REGISTRATION_CREDIT_LIMIT_OVERRIDE`, `SERVER_FORWARD_HEADERS_STRATEGY`,
`SERVER_PORT`, `SPRING_DATASOURCE_*` (3), `SUPABASE_DOCUMENT_TABLE`,
`SUPABASE_RELEASE_TABLE`, `THESIS_REPORT_STORAGE_TIMEOUT_MS`, `TOMCAT_*` (2).

`java.io.tmpdir` in `application.yml` is a JVM property, not an env var —
excluded by design. Remaining gaps: none; every discovered name is listed.
