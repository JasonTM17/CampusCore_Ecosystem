const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

const fragments = [
  ['@/i18n/messages-thesis-workflow', 'src/i18n/messages-thesis-workflow.ts'],
  ['@/i18n/messages-dean-overview', 'src/i18n/messages-dean-overview.ts'],
  ['@/i18n/messages-content', 'src/i18n/messages-content.ts'],
  ['@/i18n/messages-attendance-geofence', 'src/i18n/messages-attendance-geofence.ts'],
  ['@/i18n/messages-teaching-pages', 'src/i18n/messages-teaching-pages.ts'],
  ['@/i18n/messages-admin-pages', 'src/i18n/messages-admin-pages.ts'],
  ['@/i18n/messages-student-pages', 'src/i18n/messages-student-pages.ts'],
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadModule(relativePath, aliases = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadMessages() {
  const aliases = { '@/i18n/config': {} };
  for (const [specifier, relativePath] of fragments) {
    aliases[specifier] = loadModule(relativePath);
  }
  return loadModule('src/i18n/messages.ts', aliases);
}

function keyPaths(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keyPaths(item, `${prefix}[${index}]`)).sort();
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
      .sort();
  }
  return prefix ? [prefix] : [];
}

// ---------------------------------------------------------------------------
// S1 — the inserted Markdown table template must stay 3 columns wide in both
// locales. The old EN branch printed "Giá trị B" and the last row only had two
// cells, so every generated table was malformed.
// ---------------------------------------------------------------------------

function renderTableTemplate() {
  const line = read('src/components/ui/rich-text-editor.tsx')
    .split(/\r?\n/)
    .find((candidate) => candidate.includes("| ${isVi ? 'Tiêu chí'"));

  assert.ok(line, 'the three-column table template must stay in rich-text-editor.tsx');
  const start = line.indexOf('`');
  const end = line.lastIndexOf('`');
  assert.ok(start !== -1 && end > start, 'table template must be a template literal');
  const template = line.slice(start + 1, end);

  return (isVi) => Function('isVi', `return \`${template}\`;`)(isVi);
}

test('rich-text-editor inserts a structurally valid three-column table in both locales', () => {
  const render = renderTableTemplate();

  for (const [isVi, label] of [[true, 'vi'], [false, 'en']]) {
    const rows = render(isVi).split('\n').filter((row) => row.trim() !== '');
    assert.equal(rows.length, 4, `${label} table must have a header, separator, and two data rows`);

    for (const [index, row] of rows.entries()) {
      const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      assert.equal(cells.length, 3, `${label} table row ${index + 1} must have 3 cells: ${row}`);
    }
  }

  const english = render(false);
  assert.match(english, /Row 2/, 'English second row label must be localized');
  assert.match(english, /Value B/, 'English second row value must stay English');
  assert.doesNotMatch(english, /Giá trị/, 'English table must not contain Vietnamese copy');

  const vietnamese = render(true);
  assert.match(vietnamese, /Mục 2/);
  assert.match(vietnamese, /Giá trị B/);
});

// ---------------------------------------------------------------------------
// S6 — the code-block snippet comment must follow the active locale.
// ---------------------------------------------------------------------------

test('rich-text-editor code snippet comment follows the active locale', () => {
  const source = read('src/components/ui/rich-text-editor.tsx');

  assert.equal(
    source.includes("insertSnippet('```java\\n// Mã nguồn minh họa\\n```')"),
    false,
    'the code-block snippet must not hardcode the Vietnamese comment',
  );

  const codeLine = source
    .split(/\r?\n/)
    .find((candidate) => candidate.includes('insertSnippet(') && candidate.includes('```java'));
  assert.ok(codeLine, 'the code-block snippet must stay in rich-text-editor.tsx');
  assert.ok(
    codeLine.includes("isVi ? '// Mã nguồn minh họa' : '// Sample code'"),
    `code-block snippet must branch on locale: ${codeLine}`,
  );
});

// ---------------------------------------------------------------------------
// S2 — the English semester-name placeholder must not contain Vietnamese.
// ---------------------------------------------------------------------------

test('semester name placeholder is English in the English locale', () => {
  const source = read('src/app/admin/semesters/page.tsx');

  assert.match(
    source,
    /placeholder=\{copy\.fields\.namePlaceholder\}/,
    'the name field must read the localized placeholder from its page copy',
  );
  assert.equal(source.includes("'e.g. Học kỳ Thu 2026'"), false, 'English placeholder must not mix Vietnamese');
  assert.match(source, /namePlaceholder: 'e\.g\. Fall Semester 2026'/);
  assert.match(source, /namePlaceholder: 'Ví dụ: Học kỳ Thu 2026'/);
});

// ---------------------------------------------------------------------------
// S3 — the Vietnamese studentPages block must not ship English UI values.
// ---------------------------------------------------------------------------

