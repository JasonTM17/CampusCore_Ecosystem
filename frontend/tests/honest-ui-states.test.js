const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readFromRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/** Transpile and evaluate a TS/TSX module with the same stub resolver the
 *  route-metadata suite uses. */
function loadTsModule(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

/** Extract one declaration from a page and run it with injected dependencies,
 *  the convention the thesis governance suite established. */
function executeDeclaration(file, name, dependencies) {
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(declaration, `${file} contains ${name}`);
  const text = ts.isVariableDeclaration(declaration)
    ? `const ${declaration.getText(tree)};`
    : declaration.getText(tree).replace(/^export\s+/, '');
  const output = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), 'useCallback', `${output}; return ${name};`)(
    ...Object.values(dependencies), (fn) => fn,
  );
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
  assert.match(source, /conductMessages\.previewTitle/);
  assert.match(source, /conductMessages\.previewNote/);
  const catalog = read('src/i18n/messages-student-pages.ts');
  assert.ok(catalog.includes("previewTitle: 'Activity record — unofficial preview'"), 'the preview title lives in the catalogue');
  assert.ok(catalog.includes('not an issued certificate'), 'the preview note lives in the catalogue');
});

// ---------------------------------------------------------------------------
// Phase 04 / STUD-P1-7 — announcements never invent official notices
// ---------------------------------------------------------------------------

