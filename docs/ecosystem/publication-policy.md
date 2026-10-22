# Ecosystem publication policy (P06)

Status: **contract v2** — Kongming PASS_WITH_CONDITIONS (1 CRITICAL,
5 HIGH, 13 MEDIUM) resolved inline below; each finding is marked where
its repair landed.
Authority: C2 P06 excerpt (`phase-06-hub-news-docs.md`) +
`contracts/ecosystem/domain-contracts.md` §4 (`ANN-T01…X01`). This file
is the single contract for the announcement workflow, public docs
publication record, attachment visibility, and hub/news/docs surfaces.

## 1. Scope and existing-state map

EXISTING (surveyed 2026-10-22, all behaviour confirmed in code):

- `engagement."Announcement"` carries `status VARCHAR(30)` since V64
  (check `{DRAFT,PENDING_REVIEW,APPROVED,SCHEDULED,PUBLISHED,ARCHIVED,REJECTED}`),
  `version` (revision counter, V15), `archivedAt`/`archivedBy` (V15), and
  `publishedBy`. The write path never sets `status`, so every row sits at
  the `PUBLISHED` default and `archivedAt` is the de-facto lifecycle flag.
  All 27 seed/migration INSERT sites set `PUBLISHED` explicitly or rely
  on the default — narrowing the check breaks no existing row.
- `engagement."AnnouncementAudit"` records `action, actorId, actorLabel,
  reason, version, beforeState, afterState` per change; its
  `announcement_audit_action_ck` allows only
  `{CREATED,UPDATED,ARCHIVED,RESTORED}` — V136 must widen it (H2).
- Reads: `/api/v1/announcements/public` (permitAll, exact path) filters
  `status='PUBLISHED' ∧ isGlobal ∧ window ∧ archivedAt IS NULL`. Authed
  feeds (`/my`, `/{id}` via `userWhere`) filter window+archived but not
  `status`. `AnnouncementReadService.get()` bypasses the audience
  predicate for ADMIN/SUPER_ADMIN, `publishedBy`, and owner `lecturerId`.
- `GET /api/v1/announcements` (admin list) is
  `@PreAuthorize("hasAnyRole('ADMIN','SUPER_ADMIN')")` — lecturers have
  **no** read surface for unpublished rows today (KM-C1).
- `ScheduledAnnouncementNotifyJob` and the create-path
  `AnnouncementStudentNotifier` fan out without a `status` predicate
  (`markNotified`, `fanOutToActiveStudents`, `findDueForNotification`,
  `markExpiredAsNotified`) — a DRAFT with past `publishAt` would notify
  (KM-H1).
- `ArticleAttachment` / `ArticleMediaGallery` endpoints filter only
  `isPublic` (attachments) or nothing (galleries, unscoped list dumps a
  bounded page of *all* rows) and never join parent state — draft-parent
  attachments leak to any authenticated caller today (ANN-T05).
- Admin UI `/admin/announcements` renders archive/restore + audit
  history; lecturer dashboard `/dashboard/lecturer/announcements` lists
  via the `/my` audience feed. TinyMCE (`tinymce@8`) backs both
  `admin/editor` and `dashboard/editor` — both stay (C2: keep the two
  editors).
- `PUBLIC_GET_PATHS` in the edge session route can attach shared
  `max-age`/`stale-while-revalidate` — publication routes must never
  enter that whitelist (KM-M10).

## 2. Announcement lifecycle (canonical)

`status` becomes the lifecycle authority; `archivedAt`/`archivedBy`
remain archive metadata written by the ARCHIVED transition. The column
default flips to `'DRAFT'` **and** the INSERT sets `status='DRAFT'`
explicitly (KM-M4 — never rely on the default silently). Every
transition handler takes the announcement row `FOR UPDATE` (same
convention as the existing mutation path) and re-checks state inside the
lock — this is a contract requirement, not an implementation nicety
(KM-M3): it is what makes "version cannot move between submit and
approve" true without an `expectedVersion` parameter. The `update`
write also carries `status='DRAFT'` in its atomic predicate.

