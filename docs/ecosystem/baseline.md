# Ecosystem baseline — CampusUTE C2

Ngày ghi: 2026-10-21 · Pha: P01 step 1 · Active plan: `plans/261021-2123-campusute-ecosystem/plan.md`

## 1. Target identity (pinned)

| Mục | Giá trị |
| --- | --- |
| Source repo | `JasonTM17/Student_Management_UTE` |
| Pinned source SHA | `e08ce79f6f4155cf6482492dcb3c11c6509ce7c6` |
| Branch | `docs/campusute-ecosystem-plan` |
| Selected design | C2 — `USER_SELECTED_AFTER_REJECT_ALL` (không phải Ultra winner; Ultra R1 REJECT_ALL đứng nguyên) |
| Post-R2 plan snapshot | `plans/261021-2123-campusute-ecosystem/reports/review-r2-post-amendment-snapshot.json` digest `19a64993b270be569ed859af98aaffcb8b9b8725338f6ebb9b94f628ab19d4af` |

## 2. Quyết định user U1–U5 (đóng băng)

| ID | Quyết định | Ràng buộc |
| --- | --- | --- |
| U1 | `Demo hoàn chỉnh → pilot sau` | Demo dữ liệu hư cấu đầy đủ; pilot dữ liệu thật là cổng riêng sau demo (P15). |
| U2 | `Làm tất cả luôn á` | Hub, news/docs, events/Đoàn–Hội, LMS, tuyển sinh, thư viện, việc làm, API, mobile đều bắt buộc trong demo; không thay bằng link hệ thống thật. |
| U3 | `Ưu tiên miễn phí; ghi rõ giới hạn và phương án trả phí` | Free-first; giới hạn/quota và phương án trả phí công khai; không hứa zero-cost. |
| U4 | `Có, SSO xuyên hệ sinh thái` | SSO seamless bắt buộc; identity/session transition trước consumer xác thực. |
| U5 | `Cả Android và iOS, chia mốc kiểm chứng riêng` | Hai OS có bằng chứng native riêng (P07 smoke sớm, P13 nghiệm thu riêng). |

## 3. Trạng thái repo tại baseline

- Tracked diff: sạch (`git status --short` chỉ có untracked).
- Untracked giữ nguyên, không đụng: `.agentkit/`, `.agents/`, `.claude/`, `.codex/`, `plans/`.
- `docs/ecosystem/` được tạo bởi pha này; không ghi đè docs hiện hữu.
- Toolchain quan sát: Node v24.12.0 (≥22.13 bắt buộc bởi runner), npm 11.6.2, Java 26.0.1, Maven 3.9.12, Docker 29.9.1.
- CI hiện hữu (`.github/workflows/ci.yml`) dùng Node 20 — P01 step 3 đổi mobile job sang ≥22.13 theo baseline Expo SDK57.

## 4. Ownership map

Controller giữ ledger `plans/261021-2123-campusute-ecosystem/reports/execution-ledger.md`; mỗi pha ghi snapshot evidence repo-relative dưới `artifacts/verification/<gate>/`.

| Pha | Phạm vi | Review bắt buộc |
| --- | --- | --- |
| P01 | Baseline, fixture hư cấu, verify runner, gate `baseline` | tester + security dữ liệu fixture |
| P02 | Nâng Java/Spring còn hỗ trợ, giữ public nghiệp vụ, gate `platform` | Kongming architecture + tester độc lập |
| P03 | Contracts/quyền/design token/observability, gate `contracts`; owner CI `contract-drift` (R2-1) | Kongming + tester contract |
| P04 | Authorization server + một session authority, gate `identity`; bound R2-5 | Kongming frozen architecture + Wukong auth/replay + independent security |
| P05 | Browser BFF, host isolation, SSO xuyên miền, gate `bff`; owner CI `host-registry` + `static-policy` (R2-1); bound R2-5 | security + Wukong sibling-host + tester độc lập |
| P06 | Hub/news/docs, gate `content` | tester + security publication boundary |
| P07 | Mobile nền + học vụ hiện hữu, gate `mobile-core` | tester mobile + security storage |
| P08 | Events/Đoàn–Hội, gate `events` | tester + Wukong last-seat |
| P09 | LMS + roster học vụ, gate `learning` | Kongming authority boundary + tester/security file |
| P10 | Tuyển sinh mô phỏng, gate `admissions` | tester + security applicant isolation |
| P11 | Thư viện, gate `library` | Wukong double-issue + tester độc lập |
| P12 | Việc làm, gate `careers` | tester + security organization scope |
| P13 | Native mọi miền + cổng thiết bị hai OS, gate `devices` | tester native độc lập + security links/session |
| P14 | Nghiệm thu demo + vận hành/phục hồi, gate `demo`; bound R2-4 | Kongming exact snapshot + Wukong release claim + tester độc lập |
| P15 | Cổng pilot (tài liệu/preflight), gate `pilot-preflight`; bound R2-4 | legal owner + security + Kongming |