test('studentPages Vietnamese catalogue values are actually Vietnamese', () => {
  const { en, vi } = loadMessages();

  assert.deepEqual(
    keyPaths(en.studentPages),
    keyPaths(vi.studentPages),
    'studentPages key parity must hold after the copy fixes',
  );

  const pairs = [
    ['announcements.banner.imageAlt', en.studentPages.announcements.banner.imageAlt, 'HCMUTE Campus Banner'],
    ['announcements.banner.campusPortal', en.studentPages.announcements.banner.campusPortal, 'HCMUTE Campus Portal'],
    ['schedule.courseCodeFallback', en.studentPages.schedule.courseCodeFallback, 'Course'],
    ['schedule.courseNameFallback', en.studentPages.schedule.courseNameFallback, 'Unavailable'],
    ['ics.defaultCalendarName', en.studentPages.ics.defaultCalendarName, 'CampusUTE Timetable'],
  ];

  const viValues = {
    'announcements.banner.imageAlt': vi.studentPages.announcements.banner.imageAlt,
    'announcements.banner.campusPortal': vi.studentPages.announcements.banner.campusPortal,
    'schedule.courseCodeFallback': vi.studentPages.schedule.courseCodeFallback,
    'schedule.courseNameFallback': vi.studentPages.schedule.courseNameFallback,
    'ics.defaultCalendarName': vi.studentPages.ics.defaultCalendarName,
  };

  for (const [key, englishValue, expectedEnglish] of pairs) {
    assert.equal(englishValue, expectedEnglish, `${key} English value must be unchanged`);
    assert.notEqual(viValues[key], englishValue, `${key} Vietnamese value must be translated`);
    assert.match(viValues[key], /[à-ỹ]/i, `${key} Vietnamese value must contain Vietnamese characters`);
  }
});

// ---------------------------------------------------------------------------
// S4 — the unsaved-changes guard owns locale-aware copy instead of VI defaults.
// ---------------------------------------------------------------------------

test('unsaved-changes guard resolves its copy from the active locale', () => {
  const source = read('src/lib/use-unsaved-changes-guard.ts');

  assert.match(source, /import \{ useI18n \} from '@\/i18n'/);
  assert.match(source, /const \{ messages \} = useI18n\(\)/);
  assert.match(source, /messages\.common\.unsavedChanges/);

  for (const literal of [
    "'Bạn có nội dung chưa được lưu. Rời khỏi trang sẽ mất thay đổi.'",
    "'Nội dung chưa được lưu'",
    "'Bạn có nội dung chưa được lưu. Rời khỏi sẽ mất các thay đổi. Tiếp tục?'",
  ]) {
    assert.equal(source.includes(literal), false, `guard must not hardcode ${literal}`);
  }

  const { en, vi } = loadMessages();
  const enCopy = en.common.unsavedChanges;
  const viCopy = vi.common.unsavedChanges;
  assert.deepEqual(Object.keys(enCopy).sort(), Object.keys(viCopy).sort());
  for (const key of Object.keys(enCopy)) {
    assert.ok(enCopy[key].trim(), `English unsavedChanges.${key} must be non-empty`);
    assert.ok(viCopy[key].trim(), `Vietnamese unsavedChanges.${key} must be non-empty`);
    assert.notEqual(enCopy[key], viCopy[key], `unsavedChanges.${key} must be localized`);
  }
  assert.match(viCopy.beforeUnload, /[à-ỹ]/i);
  assert.doesNotMatch(enCopy.beforeUnload, /[à-ỹ]/i);
});

// ---------------------------------------------------------------------------
// S10 — advisor directory column label must describe the same thing in vi/en.
// ---------------------------------------------------------------------------

test('advisor directory supervision column label is semantically aligned', () => {
  const source = read('src/components/dashboard/thesis/ThesisAdvisorDirectoryPage.tsx');

  assert.match(source, /title: isVi \? 'Chỉ tiêu hướng dẫn' : 'Supervision Quota'/);
  assert.equal(
    source.includes("title: isVi ? 'Tải hướng dẫn' : 'Supervision Quota'"),
    false,
    'the VI column label must not mean "download instructions"',
  );
});

// ---------------------------------------------------------------------------
// S11 — no personal name or test probe marker in production placeholder copy.
// ---------------------------------------------------------------------------

test('admin audit search placeholder is neutral and localized', () => {
  const source = read('src/app/admin/audit/page.tsx');

  assert.match(source, /placeholder=\{copy\.searchPlaceholder\}/);
  assert.equal(source.includes('Nguyễn Tiến Sơn'), false);
  assert.equal(source.includes('E2E PROBE'), false);

  const { en, vi } = loadMessages();
  assert.ok(en.admin.auditTrail.searchPlaceholder.trim());
  assert.ok(vi.admin.auditTrail.searchPlaceholder.trim());
  assert.notEqual(en.admin.auditTrail.searchPlaceholder, vi.admin.auditTrail.searchPlaceholder);
  assert.doesNotMatch(en.admin.auditTrail.searchPlaceholder, /Nguyễn Tiến Sơn|E2E PROBE/);
});

// ---------------------------------------------------------------------------
// Callout labels — the rich-content renderer must not print Vietnamese labels
// for English readers.
// ---------------------------------------------------------------------------

test('rich-content callout labels follow the active locale', () => {
  const source = read('src/components/ui/rich-content-renderer.tsx');

  assert.match(source, /function AlertCallout[\s\S]*?const \{ locale \} = useI18n\(\)/);

  const labels = [
    ["vi ? 'LƯU Ý (NOTE)' : 'NOTE'"],
    ["vi ? 'MẸO (TIP)' : 'TIP'"],
    ["vi ? 'QUAN TRỌNG (IMPORTANT)' : 'IMPORTANT'"],
    ["vi ? 'CẢNH BÁO (WARNING)' : 'WARNING'"],
    ["vi ? 'CHÚ Ý NGUY CƠ (CAUTION)' : 'CAUTION'"],
  ];
  for (const label of labels) {
    assert.ok(source.includes(`label: ${label}`), `callout label must branch on locale: ${label}`);
  }
});