| Transition | Endpoint | Actor rule | Effect |
| --- | --- | --- | --- |
| `DRAFT → IN_REVIEW` | `POST /{id}/submit` | `sub == authorId` **or** `ADMIN`/`SUPER_ADMIN` (KM-H4 admin adoption — a draft whose author is `legacy-unknown` or disabled is never stranded) | status only |
| `IN_REVIEW → PUBLISHED` | `POST /{id}/approve` | writer set (`LECTURER`/`ADMIN`/`SUPER_ADMIN`) **and** `sub != authorId`; rejects `expiresAt` already past (KM-L9) | `reviewerId`, `reviewedAt`, `publishedRevision = version`; **notification fan-out fires here** (KM-H1) |
| `IN_REVIEW → DRAFT` | `POST /{id}/return` | writer set, reason required | `reviewerId`, `reviewedAt`, `reviewNote` |
| `* → ARCHIVED` | `POST /{id}/archive`, `DELETE /{id}` | writer set; lecturers own-only (existing `requireAnnouncementOwner`) | `archivedAt`, `archivedBy` |
| `ARCHIVED → DRAFT` | `POST /{id}/restore` | writer set; lecturers own-only (KM-M9) | clears `archivedAt`/`archivedBy`; `status=DRAFT` |

Two **extension rulings** beyond the C2 matrix (recorded in the ledger
and as matrix rows in `domain-contracts.md` — KM-M1):

- `* → ARCHIVED` (not only `PUBLISHED → ARCHIVED`): draft and in-review
  posts need the same audited kill path the API/UI already has; ANN-T04's
  invariant (published content never silently disappears) is preserved.
- `ARCHIVED → DRAFT`: `archivedAt` restore already exists; returning to
  DRAFT is *stricter* than the old restore-to-live and preserves the
  independent-review invariant — an archived post can never become
  PUBLISHED without a fresh submit + reviewer ≠ author.

Actor mapping (KM-M2, accepted): the contract's `STAFF:content` maps to
the writer set `LECTURER ∪ ADMIN ∪ SUPER_ADMIN` — a LECTURER may approve
an ADMIN-authored post. `TRUONG_KHOA`/`TRUONG_BO_MON` stay outside the
writer/reviewer set (dean accounts participate through `LECTURER`).

Forbidden writes (enforced):

- Author may not approve own work → `409 REVIEWER_EQUALS_AUTHOR`.
- Content mutation only in `status=DRAFT` (`update`, `create` always
  lands DRAFT) → `409 ANNOUNCEMENT_NOT_DRAFT` otherwise; `update` actor
  rule stays writer set with lecturer-own-scope (KM-M13).
- Wrong-state transitions (`submit` on non-DRAFT, `approve`/`return` on
  non-IN_REVIEW) → `409 ANNOUNCEMENT_INVALID_STATE` (KM-M12).
- `PUBLISHED` content is never edited or hard-deleted (ANN-T04);
  `DELETE` stays soft-archive.
- Every transition appends one `AnnouncementAudit` row carrying actor,
  action, and the row's `version` (ANN-X01). New action names:
  `SUBMITTED`, `APPROVED`, `RETURNED` — V136 widens
  `announcement_audit_action_ck` (KM-H2) and the admin history UI labels
  them in both locales (KM-low).
- Author-withdraw (`IN_REVIEW → DRAFT` by author) is intentionally
  absent — only a reviewer return sends a post back (KM-L1, accepted).

New columns (V136): `"authorId"`, `"reviewerId"`, `"reviewedAt"`,
`"reviewNote"`, `"publishedRevision"`. `authorId` backfills from the
earliest `AnnouncementAudit.action='CREATED'` actor, then
`"publishedBy"`, then `'legacy-unknown'`. `status` backfills
`archivedAt IS NOT NULL → 'ARCHIVED'` else `'PUBLISHED'`; the check
narrows to `{DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED}`. Response DTOs and
both repositories' `SELECT_COLUMNS` gain `status`, `authorId`,
`reviewerId`, `reviewedAt` — additive OpenAPI change (KM-M6). The
*public* DTO never exposes `authorId`/`reviewerId` (KM-low).