R2-N = amendment số N trong `execution-contract.md` §Sửa đổi R2.

## 5. Contract-to-phase map

| Contract | Nội dung | Pha own |
| --- | --- | --- |
| D0 | An toàn dữ liệu — chỉ fixture hư cấu (DB, file, email, log) | P01, P14 |
| D1 | Định danh — SSO portal↔LMS↔tuyển sinh, system browser mobile, không cookie refresh miền cha | P04, P05, P13 |
| D2 | Học vụ hiện hữu — đăng ký/lịch/điểm/khóa luận/trợ lý/thông báo giữ invariant | P02, P07, P14 |
| D3 | Hub/tin/tài liệu — soạn→duyệt→công bố→tìm/đọc VI/EN | P06 |
| D4 | Sự kiện — công bố→đăng ký→roster→xác nhận thủ công→lịch sử | P08 |
| D5 | LMS — roster enrollment→tài liệu→bài tập→nộp→phản hồi | P09 |
| D6 | Tuyển sinh — applicant cấp sẵn→nháp→nộp→trả sửa→nộp lại→quyết định mô phỏng | P10 |
| D7 | Thư viện — danh mục/bản sao→yêu cầu mượn→xuất→trả→khả dụng | P11 |
| D8 | Việc làm — recruiter cấp sẵn→kiểm duyệt→ứng tuyển→cập nhật trạng thái | P12 |
| D9 | Mobile/API — thao tác native hữu ích mọi miền, API ổn định, hai OS kiểm chứng riêng | P03, P07, P13 |
| D10 | Vận hành — quota/cold start, backup/restore, rollback, cảnh báo free | P03, P14 |

Cross-cutting bound amendments: R2-4 (post-restore stale-credential oracle) → P14 `demo`, P15 `pilot-preflight`; R2-5 (bump revision mọi revocation) → P04 `identity`, P05 `browser-sso`; R2-1 (CI-gate ownership) → P03/P05, tái kiểm tại P14 `demo`.

## 6. Inventory EXISTING vs PROPOSED

EXISTING = đã xác minh tồn tại trong repo tại baseline. PROPOSED = chưa tồn tại, được tạo bởi pha ghi bên cạnh; không inventory nào gọi proposed thành existing.

