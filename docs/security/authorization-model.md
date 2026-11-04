# CampusCore authorization model

Authorization combines route access, current account authority, and ownership of
the requested data. A controller annotation alone is not an authorization audit:
class-level annotations, the filter chain, and service/repository scope all matter.

## Executable owners

- [SecurityConfig](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/security/SecurityConfig.java)
  owns the public route and HTTP-method allowlist, authenticated fallback, token
  validation, and role conversion. Use it instead of maintaining a second route
  list here. Accounts are office-issued; there is no public self-registration.
- [AccountStateFilter](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/security/AccountStateFilter.java)
  and [AuthUserRepository.findAccountAuthorization](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/auth/repository/AuthUserRepository.java)
  own the current-account gate. A valid signature proves who issued a token; it
  does not make an earlier role or academic profile authoritative forever.
- [AuthLoginService](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/auth/service/AuthLoginService.java)
  owns refresh-session validation and reissuance. Refresh and logout have their
  own session rules rather than inheriting business-route authority.

## Current authority and re-authentication

Business access depends on an existing active account and a token matching its
current roles, permissions, student/lecturer identity, and student year. A stale
snapshot requires re-authentication; the request must not silently acquire newer
privileges. Database unavailability fails closed because authority cannot be
established. This applies to authenticated AI routes too: provider fallback is
not permission to bypass account verification.

Office-issued temporary passwords must be rotated before business use. The
rotation exception exists only to let the user inspect the account and change
the password; it does not exempt those requests from current-account checks.
The exact exceptions and error contract belong to `AccountStateFilter`.

Role/profile snapshot equality is a current-state policy, not a permanent
revocation history. Restoring exactly those authorities can make their snapshot
match again. Credential replacement has a separate durable boundary: password
changes must require fresh authentication, even when roles and profiles stay the
same. See the credential revision in `AuthUserRepository`, `AuthTokenService`
and `AccountStateFilter`, and the executable cases in
[AuthLoginPersistenceTest](../../java-services/restful-api/src/test/java/io/campuscore/restfulapi/auth/AuthLoginPersistenceTest.java),
[PasswordResetPersistenceTest](../../java-services/restful-api/src/test/java/io/campuscore/restfulapi/auth/PasswordResetPersistenceTest.java)
and [AdminUserMutationPersistenceTest](../../java-services/restful-api/src/test/java/io/campuscore/restfulapi/auth/AdminUserMutationPersistenceTest.java).

The revision avoids JWT timestamp precision and clock-skew ambiguity; the
[PostgreSQL schedules](../../java-services/restful-api/src/test/java/io/campuscore/restfulapi/auth/AuthCredentialRevocationPostgresIT.java)
own the stale-authentication interleavings. A request already authorized before
replacement commits may finish. This boundary does not promise cancellation of
in-flight work, recovery of past side effects, or access-token blacklisting on
single-session logout.

Enabling or disabling two-factor authentication is the same credential
boundary: confirming either challenge advances the credential revision, so
once the transaction commits every access token issued before the
confirmation stops authorizing business requests, and refresh sessions other
than the caller's are deleted. Two narrow exceptions apply: the signed,
unexpired stale token can still authenticate the session-cleanup endpoints
that deliberately skip revision matching (`/api/v1/auth/logout` and the
login/refresh/recovery endpoints that establish or discard session state),
and a request already authorized before the commit may finish — this
boundary does not cancel in-flight work. The caller's current browser
refresh session is the one explicit session exception — the confirm pins it
to its stable `Session.id` (which survives refresh rotation) *before* taking
the credential lock, so a rotation committed mid-flow still preserves the
same row, kept so the user is not signed out mid-flow, and its next rotation
issues an access token carrying the new revision. When the request's session
can no longer be identified — no cookie, or the row was already rotated away
or revoked — every session is revoked instead. The same pinning applies to
`logout`: the pinned row is deleted under the lock even if its hash rotated,
and an unidentifiable presented session escalates to revoking every session
of the account. A rejected confirmation code does not alter the revision,
the two-factor flag, or any session — the challenge's failed-attempt
bookkeeping (the five-strikes lock) still persists. See `TwoFactorService`
and `TwoFactorLoginPersistenceTest` for the executable cases; the raced
rotation schedules live in `CredentialSessionLockOrderPostgresIT`.

Credential verification and replacement serialize on the account's User row
lock, so login, refresh, reset issuance/redemption, and password writes for the
same account queue rather than interleave. Row-lock contention is per account,
but waiting transactions occupy shared database connections and request
capacity, so sustained contention can also delay other accounts. The
application does not configure a credential-operation `lock_timeout`;
the connection-pool acquisition timeout is a separate limit. A request
carrying a stale credential fails closed even on `permitAll` reads — the
frontend treats that as session death and routes to sign-in rather than
serving anonymous content silently.