## 3. Read visibility (announcements) — KM-C1 repair

- Public feed: unchanged (`status='PUBLISHED' ∧ isGlobal ∧ window ∧
  archivedAt IS NULL`). New anonymous detail
  `GET /api/v1/announcements/public/{idOrSlug}` — same safe subset and
  conditions, 404 otherwise.
- Authed feeds (`/my`, `/{id}` via `userWhere`): add
  `"status" = 'PUBLISHED'` — drafts never surface in audience feeds.
- `get()` bypass extension: for `status != 'PUBLISHED'` rows the unscoped
  bypass extends to the whole writer set (`LECTURER`/`ADMIN`/
  `SUPER_ADMIN`) — reviewers and authors can open unpublished posts;
  audience scoping still applies to PUBLISHED reads (KM-C1a).
- `GET /api/v1/announcements` gains `LECTURER`; lecturer results are
  scoped to `"authorId" = :sub OR "status" = 'IN_REVIEW'` (own posts +
  the review queue). `ADMIN`/`SUPER_ADMIN` keep the unscoped list
  (KM-C1b). This scoped list is also the lecturer's authored-drafts
  surface (KM-C1c — no separate `/mine` route; the dashboard UI calls
  the list with `status` filters).
- `status` query parameter maps to the lifecycle column:
  `DRAFT|IN_REVIEW|PUBLISHED|ARCHIVED` equality, `ALL` no filter,
  legacy `ACTIVE` = `status <> 'ARCHIVED'` (§7). Unknown values stay
  `400` (the `STATUSES` whitelist extends — KM-M5).
- Notify trigger moves from `create` to the `approve` transition
  (afterCommit pattern unchanged) and `status='PUBLISHED'` is added to
  `markNotified`, `fanOutToActiveStudents`, `findDueForNotification`,
  and `markExpiredAsNotified` (KM-H1). Gate case: DRAFT create sends
  zero notifications; an expired-then-fixed-then-approved draft still
  notifies.

## 4. Attachment & media visibility (`ANN-T05`)

`ArticleAttachment` and `ArticleMediaGallery` reads join parent
`engagement."Announcement"` and apply caller-visible conditions —
aligned to the extended `/{id}` rule (KM-M7a):

- Parent `status='PUBLISHED'` (in-window, `archivedAt IS NULL`):
  caller must satisfy the parent audience predicate — the same
  `userWhere` conditions as reading the announcement
  (`isGlobal ∨ targetRoles ∨ targetYears ∨ section enrollment ∨
  lecturerId`); ADMIN/SUPER_ADMIN and the author bypass the audience
  part.
- Parent unpublished (`DRAFT`/`IN_REVIEW`/`ARCHIVED`): visible only to
  the writer set — reviewer preview — never to students or anonymous.
- Failed condition or missing parent → 404 indistinguishable from an
  absent row (no existence oracle).
- Applies to every route: `GET /api/v1/article-attachments`,
  `/article-media-galleries`, and the `/v2/` paged variants — including
  the unscoped-list forms (`announcementId` absent), which must apply
  the same parent join, not just `isPublic` (KM-M7b).
- `fileUrl`/`mediaUrl` stay metadata strings; the ecosystem hosts no
  private bytes today — that is a stated assumption contingent on never
  serving blob content (KM-L5).

## 5. Public docs — separate publication record

New tables (V136, schema `engagement`):

- `"PublicDocument"` — `id`, `slug` unique, `status`
  (`{DRAFT,IN_REVIEW,PUBLISHED,ARCHIVED}`), `authorId`,
  `currentRevision` int, `publishedRevision` int null,
  `categoryId → ArticleCategory` SET NULL, `createdAt`, `updatedAt`.
- `"PublicDocumentRevision"` — `(documentId, revision)` PK,
  `state` (`{DRAFT,IN_REVIEW,PUBLISHED,SUPERSEDED}`), `titleVi`,
  `titleEn`, `summaryVi`, `summaryEn`, `bodyVi`, `bodyEn` (sanitized on
  write), `authorId`, `reviewerId`, `reviewedAt`, `reviewNote`,
  `createdAt`.