test('announcements page renders no fabricated notices on error or empty feed', () => {
  const source = read('src/app/dashboard/announcements/page.tsx');

  assert.doesNotMatch(source, /FALLBACK_OFFICIAL_NOTICES/);
  assert.doesNotMatch(source, /notice-official-/);

  // The catch surfaces the real failure; the shared ErrorState retries it.
  assert.match(source, /setError\(announcementMessages\.loadFailed\)/);
  assert.match(read('src/i18n/messages-student-pages.ts'), /loadFailed: 'Could not load notices from academic server right now\.'/, 'the failure copy lives in the catalogue');
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
  assert.doesNotMatch(source, />\{conductMessages\.approvedBadge\}</);
  assert.match(source, /semesterStatus\.approved \? conductMessages\.approvedBadge/);

  // Unknown or blank classifications never read as a passing rank.
  assert.match(source, /conductMessages\.notClassified/);
  assert.doesNotMatch(source, /return fallback \|\| conductMessages\.good/);
  // No default-to-TOT badge class.
  assert.doesNotMatch(source, /getRankBadgeClass\(activeSemesterScore\?\.classification \|\| 'TOT'\)/);

  // Scholarship claim is gated on the real score (>= 70).
  assert.match(source, /cumulativeScore >= 70/);
  assert.match(source, /conductMessages\.scholarshipBelow/);
  const catalog = read('src/i18n/messages-student-pages.ts');
  assert.ok(catalog.includes("approvedBadge: 'Approved'"), 'the approved badge lives in the catalogue');
  assert.ok(catalog.includes("notClassified: 'Not yet classified'"), 'the unclassified label lives in the catalogue');
  assert.ok(catalog.includes("scholarshipBelow: 'Below requirement'"), 'the scholarship label lives in the catalogue');
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
  const catalog = read('src/i18n/messages-teaching-pages.ts');
  assert.ok(catalog.includes("processScoreLabel: 'Coursework (50%) for {studentName}'"));
  assert.ok(catalog.includes("finalExamScoreLabel: 'Final exam score (50%) for {studentName}'"));
  assert.match(source, /aria-label=\{gradeEntry\.processScoreLabel\.replace\(/);
  assert.match(source, /aria-label=\{gradeEntry\.finalExamScoreLabel\.replace\(/);
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
  const catalog = read('src/i18n/messages-student-pages.ts');
  assert.ok(catalog.includes("cumulativeGpa: 'Cumulative GPA, all semesters (4.0 scale)'"));
  assert.ok(catalog.includes("cumulativeGpa: 'GPA hệ 4 tích lũy toàn khóa'"));
  assert.match(source, /transcriptMessages\.cumulativeGpa/);
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
  assert.match(source, /onRetry=\{\(\) => void reloadCurrent\(\)\}/);
  assert.match(source, /setDenied\(true\)/);
});

// ---------------------------------------------------------------------------
// W13 audit DATA-01..05 / STATE-01/02/04 — silent data loss and stale loads
// ---------------------------------------------------------------------------

test('a failed curriculum read on the certificate page is surfaced with retry', () => {
  const source = read('src/app/dashboard/certificates/page.tsx');
  assert.match(source, /const \[curriculumError, setCurriculumError\]/);
  assert.match(source, /setCurriculumError\(true\)/);
  assert.match(source, /<ErrorState/);
  assert.match(source, /onRetry=\{\(\) => setCurriculumReloadToken\(\(token\) => token \+ 1\)\}/);
  // The empty catch that rendered em-dashes without a signal is gone.
  assert.doesNotMatch(source, /\} catch \{\s*\/\/ No curriculum data/);
});

test('a failed events roster read surfaces an error with retry', () => {
  const source = read('src/components/events/EventsConsolePage.tsx');
  assert.match(source, /const \[rosterError, setRosterError\] = useState\(false\)/);
  assert.match(source, /setRosterError\(true\)/);
  assert.match(source, /onRetry=\{\(\) => void loadRoster\(/);
  assert.match(source, /title=\{copy\.failed\}/);
  // A roster failure must not default the table to an honest-looking zero.
  assert.doesNotMatch(source, /\} catch \{\s*if \(current\(\)\) setRoster\(\[\]\);/);
});

test('the public news feed pages through every published story', () => {
  const source = read('src/app/news/news-list-client.tsx');
  assert.match(source, /const PAGE_SIZE = 50/);
  assert.match(source, /const \[page, setPage\] = useState\(1\)/);
  assert.match(source, /\['public-news', page\]/, 'the query key carries the active page');
  assert.match(source, /getPublic\(\{ page, limit: PAGE_SIZE \}\)/);
  assert.match(source, /meta\?\.totalPages/);
  assert.match(source, /hasNextPage\(page, totalPages\)/);
  assert.match(source, /messages\.common\.states\.goToPreviousPage/);
  assert.match(source, /messages\.common\.states\.goToNextPage/);
});

test('the public document catalogue pages through every published document', () => {
  const source = read('src/app/docs/page.tsx');
  assert.match(source, /const PAGE_SIZE = 50/);
  assert.match(source, /const \[page, setPage\] = useState\(1\)/);
  assert.match(source, /\['public-docs', search, page\]/, 'the query key carries search and page');
  assert.match(source, /list\(\{ page, limit: PAGE_SIZE, search: search \|\| undefined \}\)/);
  assert.match(source, /meta\?\.totalPages/);
  assert.match(source, /hasNextPage\(page, totalPages\)/);
  assert.match(source, /messages\.common\.states\.goToPreviousPage/);
  assert.match(source, /messages\.common\.states\.goToNextPage/);
});

test('the notification inbox exposes older pages instead of silently capping', () => {
  const source = read('src/components/dashboard/NotificationsCenterPage.tsx');
  assert.match(source, /const \[loadedPages, setLoadedPages\]/);
  assert.match(source, /const \[totalPages, setTotalPages\]/);
  assert.match(source, /loadedPages < totalPages/, 'the control appears only while older pages exist');
  assert.match(source, /const loadOlder = useCallback|async function loadOlder/);
  assert.match(source, /setLoadedPages\(Math\.max\(0, nextPage - \(removalsRef\.current - removalsBefore\)\)\)/);
  // The first paint reads one bounded page plus the server-side unread count.
  assert.match(source, /notificationsApi\.getMy\(\{\s*page: 1,\s*limit: INBOX_PAGE_SIZE/);
  assert.match(source, /notificationsApi\.unreadCount\(\{ force: true \}\)/);
  assert.match(source, /activeFilter === 'unread' \? \{ isRead: false \}/,
    'the unread tab filters on the server');
});

test('learning section loads are epoch-guarded per surface and cancelled at unmount', () => {
  const source = read('src/components/learning/LearningConsolePage.tsx');
  assert.match(source, /import \{ createRequestEpoch \} from '@\/lib\/request-epoch'/);
  assert.equal(
    (source.match(/const sectionEpoch = useRef\(createRequestEpoch\(\)\)\.current;/g) || []).length,
    2,
    'the student and lecturer surfaces each own an epoch',
  );
  assert.ok(
    (source.match(/if \(!sectionEpoch\.isCurrent\(epoch\)\) return;/g) || []).length >= 4,
    'success and failure paths check freshness before setState or toast',
  );
  assert.match(source, /sectionEpoch\.invalidate\(\)/);
});

test('the request epoch accepts only the newest request and retires at unmount', () => {
  const ts = require('typescript');
  const output = ts.transpileModule(read('src/lib/request-epoch.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', output)(moduleRecord, moduleRecord.exports);
  const { createRequestEpoch } = moduleRecord.exports;

  const epoch = createRequestEpoch();
  assert.equal(epoch.isCurrent(0), false, 'nothing is current before a request starts');
  const first = epoch.begin();
  assert.equal(epoch.isCurrent(first), true);
  const second = epoch.begin();
  assert.equal(epoch.isCurrent(first), false, 'a newer section load supersedes the older one');
  assert.equal(epoch.isCurrent(second), true);
  epoch.invalidate();
  assert.equal(epoch.isCurrent(second), false, 'unmount retires the in-flight request');
  assert.equal(epoch.isCurrent(epoch.begin()), true, 'a fresh mount starts a new era');
});

test('learning lifecycle mutations are guarded against double submission', () => {
  const source = read('src/components/learning/LearningConsolePage.tsx');
  assert.match(source, /const pendingActionRef = useRef<string \| null>\(null\)/);
  assert.match(source, /const \[pendingActionId, setPendingActionId\] = useState<string \| null>\(null\)/);
  assert.match(source, /if \(pendingActionRef\.current !== null\) return;/);
  assert.match(source, /disabled=\{pendingActionId === actionKey\}/);
});

test('a failed learning section load clears the previous section rows', () => {
  const source = read('src/components/learning/LearningConsolePage.tsx');
  const clears = source.match(
    /catch \(cause\) \{\s*if \(!sectionEpoch\.isCurrent\(epoch\)\) return;\s*setMaterials\(\[\]\);\s*setAssignments\(\[\]\);/g,
  ) || [];
  assert.equal(clears.length, 2, 'both surfaces clear material and assignment rows on failure');
});

test('the event create dialog names every input for screen readers', () => {
  const source = read('src/components/events/EventsConsolePage.tsx');
  for (const label of [
    'copy.titleField',
    'copy.organizer',
    'copy.where',
    'copy.capacity',
    'copy.descriptionField',
    'copy.cancelReason',
  ]) {
    assert.match(source, new RegExp(`aria-label=\\{${label.replace('.', '\\.')}\\}`), label);
  }
});

test('the lecturer review-queue error offers retry', () => {
  const source = read('src/app/dashboard/lecturer/announcements/page.tsx');
  assert.match(
    source,
    /queueError \? \([\s\S]*?<ErrorState[\s\S]*?onRetry=\{\(\) => void fetchQueue\(\)\}/,
    'the queue error branch retries only the review queue',
  );
});

test('lecturer announcement mutations have keyed pending state and synchronous guards', () => {
  const source = read('src/app/dashboard/lecturer/announcements/page.tsx');
  assert.match(source, /const queueMutationRef = useRef<string \| null>\(null\)/);
  assert.match(source, /const \[queueMutationKey, setQueueMutationKey\] = useState<string \| null>\(null\)/);
  assert.match(source, /if \(queueMutationRef\.current !== null\) return false;/);
  assert.match(source, /if \(!beginQueueMutation\(actionKey\)\) return;/);
  assert.match(source, /const actionKey = `return:\$\{returnTarget\.id\}`;\s*if \(!beginQueueMutation\(actionKey\)\) return;/);
  assert.match(source, /const actionKey = `archive:\$\{announcement\.id\}`;\s*if \(!beginQueueMutation\(actionKey\)\) return;/);
  for (const action of ['submit', 'approve', 'return', 'archive']) {
    assert.ok(
      source.includes(`disabled={queueMutationKey === \`${action}:`),
      `${action} is disabled while its request is pending`,
    );
  }
});

test('a conduct summary failure keeps the certificate preview usable and offers source-only retry', () => {
  const source = read('src/app/dashboard/certificates/page.tsx');
  assert.ok(source.includes('const [conductError, setConductError] = useState(false)'),
    'conduct failures have a retryable degraded state');
  assert.match(source, /const \[conductReloadToken, setConductReloadToken\] = useState\(0\)/);
  assert.match(source, /if \(!cancelled\) setConductError\(true\)/);
  assert.match(source, /conductError \? \([\s\S]*?sectionErrorDescription[\s\S]*?onRetry=\{\(\) => setConductReloadToken/);
  assert.match(source, /\}, \[hasAccess, conductReloadToken\]\);/);
});

test('a conduct summary failure on the certificate page leaves the other sections rendered', () => {
  const source = read('src/app/dashboard/certificates/page.tsx');
  assert.doesNotMatch(source, /if \(conductError\)\s*\{?\s*return/);
  assert.match(source, /conductError \? \(/);
  // The printable preview and the curriculum notice still render independently.
  assert.match(source, /curriculumError \? \(/);
  assert.match(source, /!hasIdentity \? \(/);
  assert.match(source, /certCopy\.previewBanner/);
});

test('the notifications load-older action reads the dedicated fragment key', () => {
  const source = read('src/components/dashboard/NotificationsCenterPage.tsx');
  assert.match(source, /messages\.studentPages\.notifications\.loadMore/);
  assert.doesNotMatch(source, /messages\.assistant\.loadMoreMessages/);
});

test('student learning section-list loads are retired on unmount', () => {
  const source = read('src/components/learning/LearningConsolePage.tsx');
  const loadStart = source.indexOf('const loadSections = useCallback', source.indexOf('export function StudentLearningPage'));
  const loadEnd = source.indexOf('const loadSection = useCallback', loadStart);
  const loadSections = source.slice(loadStart, loadEnd);
  assert.match(loadSections, /const epoch = sectionsListEpoch\.begin\(\)/);
  assert.equal((loadSections.match(/if \(!sectionsListEpoch\.isCurrent\(epoch\)\) return;/g) || []).length, 2);
  assert.match(loadSections, /if \(sectionsListEpoch\.isCurrent\(epoch\)\) setIsLoading\(false\)/);
  assert.match(source, /useEffect\(\(\) => \(\) => \{\s*sectionsListEpoch\.invalidate\(\);\s*\}, \[sectionsListEpoch\]\)/);
});

test('event staff lifecycle mutations use per-action pending state and reject re-entry', () => {
  const source = read('src/components/events/EventsConsolePage.tsx');
  assert.match(source, /const pendingStaffActionRef = useRef<string \| null>\(null\)/);
  assert.match(source, /const \[pendingStaffActionKey, setPendingStaffActionKey\] = useState<string \| null>\(null\)/);
  assert.match(source, /if \(pendingStaffActionRef\.current !== null\) return;/);
  assert.match(source, /runStaffAction\(\s*`publish:\$\{event\.id\}`/);
  assert.match(source, /runStaffAction\(\s*`open:\$\{event\.id\}`/);
  assert.match(source, /runStaffAction\(\s*`close:\$\{event\.id\}`/);
  assert.match(source, /runStaffAction\(\s*`complete:\$\{event\.id\}`/);
  for (const action of ['publish', 'open', 'close', 'complete']) {
    assert.ok(source.includes(`disabled={pendingStaffActionKey === \`${action}:`),
      `${action} is disabled while pending`);
  }
  assert.match(source, /runStaffAction\('create',/);
  assert.match(source, /runStaffAction\(\s*`attendance:/);
  assert.match(source, /runStaffAction\(\s*`cancel:/);
});

// ---------------------------------------------------------------------------
// W14 / F-17 — password recovery answers uniformly, never "no such account"
// ---------------------------------------------------------------------------

test('forgot-password folds every lookup answer into the same confirmation', () => {
  const { campusErrorCode } = loadTsModule('src/lib/campus-error.ts');
  const { AxiosError } = require('axios');
  const outcome = executeDeclaration('app/forgot-password/page.tsx', 'forgotPasswordOutcome', {
    campusErrorCode,
    AxiosError,
  });

  const response = (status, data = {}) =>
    new AxiosError('request failed', AxiosError.ERR_BAD_RESPONSE, undefined, undefined, {
      status,
      statusText: '',
      headers: {},
      config: {},
      data,
    });

  // The audit's premise (400/404 for an unknown mailbox) is what the page must
  // survive: both become the uniform "check your email" banner.
  for (const status of [400, 404, 409, 422]) {
    assert.equal(outcome(response(status)), 'sent', `${status} must not reveal the mailbox state`);
  }

  // Genuine service and gate conditions stay visible: they say nothing about
  // the account, and a fake success would strand someone waiting for a mail
  // that never queued.
  assert.equal(outcome(response(401)), 'failed');
  assert.equal(outcome(response(403)), 'failed');
  assert.equal(outcome(response(429)), 'rate-limited');
  assert.equal(outcome(response(429, { code: 'RATE_LIMIT_EXCEEDED' })), 'rate-limited');
  assert.equal(outcome(response(400, { code: 'RATE_LIMIT_EXCEEDED' })), 'rate-limited');
  assert.equal(outcome(response(500)), 'failed');
  assert.equal(outcome(response(503)), 'failed');
  assert.equal(outcome(new AxiosError('Network Error', AxiosError.ERR_NETWORK)), 'network');
  assert.equal(outcome(new Error('unexpected client error')), 'failed');

  const page = read('src/app/forgot-password/page.tsx');
  // The 'sent' branch renders the shared conditional banner, not a new claim,
  // and the honest branches are the only visible failure copy.
  assert.match(page, /if \(outcome === 'sent'\) \{[\s\S]*?setSent\(true\);/);
  assert.match(page, /setFormError\(copy\.rateLimited\)/);
  assert.match(page, /setFormError\(messages\.common\.campusErrors\.network\)/);
  assert.match(page, /setFormError\(copy\.failedToast\)/);

  // Both dictionaries keep the banner conditional instead of asserting delivery.
  const messages = read('src/i18n/messages.ts');
  assert.match(messages, /sentBanner:\s*\n?\s*'If an account matches \{email\}, a reset link is on the way\.'/);
  assert.match(messages, /sentBanner:\s*\n?\s*'Nếu có tài khoản khớp với \{email\}, một liên kết đặt lại đang được gửi đi\.'/);
});

// ---------------------------------------------------------------------------
// W14 / F-15 — a 403 on sign-in is an infrastructure gate, not an account oracle
// ---------------------------------------------------------------------------

test('sign-in 403 semantics cannot enumerate accounts, so the generic blocked copy stays', () => {
  const service = readFromRepo(
    'java-services/restful-api/src/main/java/io/campuscore/restfulapi/auth/service/AuthLoginService.java',
  );
  const handler = readFromRepo(
    'java-services/restful-api/src/main/java/io/campuscore/restfulapi/exception/GlobalExceptionHandler.java',
  );
  const accountState = readFromRepo(
    'java-services/restful-api/src/main/java/io/campuscore/restfulapi/security/AccountStateFilter.java',
  );
  const login = read('src/app/login/page.tsx');
  const messages = read('src/i18n/messages.ts');

  // Inactive and locked accounts answer exactly like a wrong password, and that
  // gate runs BEFORE the password comparison, so it is not a "correct password
  // revealed the account is disabled" answer either.
  const stateGate = service.indexOf('!"ACTIVE".equals(user.status()) || locked');
  const passwordCheck = service.indexOf('passwordEncoder.matches(password, user.passwordHash())');
  assert.ok(stateGate > 0, 'the account-state gate exists');
  assert.ok(passwordCheck > stateGate, 'the account-state gate runs before the password comparison');
  assert.match(
    service.slice(stateGate, stateGate + 160),
    /throw new BadCredentialsException\("Invalid credentials"\)/,
    'a disabled or locked account answers as invalid credentials, not 403',
  );

  // AuthenticationException is mapped to 401 by the shared handler.
  assert.match(
    handler,
    /@ExceptionHandler\(AuthenticationException\.class\)[\s\S]*?HttpStatus\.UNAUTHORIZED/,
  );

  // The one filter that does answer 403 for account state never sees /auth/login.
  assert.match(accountState, /"\/api\/v1\/auth\/login"\.equals\(uri\)/);

  // So the page keeps its generic "attempt blocked" copy for the residual 403
  // (CSRF, origin, or a proxy in front), and that copy claims nothing about the
  // account: no locked/disabled/exists wording, in either locale.
  assert.match(login, /error\.response\.status === 403\) \{\s*return messages\.login\.errors\.blocked;/);
  const english = /invalidCredentials: 'The email address or password is incorrect\.',\s*blocked: '([^']+)'/.exec(messages);
  const vietnamese = /invalidCredentials: 'Email hoặc mật khẩu không đúng\.',\s*blocked: '([^']+)'/.exec(messages);
  assert.ok(english, 'the English blocked copy exists');
  assert.ok(vietnamese, 'the Vietnamese blocked copy exists');
  for (const copy of [english[1], vietnamese[1]]) {
    assert.match(copy, /blocked|bị chặn/i, 'the copy says the attempt was blocked');
    assert.doesNotMatch(
      copy,
      /\b(account|locked|disabled|exists)\b|wrong password|tài khoản|bị khóa|không tồn tại/i,
      `the copy must not name account state, but reads: ${copy}`,
    );
  }
});
