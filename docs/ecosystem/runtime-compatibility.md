# Runtime compatibility — Boot 3.5.16 → 4.1.1 (P02)

Status: **applied and locally verified** (P02 steps 1–2). Spike evidence collected
before the change is kept for provenance in §3/§4; §6–§8 record what actually
changed, the H2 regression finding, and the oracle result. Baseline tree:
`artifacts/verification/platform/deptree-3.5.16.txt`. Gate evidence:
`artifacts/verification/platform/`.

## 1. Dependency matrix (resolved — `mvn dependency:list` on the upgraded tree)

| Component | Before | After (resolved) | Notes |
| --- | --- | --- | --- |
| Spring Boot parent | 3.5.16 | **4.1.1** | 4.x GA line; 4.2 only at M2 (GA 2026-11-30) |
| Spring Framework | 6.2.19 | **7.0.9** | BOM-managed |
| Spring Security | 6.5.11 | **7.1.1** | BOM-managed; SAS 1.5 successor lives in Security 7 — P04 prerequisite |
| Hibernate ORM | 6.6.53 | **7.4.5.Final** | BOM-managed; `PreserveQuotedIdentifierNamingStrategy` kept working (deprecated-but-present SPI, see §6) |
| Flyway | 11.7.2 | **12.4.0** | via `spring-boot-starter-flyway` (new direct dep — see §6) |
| Tomcat embed | 10.1.59 (override pin) | **11.0.24** managed | override pin removed — Servlet 6.1 required |
| Jackson | 2.21.7 (override pin) | **3.1.5 `tools.jackson`** | override pin removed; package migration applied (§6) |
| springdoc-openapi | 2.8.17 | **3.1.1** | artifact id unchanged |
| nimbus-jose-jwt | 9.37.4 | **10.9.1** | BOM-managed |
| postgresql JDBC | 42.7.13 (pin) | 42.7.13 managed | pin dropped; resolved version identical |
| log4j-api | 2.25.5 (pin) | BOM-managed | pin dropped |
| commons-lang3 | 3.18.0 (pin) | BOM-managed | pin dropped |
| jsoup | 1.23.2 (pin) | keep pin | not Boot-managed |
| JUnit / AssertJ / Mockito | 5.12.2 / 3.27.7 / 5.17.0 | BOM-managed | `@MockitoSpyBean` unchanged |
| h2 (test) | 2.3.232 | **2.3.232 explicit test pin** | 2.4.240 regression — see §7 |
| JDK | release 21 | 21 | Dockerfile temurin-21 unchanged |

## 2. Support windows (research-verified)

- Boot 3.5.x + SAS 1.5: OSS support ended **2026-06-30** — previously unpatched.
- Boot 4.0: OSS ends 2026-12-31. **Boot 4.1.1: OSS to 2027-07-31** — chosen line.
- Constraint honored: no Expo/Next.js major bump alongside (frontend untouched).

## 3. Spike inventory (pre-change measurement)

| Area | Count | Expected delta |
| --- | --- | --- |
| `com.fasterxml.jackson.databind`/`core` imports | ~72 in 61 files | → `tools.jackson.databind`/`tools.jackson.core` |
| `com.fasterxml.jackson.annotation` imports | 15 files | kept — package unchanged in Jackson 3 (annotation jar stays Jackson 2 line) |
| `META-INF/spring.factories` | 1 (`EnvironmentPostProcessor`) | → `.imports` registration |
| `tomcat.version` override | pom property | removed |
| `javax.*` imports | 12 files | all `javax.crypto`/`javax.sql` — JDK packages, untouched |
| `@MockBean`/`WebSecurityConfigurerAdapter`/`.and()` DSL | 0 | clean — Security 7 lambda DSL already in use |
| PostgresITs | 13 `*PostgresIT` classes, `@EnabledIf(postgresTargetConfigured)` | env-gated; `platform` gate provisions the disposable DB and refuses zero-IT runs |

## 4. Properties renames (verified against resolved jars)