- `"PublicDocumentAttachment"` — `id`, `documentId` FK CASCADE,
  `fileName`, `fileUrl`, `mimeType` (same check as `ArticleAttachment`),
  `fileSizeBytes`, `checksumSha256`, `isPublic`, `createdAt`.
- `"PublicDocumentTagMap"` — `(documentId, tagId)`.
- `"PublicDocumentAudit"` — same column shape as `AnnouncementAudit`
  but with the workflow action set `{CREATED,REVISED,SUBMITTED,
  APPROVED,RETURNED,ARCHIVED,RESTORED}` on its own check (KM-H2).

**Revision-scoped review model (KM-H3):** the review state lives on the
*head revision*, not the document row. `status` on the document means
"is anything public": `DRAFT`/`IN_REVIEW` = never published, `PUBLISHED`
= `publishedRevision` is live (the head revision may itself be
DRAFT/IN_REVIEW for the next edit cycle — the public copy keeps
serving), `ARCHIVED` = unpublished. Rules:

- `PUT /api/v1/docs/{id}` creates the next head revision
  (`state=DRAFT`, `currentRevision++`) — allowed whenever
  `status != 'ARCHIVED'` (writer set, lecturer-own-scope). A live doc
  gains a new draft head without a public outage.
- `submit` → head revision `DRAFT → IN_REVIEW`; on a never-published doc
  `status` also moves to `IN_REVIEW`.
- `approve` (writer set, `sub != revision.authorId`, reason optional) →
  head revision `IN_REVIEW → PUBLISHED`, prior published revision →
  `SUPERSEDED`, `publishedRevision = currentRevision`, doc
  `status → PUBLISHED`.
- `return` (writer set, reason required) → head revision → `DRAFT`.
- `archive` → doc `status → ARCHIVED` (revisions untouched); `restore` →
  `DRAFT` with `publishedRevision` retained as history — public surface
  stays dead until a new approve (same extension ruling as §2).
- Staff write/read surface: `POST /api/v1/docs` (draft + revision 1),
  `PUT`, `submit|approve|return|archive|restore`, `GET /api/v1/docs`
  (list, lifecycle filter, lecturer scoped own ∨ head-IN_REVIEW),
  `GET /api/v1/docs/{id}` staff detail incl. draft head. No dedicated
  docs-management UI ships this phase — the surface is API + seeded
  demo content (KM-L3, accepted).
- `ArticleTag.usageCount` is not incremented for doc tags (KM-L6,
  accepted — tags remain navigational).

Anonymous read surface (permitAll additions — KM-H5 exact list):
`/api/v1/announcements/public`, `/api/v1/announcements/public/*`,
`/api/v1/public/docs`, `/api/v1/public/docs/*`,
`/api/v1/public/docs/*/revisions/*`,
`/api/v1/public/docs/*/attachments/*`.

- `GET /api/v1/public/docs` — list + `?search=` folded across both
  locales (title/summary/body, `LikePattern` folding) **pinned to the
  `publishedRevision` row** (KM-M8 — a DRAFT head's text never leaks
  into search/snippets); `?category=`, `?tag=`, `?page`/`?limit`.
- `GET /api/v1/public/docs/{slug}` — the `publishedRevision` revision.
- `GET /api/v1/public/docs/{slug}/revisions/{n}` — serves only when
  `status='PUBLISHED' ∧ n <= publishedRevision`; body marks
  `superseded: n < publishedRevision`.
- `GET /api/v1/public/docs/{slug}/attachments/{id}` — DTO when
  `isPublic ∧ doc PUBLISHED`; else 404.
- Unpublished or unknown slug → 404 on every route (no oracle).
- `Cache-Control: no-store` on all public docs/news reads, and neither
  `announcements/public*` nor `public/docs*` may enter the edge
  `PUBLIC_GET_PATHS` cache whitelist — the e2e spec asserts the header
  (KM-M10). Unpublish is effective immediately.