| Pha | EXISTING (đã verify) | PROPOSED (sẽ tạo) |
| --- | --- | --- |
| P01 | `README.md`, `mobile/package.json`, `.github/workflows/ci.yml`, `scripts/run-course-e2e.mjs` | `docs/ecosystem/baseline.md`, `docs/ecosystem/demo-data-policy.md`, `scripts/verify-ecosystem.mjs`, `scripts/ecosystem-fixture.mjs`, `docs/ecosystem/verification.md` |
| P02 | `java-services/pom.xml`, `java-services/restful-api/pom.xml`, `java-services/restful-api/Dockerfile`, `java-services/restful-api/src/main/java/io/campuscore/restfulapi/security/SecurityConfig.java`; test auth/academic/thesis hiện hữu giữ nguyên | `docs/ecosystem/runtime-compatibility.md` |
| P03 | `frontend/src/types/api.ts`, `frontend/src/lib/api.ts`, `mobile/src/api/client.ts`, `frontend/src/i18n/messages.ts`, `mobile/src/design/tokens.ts` | `contracts/ecosystem/openapi.json`, `contracts/ecosystem/domain-contracts.md`, `contracts/ecosystem/tokens.json`, `scripts/generate-api-contract.mjs`, `frontend/src/types/generated-api.ts`, `mobile/src/api/generated-api.ts`, `docs/ecosystem/observability.md` |
| P04 | `auth/service/AuthLoginService.java`, `auth/web/SessionCookieService.java`, `security/CsrfCookieFilter.java` (dưới `java-services/restful-api/src/main/java/io/campuscore/restfulapi/`) | package `identity/`, `docs/ecosystem/identity-contract.md`, `EcosystemIdentityContractTest.java`, `UnifiedSessionRevocationPostgresIT.java`; migration mới chỉ cấp version lúc implement |
| P05 | `frontend/src/middleware.ts`, `frontend/next.config.mjs`, `frontend/src/app/api/v1/[...path]/route.ts`, `frontend/src/context/AuthContext.tsx` | `frontend/src/lib/surfaces.ts`, `frontend/src/app/session/[...path]/route.ts`, package `identity/bff/`, `frontend/e2e/ecosystem-sso.spec.ts`, `docs/ecosystem/host-policy.md` |
| P06 | package `engagement/` (Java), `frontend/src/i18n/messages.ts` | `frontend/src/app/hub/page.tsx`, `frontend/src/app/news/page.tsx`, `frontend/src/app/docs/page.tsx`, `frontend/e2e/ecosystem-content.spec.ts`, `docs/ecosystem/publication-policy.md` |
| P07 | `mobile/app.json`, `mobile/index.ts`, `mobile/src/api/client.ts`, `mobile/src/navigation/MobileNavigator.tsx`, `mobile/src/screens/student/StudentScreens.tsx`, `mobile/src/screens/thesis/ThesisScreens.tsx` | `mobile/src/auth/session-store.ts`, `mobile/src/auth/oidc-session.ts`, `mobile/src/app/`, `mobile/tests/session-storage.test.mjs`, `mobile/eas.json`, `docs/ecosystem/mobile-matrix.md` |
| P08 | conduct controller chỉ đọc [S§4/Appendix A] | package `events/` (Java), `frontend/src/app/events/`, `mobile/src/screens/events/`, `frontend/e2e/ecosystem-events.spec.ts`, `EventCapacityPostgresIT.java` |
| P09 | — (không EXISTING khai báo) | package `learning/` (Java), `frontend/src/app/learn/`, `mobile/src/screens/learning/`, `frontend/e2e/ecosystem-learning.spec.ts`, `LearningAuthorityPostgresIT.java` |
| P10 | — (không EXISTING khai báo) | package `admissions/` (Java), `frontend/src/app/apply/`, `mobile/src/screens/admissions/`, `frontend/e2e/ecosystem-admissions.spec.ts`, `AdmissionsStateTest.java` |
| P11 | — (không EXISTING khai báo) | package `library/` (Java), `frontend/src/app/library/`, `mobile/src/screens/library/`, `frontend/e2e/ecosystem-library.spec.ts`, `LibraryInventoryPostgresIT.java` |
| P12 | — (không EXISTING khai báo) | package `careers/` (Java), `frontend/src/app/careers/`, `mobile/src/screens/careers/`, `frontend/e2e/ecosystem-careers.spec.ts`, `CareerOrganizationIsolationTest.java` |
| P13 | `mobile/app.json`, `mobile/README.md`; `eas.json` từ P07 được hoàn thiện | `frontend/public/.well-known/apple-app-site-association`, `frontend/public/.well-known/assetlinks.json`, `mobile/tests/domain-contracts.test.mjs`, `docs/ecosystem/device-runbook.md`, `docs/ecosystem/device-evidence-template.md` |
| P14 | `.github/workflows/ci.yml`, `.github/workflows/publish-ghcr.yml`, `render.yaml`, `ops/backup/backup-postgres.sh`, `ops/backup/restore-postgres.sh`, `ops/backup/verify-backup.sh`, `docs/deployment.md`, `README.md` | `docs/ecosystem/release-runbook.md`, `docs/ecosystem/demo-acceptance.md`, `scripts/probe-ecosystem-hosts.mjs` |
| P15 | — (không EXISTING khai báo) | `docs/ecosystem/pilot-entry-checklist.md`, `docs/ecosystem/data-inventory.md`, `docs/ecosystem/privacy-notice.md`, `docs/ecosystem/rights-request-runbook.md`, `docs/ecosystem/breach-runbook.md`, `docs/ecosystem/vendor-register.md` |

## 7. Ranh giới ghi tại baseline

- Working-tree creation/edit được ủy quyền; commit, push, CI trigger, DNS/provider mutation, mua dịch vụ, store publish, import dữ liệu thật: chưa được ủy quyền.
- Gate thiếu capability (device/signing/DNS/legal/paid) = `BLOCKED_CAPABILITY`; thiếu evidence = `NOT_RUN`; không pass rỗng.
- Pha chỉ bắt đầu khi mọi dependency có exit evidence trong ledger (R2-2); checkbox thoát chỉ check khi gate evidence path đã ghi ledger (R2-3).
