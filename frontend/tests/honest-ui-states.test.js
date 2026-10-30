const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readFromRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// Phase 03 — the certificate surface mints nothing official and invents nobody
// ---------------------------------------------------------------------------

test('certificate preview asserts no authority the backend never granted', () => {
  const source = read('src/app/dashboard/certificates/page.tsx');

  // Fabricated serials, QR, signature claims, signer, verification link, and
  // the 60-day validity claim must all be gone.
  assert.doesNotMatch(source, /XN-ĐHCNKT/);
  assert.doesNotMatch(source, /UTE-CERT-/);
  assert.doesNotMatch(source, /Chữ ký số hợp lệ/);
  assert.doesNotMatch(source, /NGUYỄN VĂN HẢI/);
  assert.doesNotMatch(source, /\/verify\/cert\//);
  assert.doesNotMatch(source, /60 ngày/);
  assert.doesNotMatch(source, /Valid for 60/);
  assert.doesNotMatch(source, /ĐÃ KÝ ĐIỆN TỬ/);
  assert.doesNotMatch(source, /XÁC THỰC ĐIỆN TỬ/);
  assert.doesNotMatch(source, /Simulated SVG QR/);
  assert.doesNotMatch(source, /certNumber/);
  assert.doesNotMatch(source, /verificationUrl/);

  // The page is explicitly labelled as a preview where a reader cannot miss it.
  assert.match(source, /certCopy\.previewBanner/);
  assert.match(source, /certCopy\.previewBannerNote/);
  // And it truthfully says where a real certificate comes from.
  assert.match(source, /certCopy\.issuedByValue/);
});

test('certificate preview never substitutes another student for missing fields', () => {
  const source = read('src/app/dashboard/certificates/page.tsx');

  // The seeded other-student identity fallbacks are gone.
  assert.doesNotMatch(source, /24110054/);
  assert.doesNotMatch(source, /NGUYỄN VĂN A/);
  assert.doesNotMatch(source, /15\/08\/2004/);
  assert.doesNotMatch(source, /'Nam'/);
  assert.doesNotMatch(source, /'Nữ'/);

  // Missing session fields render an em-dash (or nothing), never a guess.
  // The public MSSV comes from the conduct summary's studentCode — the auth
  // session's studentId is the internal profile id, not the printed MSSV.
  assert.match(source, /studentCode \|\| null/);
  assert.match(source, /studentName \|\| missing/);
  assert.match(source, /user\?\.dateOfBirth \? formatDate\(user\.dateOfBirth\) : missing/);
  assert.match(source, /genderValue \|\| missing/);
  assert.match(source, /cohort \|\| missing/);
  assert.match(source, /departmentName \|\| missing/);

  // No unconditional academic-standing claim: the session supplies no
  // enrollment or discipline field, so the draft asserts nothing.
  assert.doesNotMatch(source, /Còn đang theo học/);
  assert.doesNotMatch(source, /không bị kỷ luật/);
  assert.doesNotMatch(source, /Tình trạng học tập/);
});

test('certificate labels live in the shared dictionary for both locales', () => {
  const source = read('src/i18n/messages.ts');

  // The certificates section exists in the en and the vi block (each carries
  // its own translated copy).
  assert.match(source, /serviceBadge: 'Self-service draft • Not an issued document'/);
  assert.match(source, /serviceBadge: 'Bản thảo tự phục vụ • Chưa phải văn bản được cấp'/);
  assert.match(source, /genderMale: 'Male'/);
  assert.match(source, /genderMale: 'Nam'/);
  assert.match(source, /missingValue: '—'/);

  // The page itself no longer hardcodes certificate labels inline.
  const page = read('src/app/dashboard/certificates/page.tsx');
  assert.doesNotMatch(page, /Họ và tên sinh viên: /);
  assert.doesNotMatch(page, /Mã số sinh viên \(MSSV\): /);
  assert.doesNotMatch(page, /Giới tính: /);
  assert.doesNotMatch(page, /Nơi nhận:/);
});

// ---------------------------------------------------------------------------
// Phase 03 / STUD-P1-4 — the conduct record modal invents nothing
// ---------------------------------------------------------------------------

test('conduct activity record uses only real fields and claims no issuance', () => {
  const source = read('src/app/dashboard/conduct/page.tsx');

  assert.doesNotMatch(source, /24110054/);
  assert.doesNotMatch(source, /24110CLA/);
  assert.doesNotMatch(source, /UTE-CERT-/);
  assert.doesNotMatch(source, /'88\.3'/);
  assert.doesNotMatch(source, /certValid/);
  assert.doesNotMatch(source, /digitallyVerified/);
  assert.doesNotMatch(source, /ĐÃ XÁC THỰC ĐIỆN TỬ/);

  // Real fields only, guarded em-dash otherwise.
  assert.match(source, /displayLabel\(summary\?\.studentCode\)/);
  // Explicitly labelled as a preview record.
  assert.match(source, /copy\.previewTitle/);
  assert.match(source, /copy\.previewNote/);
});

// ---------------------------------------------------------------------------
// Phase 04 / STUD-P1-7 — announcements never invent official notices
// ---------------------------------------------------------------------------

test('announcements page renders no fabricated notices on error or empty feed', () => {
  const source = read('src/app/dashboard/announcements/page.tsx');

  assert.doesNotMatch(source, /FALLBACK_OFFICIAL_NOTICES/);
  assert.doesNotMatch(source, /notice-official-/);

  // The catch surfaces the real failure; the shared ErrorState retries it.
  assert.match(source, /setError\(copy\.loadFailed\)/);
  assert.match(source, /setItems\(\[\]\)/);
  assert.match(source, /<ErrorState/);
  assert.match(source, /onRetry=\{\(\) => void fetchFeed\(\)\}/);
  // The shared EmptyState covers the empty feed.
  assert.match(source, /<EmptyState/);
});

// ---------------------------------------------------------------------------
// Phase 04 / STUD-P1-5 + STUD-P2-7 — conduct UI binds to reported state only
// ---------------------------------------------------------------------------

test('conduct badges and claims follow the status and score the API returned', () => {
  const source = read('src/app/dashboard/conduct/page.tsx');

  // Status helper: only an APPROVED row earns the approved label.
  assert.match(source, /normalized === 'APPROVED'/);
  assert.match(source, /statusView\(activeSemesterScore\?\.status\)/);
  assert.match(source, /statusView\(item\.status\)/);
  // No unconditional "approved" badge renders anywhere.
  assert.doesNotMatch(source, />\{copy\.approvedBadge\}</);
  assert.match(source, /semesterStatus\.approved \? copy\.approvedBadge/);

  // Unknown or blank classifications never read as a passing rank.
  assert.match(source, /copy\.notClassified/);
  assert.doesNotMatch(source, /return fallback \|\| copy\.good/);
  // No default-to-TOT badge class.
  assert.doesNotMatch(source, /getRankBadgeClass\(activeSemesterScore\?\.classification \|\| 'TOT'\)/);

  // Scholarship claim is gated on the real score (>= 70).
  assert.match(source, /cumulativeScore >= 70/);
  assert.match(source, /copy\.scholarshipBelow/);
});

// ---------------------------------------------------------------------------
// Phase 04 / STUD-P2-1 — the conduct page matches the backend role gate
// ---------------------------------------------------------------------------

test('conduct page is student-only so staff see the forbidden screen', () => {
  const source = read('src/app/dashboard/conduct/page.tsx');
  assert.match(source, /useRequireAuth\(\['STUDENT'\]\)/);
  assert.doesNotMatch(source, /useRequireAuth\(\['STUDENT', 'ADMIN', 'SUPER_ADMIN'\]\)/);
});

// ---------------------------------------------------------------------------
// Phase 04 / STUD-P2-3, UX-P1-4, UX-P1-5 — dialogs use the shared modal
// ---------------------------------------------------------------------------

test('shared modal traps focus and closes on Escape', () => {
  const source = read('src/components/ui/modal.tsx');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === 'Escape'/);
  // Tab-cycling focus trap over the dialog contents.
  assert.match(source, /querySelectorAll<HTMLElement>\(/);
  assert.match(source, /event\.shiftKey && \(active === first/);
  // Modal portals to document.body so the backdrop overlays sticky headers and shells without leaks.
  assert.match(source, /createPortal\(/);
  assert.match(source, /document\.body/);
});

test('conduct history rows and record modal are keyboard operable', () => {
  const source = read('src/app/dashboard/conduct/page.tsx');

  // History rows act as buttons: focusable, announced, Enter/Space activatable.
  assert.match(source, /role="button"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /e\.key === 'Enter' \|\| e\.key === ' '/);

  // The record modal uses the shared dialog component.
  assert.match(source, /import \{ Modal \} from '@\/components\/ui\/modal'/);
  assert.match(
    source,
    /selectedActivity && selectedActivityDetails && \(\n\s*<Modal\n\s+isOpen\n\s+onClose=\{\(\) => setSelectedActivity\(null\)\}/,
  );
});

test('forced password rotation gate uses the shared non-dismissible dialog', () => {
  const source = read('src/components/auth/ForcedPasswordRotationGate.tsx');
  assert.match(source, /import \{ Modal \} from '@\/components\/ui\/modal'/);
  assert.match(source, /dismissible=\{false\}/);
  // The old hand-rolled overlay is gone.
  assert.doesNotMatch(source, /fixed inset-0/);
});

// ---------------------------------------------------------------------------
// Phase 04 / STUD-P2-2 — no literal-id demo identity in the production path
// ---------------------------------------------------------------------------

test('conduct controller no longer aliases literal demo ids to a real student', () => {
  const controller = readFromRepo(
    'java-services/restful-api/src/main/java/io/campuscore/restfulapi/academic/web/AcademicConductController.java',
  );
  assert.doesNotMatch(controller, /"student-profile"\.equals/);
  assert.doesNotMatch(controller, /"student-user"\.equals/);
  assert.doesNotMatch(controller, /24110054/);
  assert.doesNotMatch(controller, /Nguyễn Tiến Sơn/);
  assert.doesNotMatch(controller, /BigDecimal\.valueOf\(88\.0\)/);

  // Demo activity fixtures moved into seed data on the normal query path.
  const migration = readFromRepo(
    'java-services/restful-api/src/main/resources/db/migration/V58__seed_conduct_activities_per_student.sql',
  );
  assert.match(migration, /conduct_activity/);
  assert.match(migration, /JOIN academic\.conduct_semester_score/);
});

// ---------------------------------------------------------------------------
// Phase 04 / LEC-P2-3, LEC-P2-4, LEC-P2-6 — lecturer-facing honesty fixes
// ---------------------------------------------------------------------------

test('grade component inputs have distinct screen-reader labels', () => {
  const source = read('src/app/dashboard/lecturer/grades/[id]/page.tsx');
  assert.match(source, /processScoreLabel:/);
  assert.match(source, /finalExamScoreLabel:/);
  assert.match(source, /aria-label=\{copy\.processScoreLabel\(/);
  assert.match(source, /aria-label=\{copy\.finalExamScoreLabel\(/);
  assert.doesNotMatch(source, /finalScoreLabel/);
});

test('thesis council matching no longer falls back to the auth user id', () => {
  const source = read('src/app/dashboard/thesis/page.tsx');
  assert.doesNotMatch(source, /user\?\.lecturerId \|\| user\?\.id/);
  assert.match(source, /const myLecturerId = user\?\.lecturerId \|\| ''/);
  // The missing profile claim is surfaced, not silently swallowed.
  assert.match(source, /messages\.thesis\.councils\.profileClaimMissing/);
});

test('removing a supervised group member asks for confirmation', () => {
  const source = read('src/components/dashboard/thesis/SupervisedGroupMembers.tsx');
  // The gate must exist and use the app-standard confirmation dialog with the
  // destructive variant — never a bare DELETE and never a native confirm().
  assert.match(
    source,
    /await confirm\(\{[\s\S]*?messages\.thesis\.removeMemberConfirm[\s\S]*?variant: 'destructive'/,
  );
  assert.doesNotMatch(source, /window\.confirm/);
});

// ---------------------------------------------------------------------------
// Phase 04 / STUD-P2-6 — the transcript GPA card is labelled cumulative
// ---------------------------------------------------------------------------

test('transcript header and GPA card describe the cumulative figure', () => {
  const source = read('src/app/dashboard/transcript/page.tsx');
  assert.match(source, /Cumulative GPA, all semesters \(4\.0 scale\)/);
  assert.match(source, /GPA hệ 4 tích lũy toàn khóa/);
  // The page description no longer claims a per-semester GPA.
  assert.doesNotMatch(source, /GPA, tín chỉ và kết quả môn học cho \$\{selectedSemesterName\}/);
  assert.doesNotMatch(source, /GPA, credits, and course outcomes for \$\{selectedSemesterName\}/);
});

// ---------------------------------------------------------------------------
// Phase 04 / ADM-P1-4 — failed branding writes are reported, not faked
// ---------------------------------------------------------------------------

test('site appearance PUT fails loudly when persistence fails', () => {
  const store = read('src/lib/site-appearance-store.ts');
  // No swallow-and-succeed: the write either lands or throws.
  assert.doesNotMatch(store, /console\.warn\('Could not persist/);
  assert.match(store, /await fs\.writeFile/);
  // Memory is only updated after a successful write.
  assert.match(store, /await fs\.writeFile[\s\S]*?memory = next/);

  const route = read('src/app/api/site-appearance/route.ts');
  assert.match(route, /status: 500/);
  assert.match(route, /SITE_APPEARANCE_NOT_SAVED/);
});

// ---------------------------------------------------------------------------
// AUD-22 — every data route error surface offers a real retry, and denials
// render a forbidden state instead of a generic error
// ---------------------------------------------------------------------------

test('public news list retries a failed feed through the shared ErrorState', () => {
  const source = read('src/app/news/news-list-client.tsx');
  assert.match(source, /<ErrorState/);
  assert.match(source, /onRetry=\{\(\) => void query\.refetch\(\)\}/);
  // The bare alert paragraph without a retry control is gone.
  assert.doesNotMatch(source, /role="alert"[^>]*>\s*\{copy\.loadError\}/);
});

test('public docs list retries a failed feed through the shared ErrorState', () => {
  const source = read('src/app/docs/page.tsx');
  assert.match(source, /<ErrorState/);
  assert.match(source, /onRetry=\{\(\) => void query\.refetch\(\)\}/);
  assert.doesNotMatch(source, /role="alert"[^>]*>\s*\{copy\.loadError\}/);
});

test('news detail splits a 404 from a retryable failure', () => {
  const source = read('src/app/news/[id]/news-detail-client.tsx');
  assert.match(source, /campusErrorKind\(query\.error\) === 'notFound'/);
  assert.match(source, /<ErrorState/);
  assert.match(source, /onRetry=\{\(\) => void query\.refetch\(\)\}/);
  // A network/server failure no longer masquerades as "story unavailable".
  assert.doesNotMatch(source, /query\.isError \|\| !item/);
});

test('docs detail splits a 404 from a retryable failure', () => {
  const source = read('src/app/docs/[slug]/page.tsx');
  assert.match(source, /campusErrorKind\(query\.error\) === 'notFound'/);
  assert.match(source, /<ErrorState/);
  assert.match(source, /onRetry=\{\(\) => void query\.refetch\(\)\}/);
  assert.doesNotMatch(source, /query\.isError \|\| !doc/);
});

test('home news section retries the feed instead of telling users to refresh', () => {
  const source = read('src/components/home/HomeNewsSection.tsx');
  assert.match(source, /refetch/);
  assert.match(source, /onClick=\{\(\) => void refetch\(\)\}/);
  // The dead-end copy is gone.
  assert.doesNotMatch(source, /refresh the page in a few minutes/);
});

test('news and docs error titles exist in both locales', () => {
  const catalog = read('src/i18n/messages-content.ts');
  assert.match(catalog, /loadErrorTitle: 'News feed unavailable'/);
  assert.match(catalog, /loadErrorTitle: 'Bảng tin chưa khả dụng'/);
  assert.match(catalog, /loadErrorTitle: 'Documents unavailable'/);
  assert.match(catalog, /loadErrorTitle: 'Tài liệu chưa khả dụng'/);
});

test('learning console retries the sections read on failure', () => {
  const source = read('src/components/learning/LearningConsolePage.tsx');
  const matches = source.match(/onRetry=\{\(\) => void loadSections\(\)\}/g) || [];
  // Student and lecturer consoles both retry.
  assert.equal(matches.length, 2);
});

test('thesis workspace error retries by re-running the workspace load', () => {
  const source = read('src/app/dashboard/thesis/page.tsx');
  assert.match(source, /workspaceRetryToken/);
  assert.match(source, /onRetry=\{\(\) => setWorkspaceRetryToken\(\(token\) => token \+ 1\)\}/);
  assert.match(source, /refreshTopics, selectedRoundId, workspaceRetryToken\]/);
});

test('profile two-factor status read is retryable', () => {
  const source = read('src/app/dashboard/profile/page.tsx');
  assert.match(source, /const loadTwoFactorStatus = useCallback/);
  assert.match(source, /onClick=\{\(\) => loadTwoFactorStatus\(\)\}/);
  assert.match(source, /messages\.common\.actions\.retry/);
});

test('admin thesis splits load failures from action errors and retries', () => {
  const source = read('src/app/admin/thesis/page.tsx');
  assert.match(source, /const \[loadError, setLoadError\]/);
  assert.match(source, /const retryLoad = \(\) => \{/);
  assert.match(source, /void loadData\(\)/);
  assert.match(source, /onClick=\{retryLoad\}/);
});

test('admissions apply page distinguishes denials and retries errors', () => {
  const source = read('src/components/admissions/AdmissionsApplyPage.tsx');
  assert.match(source, /campusErrorKind/);
  assert.match(source, /setDenied\(true\)/);
  assert.match(source, /<WorkspaceForbiddenState/);
  assert.match(source, /onRetry=\{\(\) => void load\(\)\}/);
  // The error surface never renders the applications grid alongside.
  assert.match(source, /!isLoading && !error && !denied && \(/);
});

test('admissions review page offers a way back on denial and retries the queue', () => {
  const source = read('src/components/admissions/AdmissionsReviewPage.tsx');
  assert.match(source, /<ForbiddenState/);
  assert.match(source, /<LinkButton href="\/dashboard"/);
  assert.match(source, /messages\.common\.actions\.openDashboard/);
  assert.match(source, /onRetry=\{\(\) => void loadQueue\(\)\}/);
  assert.match(source, /kind === 'forbidden' \|\| kind === 'unauthorized'/);
});

test('careers board distinguishes denials and retries the load', () => {
  const source = read('src/components/careers/CareersBoardPage.tsx');
  assert.match(source, /campusErrorKind/);
  assert.match(source, /setDenied\(true\)/);
  assert.match(source, /<WorkspaceForbiddenState/);
  assert.match(source, /onRetry=\{\(\) => void loadCurrentSelection\(\)\}/);
});

test('careers desk renders staff denial as a forbidden state with an action', () => {
  const source = read('src/components/careers/CareersDeskPage.tsx');
  assert.match(source, /<ForbiddenState/);
  assert.match(source, /<LinkButton href="\/dashboard"/);
  assert.match(source, /onRetry=\{\(\) => void load\(\)\}/);
});

test('library catalogue distinguishes denials and retries the load', () => {
  const source = read('src/components/library/LibraryCataloguePage.tsx');
  assert.match(source, /campusErrorKind/);
  assert.match(source, /setDenied\(true\)/);
  assert.match(source, /<WorkspaceForbiddenState/);
  assert.match(source, /onRetry=\{\(\) => void loadCurrentSelection\(\)\}/);
});

test('library desk separates staff denial from retryable failures', () => {
  const source = read('src/components/library/LibraryDeskPage.tsx');
  assert.match(source, /<ForbiddenState/);
  assert.match(source, /<LinkButton href="\/dashboard"/);
  assert.match(source, /onRetry=\{\(\) => void load\(filter\)\}/);
  assert.match(source, /setDenied\(true\)/);
});