RAG isolation: public docs read only `PublicDocument*`; assistant /
knowledge schemas are never queried — RAG content is not a default
public source. The `content-docs` case seeds a knowledge row and proves
it never appears in doc search (negative).

## 6. Hub + news + docs surfaces (frontend)

- `src/lib/hub-modules.ts` — static registry
  `{key, href, roles[], availability:'available'|'planned'}`. Planned
  entries (events P08, learning P09, admissions P10, library P11,
  careers P12) render disabled with a locale status label — never
  "hoàn chỉnh"; available entries link through. The registry is the
  single place later phases flip `availability` (D3 discovery).
- `src/app/hub/page.tsx` — role-aware card grid via session roles;
  unauthenticated visitors see public entries only; breadcrumb + back
  through `useI18n().href(...)` keeps locale.
- `src/app/news/page.tsx` + `src/app/news/[id]/page.tsx` — anonymous
  feed and detail.
- `src/app/docs/page.tsx` + `src/app/docs/[slug]/page.tsx` — public doc
  list/search/detail incl. revision link display.
- Each page is implemented under the non-locale path plus a one-line
  re-export under `src/app/[locale]/…` (existing convention).
- `src/i18n/messages-content.ts` — `contentEn`/`contentVi` mounted as
  `en.content`/`vi.content` with `Widen<T>` compile-time parity.
- Admin announcements UI gains: status badge, submit button (author or
  admin), approve/return (reviewers, never on own posts), return-reason
  dialog, lifecycle `status` filter. Backend create→DRAFT and this UI
  ship in the same commit range — UI-created content can never strand
  in DRAFT with no publish path (KM-M13). Lecturer dashboard uses the
  scoped list (§3) for own drafts + review queue.

## 7. `status` filter mapping (admin list)

`DRAFT|IN_REVIEW|PUBLISHED|ARCHIVED` → lifecycle equality; `ALL` → no
filter; `ACTIVE` (legacy) → `status <> 'ARCHIVED'` — identical to the
old `archivedAt IS NULL` behaviour for previously-published rows.

## 8. Gate `content` (runner local, `artifacts/verification/content`)

- `content-lifecycle` — `PublicationWorkflowPersistenceTest` (H2):
  create→DRAFT (explicit), submit, self-approve 409
  `REVIEWER_EQUALS_AUTHOR`, approve→PUBLISHED w/ `publishedRevision`,
  return w/ reason, archive + restore→DRAFT, edit-blocked outside DRAFT
  (`ANNOUNCEMENT_NOT_DRAFT`/`ANNOUNCEMENT_INVALID_STATE`), notify-job +
  create-path status gate (draft sends zero; expired-fixed-approved
  still notifies), student feed/status filter, audit rows carry
  actor+version, lecturer scoped list (own ∨ IN_REVIEW).
- `content-docs` — `PublicDocumentPersistenceTest` (H2): doc workflow
  on revision state, edit-while-published keeps serving, permalink
  boundary (`n <= publishedRevision`), VI/EN search pinned to published
  revision, attachment gate, RAG-leak negative, slug 404s.
- `content-e2e` — `frontend/e2e/ecosystem-content.spec.ts` on the HTTPS
  preview stack (portal surface, seeded synthetic content): anonymous
  news read+detail, docs list/search VI/EN + permalink + `Cache-Control`
  assertion, hub entries, malicious rich text renders sanitized, draft
  direct-URL 404.
- Contract bookkeeping: `contracts/ecosystem/openapi.json` is
  regenerated after the API changes (routes land via the live spec);
  `contract-allowlist.json` stays an exceptions file only (KM-M11);
  `domain-contracts.md` §4 gains the two extension-ruling matrix rows.

Recovery: unpublish = audited `→ARCHIVED`; all public reads are
`no-store` so stale content disappears immediately; re-publish of an
archived item requires restore→DRAFT→IN_REVIEW→PUBLISHED (fresh
independent review). Private knowledge history is never mutated.