| Property | Outcome (verified) |
| --- | --- |
| `spring.mvc.*` | **Prefix still bound in Boot 4.1.1** — checked `spring-boot-webmvc-4.1.1.jar` configuration metadata; no `spring.webmvc.*` properties exist. `spring.mvc.throw-exception-if-no-handler-found: true` in `application.yml` is unchanged and still takes effect. (An earlier spike draft assumed a `spring.webmvc.*` rename — that was wrong; only the *packages* moved.) |
| `spring.test.mockmvc.print` | still bound under `spring.test.*` — value `NONE` retained to avoid an SSE response-header race in tests |
| `spring.jackson.deserialization.fail-on-null-for-primitives` | **`false` set deliberately in `application.yml`** — restores the Jackson-2 default for the Spring-managed `ObjectMapper` (Boot 4 flips the default to `true`). Covers real HTTP deserialization paths; direct `new ObjectMapper()` unit tests rely on the DTO-boundary coercion in §6.4 instead. |
| auto-config excludes in `application.yml` | new FQCNs applied: `org.springframework.boot.jdbc.autoconfigure.*`, `org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration`, `org.springframework.boot.data.jpa.autoconfigure.DataJpaRepositoriesAutoConfiguration`, `org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration` |
| `spring.datasource.generate-unique-name` | → `spring.datasource.unique-name` (test yml) |
| `spring.flyway.enabled` (test yml) | → `spring.flyway.core.enabled` |

## 5. Servlet/security/session behavior mapping

- Servlet: Tomcat 10.1→11 = Jakarta Servlet 6.1; `HttpServletRequest`/`OncePerRequestFilter`/multipart unchanged for our usage.
- Security 6→7: same lambda `SecurityFilterChain` model; resource-server `jwt()` DSL preserved; `tokenType`/`roles` claim shapes unchanged (app-level contract, covered by auth tests).
- Session: `SessionCreationPolicy.STATELESS` unchanged.
- Flyway: same `flyway_schema_history`; **no migration file was added, edited, or reordered in this phase** (schema-unchanged claim is diff-verifiable).

## 6. Applied delta (what the migration actually required)

Measured by clean compile + `mvn verify`, not assumed:

1. **Starters**: `spring-boot-starter-aop` removed in Boot 4 → replaced by
   `spring-boot-starter-aspectj`. `spring-boot-starter-flyway` added (Flyway was
   previously pulled transitively; Boot 4 no longer does).
   `spring-boot-starter-oauth2-resource-server` still exists in 4.1.1.
2. **Jackson 3 API** (`tools.jackson`):
   - `ObjectNode.propertyNames()` returns `Collection<String>` (was
     `Iterator<String>`) — three production sites migrated
     (`AnnouncementWriteDtos`, `NotificationWriteDtos`).
   - Jackson parse/serialize exceptions are unchecked
     `tools.jackson.core.JacksonException` — unreachable `catch (IOException)`
     sites migrated in `AssistantKnowledgeAuthorityGateway`, `DeepSeekClient`,
     `RagAssistantGateway`, `SupabaseKnowledgeAuthorityService`,
     `SupabaseKnowledgeSyncService`. Java HTTP `IOException`/`InterruptedException`
     catches kept where the I/O (not Jackson) throws them.
   - Test API: `JsonNode.fieldNames()` → iterate `propertyNames()`;
     `JsonNode.findValuesAsText()` → `findValuesAsString()`.
3. **Boot 4 SPI/config**:
   - `RuntimeSecretEnvironmentPostProcessor` implements the new
     `org.springframework.boot.EnvironmentPostProcessor` and registers via
     `META-INF/spring/org.springframework.boot.EnvironmentPostProcessor.imports`
     (Boot 4 still reads the deprecated `...env.EnvironmentPostProcessor` key;
     verified in bytecode — the new key is canonical).
   - Auto-configure exclusion FQCNs and `spring.webmvc.*` prefix applied per §4.
4. **DTO boundary hardening** (`ThesisAssistantDtos.ChatResponse`): remote JSON
   may omit `replayed`; Jackson 3 fails null→primitive-boolean. Compat coercion
   `null→false` at the DTO boundary only — global
   `fail-on-null-for-primitives` deliberately NOT weakened because unit tests
   construct `new ObjectMapper()` directly.
5. **SSE decode** (`RagAssistantGateway.decode()`): malformed terminal frames
   now catch `JacksonException` and map to the `RAG_SERVICE_UNAVAILABLE` domain
   error instead of leaking `UnexpectedEndOfInputException`.
6. **Hibernate SPI**: `PreserveQuotedIdentifierNamingStrategy` extends
   `PhysicalNamingStrategySnakeCaseImpl` (the current SPI, unchanged by the
   upgrade) — quoted identifiers stay verbatim, unquoted keep snake_case. No
   migration needed; earlier notes naming a deprecated delegate were wrong.
7. **Test-autoconfigure deps**: `spring-boot-webmvc-test` added (test scope) —
   required by the new `org.springframework.boot.webmvc.test.autoconfigure`
   package used across ~80 test files. `flyway-database-postgresql` added
   (Flyway 12 splits db support out of core).

