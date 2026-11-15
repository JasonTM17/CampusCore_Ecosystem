# 5 candidate proposals — CampusCore service decomposition
Frozen evidence: /home/ubuntu/evidence-packet.md sha256=54b9922e...

## C0 — incremental-strangler
Title: Strangler-fig extraction, registration first.
Topology: gateway(Nginx/Caddy route /api/v1/registration* → enrollment-service; else → restful-api) + sis-core (existing restful-api) + enrollment-service (new Spring Boot module from academic.* registration code) + bursar-service later.
Steps: P0 extract registration controllers/services/repos into new Maven module + container sharing same Postgres (schema `academic` read, own tables `enrollment.*` for rounds/wishes) — NO, too risky mid-demo; alternative safer: keep code in monolith, run TWO containers of same jar with profile flags (like rag-service precedent!). rag-service already proves profile-split deployment works. So: container `registration-api` = same image profile `registration` exposing only registration endpoints; `bursar-api` = same image profile `billing` exposing payment endpoints; gateway routes. Data stays one DB.
Integration: REST internal, shared DB (schema-per-domain), events later.
Phases: P1 profile-flag restful-api (registration/billing/core) + compose services + gateway; P2 payment domain (invoice/payment tables + endpoints) in billing profile; P3 dedicated registration page FE; P4 optional real repo/module split.
Risks: profile-bleed (endpoints exposed wrongly) — mitigate via SecurityConfig per profile; shared DB coupling.
Effort: ~1.5 sessions.

## C1 — modular-monolith
Title: Maven multi-module + enforced boundaries, deployable split later.
Topology: java-services/ → modules: core-api (everything), registration-api, bursar-api; each own package root, only `common` shared; three compose containers from three thin boot jars.
Steps: P0 create maven modules moving code by package; P1 fix cross-package deps (academic↔people↔identity↔notification heavy entanglement — biggest cost); P2 containers per module; P3 payment domain.
Integration: in-process now, HTTP later; shared DB.
Phases: P0-P3 as above; each phase = module boundary respected + tests green.
Risks: package entanglement makes the split huge (59 services cross-call); high churn breaking demo; long timeline.
Effort: 4-6 sessions.

## C2 — microservices-first
Title: North-star microservices: per-service DB, gateway, events.
Topology: api-gateway + identity-svc + sis-svc + enrollment-svc + bursar-svc + notification-svc + rag-svc (existing) + frontend; Postgres instance per service; Kafka/Redpanda for events.
Steps: P0 gateway + OIDC token relay; P1 extract identity/auth; P2 extract enrollment w/ own DB + Flyway; P3 bursar new; P4 notification outbox; P5 data sync/CDC.
Integration: REST sync + outbox events; saga for enrollment→invoice.
Phases: P0..P5, each with compat layer.
Risks: destroys demo agility; auth/session epoch machinery deeply embedded; RLS contexts; 6+ sessions + real ops burden; overkill for a demo product.
Effort: 8-12 sessions.

## C3 — university-topology
Title: Map onto real university landscape (Banner-style): SIS core + Registrar services.
Topology: `api-gateway` (edge, i18n, rate-limit) + `sis-core` (restful-api minus registration/payment) + `enrollment-service` (registrar domain: rounds, sections, cart, slip, wishlist, credit-limits) + `bursar-service` (tuition assessment, invoices, payments, holds — like real bursar office) + `notification-service` (mail/in-app already modular) + `rag-service` (existing) + `frontend`.
Steps: P1 gateway + service-name compose aliases; P2 bursar-service scaffold (new module + own schema `bursar`: Invoice/InvoiceItem/Payment/TuitionAssessment + seeded fee catalog per khoa) + hold flag read by registration (BLOCK invoice→register like real schools); P3 enrollment-service split via profile-then-module (reuse C0 profile trick, promote to own module when stable); P4 dedicated registration page.
Integration: REST + shared Postgres with schema ownership per service (sis owns academic.*, bursar owns bursar.*); holds/reads via small internal endpoints, not cross-schema writes.
Risks: gateway adds a hop; bursar↔enrollment coupling needs careful contract.
Effort: ~3-4 sessions.

## C4 — minimal-new-services
Title: Keep core, add only what universities actually run separately: bursar + registration facade.
Topology: compose adds `bursar-api` (new small Spring Boot service, own schema `bursar`, Flyway-managed, port 4012) + `enrollment-api` (same restful-api image, profile `enrollment`, port 4013 serving only /api/v1/me/registration* + /api/v1/me/enrollments*) + `edge` nginx gateway on :8080 routing /api/*; restful-api becomes sis-core.
Steps: P0 edge gateway + profile flag for enrollment slice (precedent: rag-service persistence profile); P1 bursar scaffold: StudentAccount, TuitionCharge (per credit × faculty rate, seeded), Invoice(term), Payment(cash/transfer demo), Hold — endpoints me/bursar/*; P2 registration reads hold (sis internal endpoint /internal/holds or bursar public me endpoint); P3 FE: dedicated /vi/dang-ky-hoc-phan page + /vi/hoc-phi page; P4 docs + demo data.
Integration: REST over docker network; single Postgres, schema `bursar` owned by bursar-api; enrollment keeps `academic` schema.
Risks: profile gating must be exhaustive (endpoint allowlist); payment is demo-grade (no real gateway) — frame as cashier/bursar with manual payment + receipt.
Effort: ~2-3 sessions.