Apply the forward
[V121 migration](../../java-services/restful-api/src/main/resources/db/migration/V121__revoke_access_on_credential_rotation.sql)
with enforcing backend code. Do not serve a mixture of enforcing and older
backends while claiming immediate credential revocation. Rolling back the code
can retain the column but reopens the old access window. Revision-zero legacy
compatibility preserves unaffected sessions during rollout; it cannot
retroactively identify password changes made before the revision existed.

## Public, shared, and private data

- **Public content** is an explicit product surface, not any route lacking an
  annotation. Its allowlist belongs to `SecurityConfig`; internal service-token
  routes in that allowlist are not anonymous user features.
- **Shared reference data** supports cross-role navigation, such as course and
  semester lookup. [AcademicReadController](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/academic/web/AcademicReadController.java)
  owns those reads and distinguishes the student's personal curriculum route.
- **Private academic and inbox data** needs subject/profile ownership as well as
  authentication. Start at [AcademicEnrollmentReadController](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/academic/web/AcademicEnrollmentReadController.java),
  [AcademicAttendanceReadService](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/academic/service/AcademicAttendanceReadService.java),
  [ThesisGroupReadController](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/web/ThesisGroupReadController.java),
  and [NotificationReadController](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/notification/web/NotificationReadController.java).
  A supplied record ID is a locator, never proof of access.
- **Announcement audiences** must protect detail access and inbox previews as
  well as feeds; a preview can disclose the same private content as the full row.
  The owners are [AnnouncementReadService](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/engagement/service/AnnouncementReadService.java)
  and [AnnouncementStudentNotifier](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/engagement/service/AnnouncementStudentNotifier.java).
- **Internal AI calls** use a distinct service credential and owner boundary.
  See [ThesisAssistantInternalController](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/assistant/ThesisAssistantInternalController.java)
  and [SupabaseKnowledgeInternalController](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/thesis/assistant/SupabaseKnowledgeInternalController.java).
  `X-Rag-Service-Token` alone never authorizes an owner. The authenticated Java
  API signs `X-Assistant-Owner-Assertion` as a 30-second HS256 JWT with `iss`,
  `sub`, `aud`, `capability`, `iat`, and `exp`; the internal controller verifies
  it and requires `X-Assistant-Owner` to equal the signed subject. Assistant
  calls use the `assistant` capability. Knowledge-authority calls require an
  authenticated `ADMIN` or `SUPER_ADMIN` and the separate `knowledge-admin`
  capability.

## Staff grant visibility and library circulation

- **Staff grant lists are self-views.** `GET /api/v1/careers/staff/grants`,
  `GET /api/v1/events/staff/grants` and `GET /api/v1/library/staff/grants`
  return only the caller's own grant rows. Holding a domain grant never
  enumerates other staff, other organizations or other reviewers, and paged
  totals count only those visible rows. The membership gate is unchanged:
  callers without the domain grant, including `ADMIN`, receive `403`.
  Owners are [CareerService](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/careers/service/CareerService.java),
  [EventService](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/events/service/EventService.java)
  and [LibraryService](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/library/service/LibraryService.java).
- **Active library staff share circulation authority by design.**
  `library."StaffGrant"` has no desk, branch or organization dimension, and
  `Copy` and `LoanRequest` carry no desk owner. Actor fields such as `issuedBy`
  are audit attribution, not desk ownership. Any active `STAFF:library` holder
  may therefore approve, issue, return and manage the shared catalogue and
  request queue. The boundary is the domain grant, not the individual
  librarian.
- **Shared circulation keeps transaction safety.** Approvals and returns keep
  their row locks, optimistic version checks, server-clock reservation expiry,
  audit rows and the one-active-request-per-copy invariant. A librarian acting
  on another librarian's request is still constrained by the same state machine
  and recorded under the acting account.

## Signing configuration

Published development secrets are unsuitable for deployment, and access and
refresh credentials must remain separate token families. The startup policy is
owned by [JwtSecretPolicy](../../java-services/restful-api/src/main/java/io/campuscore/restfulapi/security/JwtSecretPolicy.java)
and `SecurityConfig`; local stack configuration is in
[docker-compose.yml](../../docker-compose.yml). A hosted deployment stack is not
part of this repository (production is deferred). Sidecar mode also requires a
separately generated `ASSISTANT_RAG_OWNER_ASSERTION_SECRET` shared by the API
and sidecar. Keep it independent of `ASSISTANT_RAG_SERVICE_TOKEN`, `JWT_SECRET`,
and `JWT_REFRESH_SECRET`; Compose has no assertion-key default and fails closed
when it is unset. `permitAll` remains on the internal routes because the sidecar
has no caller bearer token; their controllers enforce both the service token
and signed assertion.