## 7. H2 2.4.240 regression finding (test-scope)

Full-suite run on managed H2 2.4.240: ~50 `CHECK_CONSTRAINT_INVALID` errors on
`assistant.*` tables inserting valid values (`'vi'`, `'en'`, `'COMPLETED'`).

Isolated root cause: **multi-session schema-cache bug in H2 2.4.240** — with
`DB_CLOSE_DELAY=-1`, a table created on connection A rejects inserts on
connection B through the CHECK constraint (`org.h2.constraint.ConstraintCheck`
evaluates against a stale expression context). Reproduced standalone: raw JDBC
single-connection passes; create-on-conn-A + insert-on-conn-B fails on 2.4.240,
passes on 2.3.232. Spring's DataSource path uses distinct connections for
migration vs. test transactions, which is why only the app-context run tripped it.

Decision: **pin `com.h2database:h2` to 2.3.232, test scope only** (Flyway itself
warns 2.4.240 is "newer than verified"). Production Postgres unaffected. Revisit
the pin when H2 ships the fix upstream; do not silently accept a newer H2.

## 8. Oracle result and residual risk

- `mvn -q -f java-services/pom.xml verify` on the upgraded tree:
  **Tests run: 1420, Failures: 0, Errors: 0, Skipped: 1 — BUILD SUCCESS**
  (Boot 4.1.1 / Security 7.1.1 / Jackson 3.1.5 / H2 2.3.232 test pin).
- `platform` gate (`artifacts/verification/platform/report.json`):
  `java-verify` PASS (1420/0/0/1), `contract-snapshot` PASS
  (`*ContractTest` + `KnowledgeSnapshotParityTest`), `platform-image` PASS
  (new digest recorded; pre-upgrade image preserved as
  `student-management-ute-restful-api:pre-p02-boot35`), `platform-stack` PASS
  (startup 25.4s; liveness 200; protected `/api/v1/thesis/topics` and
  `/api/v1/notifications` → 401 unauthenticated), `postgres-lock-order` PASS
  (**50 executed, 0 failures/errors/skipped** across the env-gated
  auth/credential/session lock-order, council/enrollment race, notification
  concurrency, RLS, and turn-ledger `*PostgresIT` classes on disposable
  Postgres 15 — including the rig-pinned `CredentialSessionLockOrder` class on
  port 5452).
- `postgres-content-audit` (non-required): **FAIL recorded — 38 tests, 2
  failures** in `StudentPolicyCorrectionMigrationPostgresIT`
  (`localV95...`/`v96Preserves...`). Both are stale content assertions vs. the
  current migration head: `doesNotContain("vắng quá 80%")` cannot hold after
  V96 added the corrective narrative that quotes the phrase
  ("không phải vắng quá 80%"), and the exact-match published-projection count
  is off by one row at head V13x (test authored when head was V96–V98). SQL
  migrations are Boot-agnostic — pre-existing drift, not a runtime regression;
  carried to the defect ledger as LATER work for the owning domain phase.
- Residual warnings (non-blocking, recorded honestly): deprecated
  `org.springframework.boot.autoconfigure.condition.ConditionalOn*` imports at
  ~16 main-src sites, deprecated `EnvironmentPostProcessor` compat context in
  Boot's own loader, six varargs warnings in
  `StudentPolicyCorrectionMigrationPostgresIT`.
- **Open condition — 512MB headroom NOT met**: the disposable-stack probe
  measured the API container at **1.034 GiB RSS** (`stack.json`,
  `fits512Mb: false`; startup 25.4s, fail-closed probes passed). Per the phase
  contract this is the paid-decision-gate input, not a pass; it is carried
  forward as an unresolved sizing decision for the free-tier deployment
  discussion (P13+), not deleted or waived.
- NOT proven by this phase: live Postgres/Supabase integration behavior, remote
  provider calls, device builds, production deployment. The `platform` gate
  covers disposable-stack boot + env-gated `*PostgresIT` only.

## 9. Rollback

- Image: the pre-upgrade `student-management-ute-restful-api:e2e-local` digest
  is preserved under `student-management-ute-restful-api:pre-p02-boot35` before
  each `platform-image` gate run (`image.json` records both ids).
- Source: revert the P02 change range (poms, `META-INF`, `tools.jackson`
  renames, config edits) — the renames do not compile under 3.5.16.
- Schema: untouched — no migration-file edits; `git diff` on `db/migration*`
  returns empty for this phase.
