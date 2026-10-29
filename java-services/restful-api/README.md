# CampusCore Java RESTful API

This is the only backend runtime for the course project. It is a Spring Boot
3.5 / Java 21 modular monolith that owns `/api/v1`, persists to one PostgreSQL
database, and publishes its contract through OpenAPI.

## Included modules

- authentication, refresh sessions, logout, profile and password change;
- students, lecturers and administrative user management;
- faculties, departments, semesters, courses, classrooms and sections;
- enrollment, schedules, attendance, grades and transcript reads;
- announcements and notification inbox;
- thesis rounds, topics, groups, members and progress status;
- curated PostgreSQL lexical RAG with citations and explicit degraded states;
- liveness, readiness, `/api/v1/contract` and `/v3/api-docs`.

There is no Node backend, service gateway, event broker, cache server,
realtime server or observability stack in this runtime. Thesis Word/PDF
artifacts use the provider-neutral report storage boundary: local Docker
previews write to the `campuscore_thesis_report_storage` volume; a Supabase
Storage provider is available only when explicitly configured with a server
runtime key.
Finance, analytics, support tickets and advanced thesis council/evaluation
workflows are outside the course scope.

## Run locally

From the repository root:

```powershell
mvn -q -f java-services/pom.xml verify
docker compose up --build postgres restful-api
```

The API listens on `http://localhost:4010` by default. Useful checks:

```powershell
curl.exe http://localhost:4010/api/v1/health/liveness
curl.exe -H "X-Health-Key: local-course-health-key" http://localhost:4010/api/v1/health/readiness
curl.exe http://localhost:4010/v3/api-docs
```

The local seed includes `student@campuscore.edu` with password `password123`
for the reproducible student demo. Configure non-empty values for
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `SPRING_DATASOURCE_PASSWORD` and
`HEALTH_READINESS_KEY`; never commit real secrets.

Flyway is the only schema owner. The `persistence` profile is enabled by the
Compose service and starts from an empty PostgreSQL database with deterministic
course seed data.

## Explicit authorization policy

Every mapped `@RestController` method must have a method/class `@PreAuthorize`,
an explicit filter-permitted path and HTTP verb from
`SecurityConfig.publicEndpointMatchers()`, or `@ServiceEnforced("reason")`
identifying the existing handler/service check. Method annotations override a
class policy. The global authenticated fallback alone does not satisfy the
inventory. `@ServiceEnforced` is documentation only; it grants no access and
must name the enforcing code and caller/audience/ownership rule.

`AuthorizationPolicyInventoryTest` scans compiled controller metadata across
all profiles and conditional lanes without starting Spring or a database. It
counts Java handler methods (aliases count once), prints policy totals, and
fails with the unclassified mappings. The public allow-list is shared with the
filter chain; public news/docs, sign-in/reset/2FA completion, contract, health
and GET site appearance retain their current access. Filter-permitted BFF and
internal RAG routes still enforce their session/shared-secret policies;
readiness still requires its health key. Ownership denials retain their
existing 403 or concealment 404 semantics.

```powershell
$env:JAVA_TOOL_OPTIONS='--enable-native-access=ALL-UNNAMED'
mvn -q -f java-services/restful-api/pom.xml -Dtest=AuthorizationPolicyInventoryTest test
```
