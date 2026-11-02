const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const FRAGMENT_FILE = 'src/i18n/messages-admin-academics.ts';

/**
 * The seven admin academic-resource pages that share this fragment, in the
 * catalogue namespace order. `page` is both the catalogue group and the
 * `adminAcademicsEn.<page>` member the page reads.
 */
const PAGES = [
  ['enrollments', 'src/app/admin/enrollments/page.tsx', 'Đang tải danh sách đăng ký học phần', 'Loading enrollments'],
  ['semesters', 'src/app/admin/semesters/page.tsx', 'Đang tải học kỳ', 'Loading semesters'],
  ['courses', 'src/app/admin/courses/page.tsx', 'Đang tải môn học', 'Loading courses'],
  ['departments', 'src/app/admin/departments/page.tsx', 'Đang tải khoa', 'Loading departments'],
  ['lecturers', 'src/app/admin/lecturers/page.tsx', 'Đang tải giảng viên', 'Loading lecturers'],
  ['classrooms', 'src/app/admin/classrooms/page.tsx', 'Đang tải phòng học', 'Loading classrooms'],
  ['academicYears', 'src/app/admin/academic-years/page.tsx', 'Đang tải năm học', 'Loading academic years'],
];

/** The skeleton every list page renders; enrollments keeps only what it uses. */
const SKELETON_KEYS = [
  'create',
  'description',
  'emptyDescription',
  'emptyTitle',
  'loadFailed',
  'loading',
  'pageSummary',
  'pageSummaryEmpty',
  'searchLabel',
  'searchPlaceholder',
  'tableTitle',
  'title',
  'unavailableTitle',
];

const RECORD_ACTION_KEYS = [
  'active',
  'createTitle',
  'created',
  'deleteConfirm',
  'deleteFailed',
  'deleteLabel',
  'deleteMessage',
  'deleteTitle',
  'deleted',
  'editLabel',
  'editTitle',
  'inactive',
  'saveFailed',
  'saving',
  'updated',
];

/**
 * Values that are legitimately identical in both locales: the lab proper nouns
 * on the departments banner and the loanword `Email` column header.
 */
const IDENTICAL_BY_DESIGN = new Set([
  'departments.banner.imageAlt',
  'departments.banner.labLabel',
  'lecturers.headers.email',
]);

/** ASCII-only Vietnamese values that are not English sentences. */
const VIETNAMESE_WITHOUT_DIACRITICS = new Set([
  'academicYears.pageSummary',
  'classrooms.pageSummary',
  'courses.department',
  'courses.headers.department',
  'courses.pageSummary',
  'departments.banner.imageAlt',
  'departments.banner.labLabel',
  'departments.pageSummary',
  'departments.title',
  'enrollments.pageSummary',
  'lecturers.fields.department',
  'lecturers.headers.department',
  'lecturers.headers.email',
  'lecturers.pageSummary',
  'semesters.pageSummary',
]);

const VI_DIACRITICS =
  /[ăâêôơưđáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùũụứừửữựýỳỷỹ]/i;

/** English function words and UI verbs that no Vietnamese value should carry. */
const ENGLISH_MARKERS =
  /\b(?:the|and|or|for|with|of|to|from|by|in|on|is|are|be|not|no|this|that|your|all|delete|create|search|loading|save|cancel|edit|new|matching|unavailable|records|actions|saving)\b/i;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadFragment() {
  const output = ts.transpileModule(read(FRAGMENT_FILE), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
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

function leaves(value, prefix = '') {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

const tokens = (value) => [...value.matchAll(/\{([A-Za-z][\w]*)\}/g)].map((match) => match[1]).sort();

function assertParity(en, vi, prefix = '') {
  if (en !== null && typeof en === 'object') {
    assert.equal(vi !== null && typeof vi === 'object' && !Array.isArray(vi), true, `${prefix} must be an object`);
    assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort(), `${prefix} keys must match`);
    for (const key of Object.keys(en)) {
      assertParity(en[key], vi[key], prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  assert.equal(typeof en, 'string', `${prefix} must be a string`);
  assert.equal(typeof vi, 'string', `${prefix} must be a string`);
  assert.notEqual(en.trim(), '', `${prefix} English copy must not be empty`);
  assert.notEqual(vi.trim(), '', `${prefix} Vietnamese copy must not be empty`);
  assert.deepEqual(tokens(en), tokens(vi), `${prefix} placeholder tokens must match`);
}

test('the admin academics fragment exports both locales with the seven page groups', () => {
  const { adminAcademicsEn, adminAcademicsVi } = loadFragment();

  assert.ok(adminAcademicsEn, 'messages-admin-academics.ts must export adminAcademicsEn');
  assert.ok(adminAcademicsVi, 'messages-admin-academics.ts must export adminAcademicsVi');
  assert.deepEqual(Object.keys(adminAcademicsEn), PAGES.map(([page]) => page));
  assert.deepEqual(Object.keys(adminAcademicsVi), Object.keys(adminAcademicsEn));
});

test('adminAcademics locales have identical key paths, copy, and placeholders', () => {
  const { adminAcademicsEn, adminAcademicsVi } = loadFragment();

  assert.deepEqual(keyPaths(adminAcademicsVi), keyPaths(adminAcademicsEn));
  assertParity(adminAcademicsEn, adminAcademicsVi, 'adminAcademics');
});

test('the seven page groups share one skeleton and keep their own header row', () => {
  const { adminAcademicsEn } = loadFragment();

  for (const [page] of PAGES) {
    const group = adminAcademicsEn[page];
    assert.ok(group, `adminAcademics.${page} must exist`);
    for (const key of SKELETON_KEYS) {
      if (page === 'enrollments' && (key === 'create' || key === 'pageSummaryEmpty')) continue;
      assert.equal(typeof group[key], 'string', `adminAcademics.${page}.${key} must be part of the skeleton`);
    }
    for (const key of RECORD_ACTION_KEYS) {
      if (page === 'enrollments') continue;
      assert.equal(typeof group[key], 'string', `adminAcademics.${page}.${key} must carry the record-action copy`);
    }
    assert.equal(typeof group.headers, 'object', `adminAcademics.${page}.headers must stay grouped`);
    assert.ok(Object.keys(group.headers).includes('actions'), `adminAcademics.${page}.headers.actions must exist`);
    if (page !== 'enrollments') {
      assert.equal(group.headers.status, 'Status', `adminAcademics.${page}.headers.status is the table column`);
    }
  }
});

test('the English fragment carries no Vietnamese and the Vietnamese fragment is translated', () => {
  const { adminAcademicsEn, adminAcademicsVi } = loadFragment();

  const leaked = leaves(adminAcademicsEn).filter(([, value]) => VI_DIACRITICS.test(value));
  assert.deepEqual(leaked, [], 'English copy must not contain Vietnamese characters');

  const englishInVietnamese = [];
  const identical = [];
  for (const [key, value] of leaves(adminAcademicsVi)) {
    const enValue = key.split('.').reduce((node, part) => (node ? node[part] : undefined), adminAcademicsEn);
    if (value === enValue && !IDENTICAL_BY_DESIGN.has(key)) identical.push(key);
    if (VI_DIACRITICS.test(value)) continue;
    if (VIETNAMESE_WITHOUT_DIACRITICS.has(key)) continue;
    const stripped = value.replace(/\{[^}]*\}/g, ' ');
    if (ENGLISH_MARKERS.test(stripped)) englishInVietnamese.push(`${key}: ${value}`);
    else if (/\.\s*$/.test(stripped) && stripped.trim().split(/\s+/).length >= 3) {
      englishInVietnamese.push(`${key}: ${value}`);
    }
  }

  assert.deepEqual(
    englishInVietnamese,
    [],
    `Vietnamese values must be Vietnamese, not English: ${englishInVietnamese.join(' | ')}`,
  );
  assert.deepEqual(
    identical,
    [],
    `Vietnamese values must differ from English unless the string is a proper noun: ${identical.join(', ')}`,
  );
});

test('the catalogue preserves the exact audited Vietnamese and English copy', () => {
  const { adminAcademicsEn: en, adminAcademicsVi: vi } = loadFragment();

  const cases = [
    ['enrollments.title', 'Quản lý Đăng ký học phần', 'Enrollments'],
    [
      'enrollments.emptyDescription',
      'Khi sinh viên bắt đầu đăng ký, màn hình này sẽ hiển thị môn học, lớp học phần, học kỳ và trạng thái cuối cùng trong cùng một nơi.',
      'When students start registering, this view will show course, section, semester, and final status in one place.',
    ],
    ['enrollments.headers.enrolledDate', 'Ngày đăng ký', 'Enrolled date'],
    ['enrollments.statusOptions.ENROLLED', 'Đã đăng ký', 'Registered'],
    ['enrollments.statusOptions.PENDING', 'Chờ xác nhận', 'Pending'],
    ['enrollments.deleteLabel', 'Xóa đăng ký của {learnerLabel}', 'Delete enrollment for {learnerLabel}'],
    ['enrollments.viewStudentLabel', 'Mở hồ sơ đăng ký của sinh viên {learnerLabel}', 'Open student enrollment profile for {learnerLabel}'],
    ['enrollments.detail.finalGrade', 'Điểm cuối kỳ', 'Final grade'],
    ['enrollments.detail.letterGrade', 'Điểm chữ', 'Letter grade'],
    ['semesters.title', 'Học kỳ', 'Semesters'],
    ['semesters.searchPlaceholder', 'Tìm theo học kỳ, loại hoặc năm', 'Search by semester, type, or year'],
    ['semesters.fields.namePlaceholder', 'Ví dụ: Học kỳ Thu 2026', 'e.g. Fall Semester 2026'],
    ['semesters.fields.englishNamePlaceholder', 'Ví dụ: Fall 2026', 'e.g. Fall 2026'],
    ['semesters.typeOptions.FIRST', 'Học kỳ 1', 'Semester 1'],
    ['semesters.typeOptions.SUMMER', 'Học kỳ Hè', 'Summer'],
    ['semesters.statusLabels.ADD_DROP_OPEN', 'Đang mở thêm hoặc hủy môn', 'Add or drop open'],
    ['semesters.statusLabels.DRAFT', 'Bản nháp', 'Draft'],
    ['courses.title', 'Môn học', 'Courses'],
    ['courses.allDepartments', 'Tất cả khoa', 'All departments'],
    ['courses.descriptionPlaceholder', 'Ghi chú thêm về môn học (không bắt buộc)', 'Optional course notes'],
    ['courses.fields.vietnameseDescription', 'Mô tả tiếng Việt', 'Vietnamese description'],
    ['departments.title', 'Khoa', 'Departments'],
    ['departments.noDescription', 'Chưa có mô tả', 'No description'],
    ['departments.banner.eyebrow', 'CƠ CẤU TỔ CHỨC & KHOA ĐÀO TẠO HCMUTE', 'HCMUTE ACADEMIC FACULTIES & DEPARTMENTS'],
    ['departments.banner.unitsLabel', 'Khoa & Đơn vị trực thuộc', 'Academic Units'],
    ['departments.banner.curriculumLabel', 'Chuẩn hóa tín chỉ', 'Curriculum Aligned'],
    ['departments.banner.labLabel', 'Smart Systems & Robotics Lab', 'Smart Systems & Robotics Lab'],
    ['lecturers.title', 'Giảng viên', 'Lecturers'],
    ['lecturers.unlinkedAccount', 'Chưa liên kết tài khoản', 'Unlinked account'],
    ['lecturers.notProvided', 'Chưa cập nhật', 'Not provided'],
    ['lecturers.fields.specializationPlaceholder', 'Tùy chọn: môn hoặc lĩnh vực phụ trách', 'Optional subject or field focus'],
    ['classrooms.title', 'Phòng học', 'Classrooms'],
    ['classrooms.typeOptions.LECTURE', 'Lớp học lý thuyết', 'Lecture'],
    ['classrooms.typeOptions.AUDITORIUM', 'Hội trường', 'Auditorium'],
    ['classrooms.deleteMessage', 'Xóa phòng {building} {roomNumber}? Hành động này sẽ gỡ phòng khỏi màn hình quản trị hiện tại.', 'Delete {building} {roomNumber}? This removes the classroom from the current admin view.'],
    ['academicYears.title', 'Năm học', 'Academic years'],
    ['academicYears.endDateBeforeStart', 'Ngày kết thúc phải sau ngày bắt đầu.', 'End date must be after the start date.'],
    ['academicYears.deleteMessage', 'Xóa năm học {year}? Hành động này sẽ gỡ năm học khỏi màn hình quản trị hiện tại.', 'Delete {year}? This removes the academic year from the current admin view.'],
    ['academicYears.editLabel', 'Chỉnh sửa năm học {year}', 'Edit academic year {year}'],
  ];

  for (const [key, viValue, enValue] of cases) {
    assert.equal(key.split('.').reduce((node, part) => node[part], vi), viValue, `vi ${key}`);
    assert.equal(key.split('.').reduce((node, part) => node[part], en), enValue, `en ${key}`);
  }
});

test('every admin academics page reads the fragment instead of owning a locale dictionary', () => {
  for (const [page, file, viLoading, enLoading] of PAGES) {
    const source = read(file);

    assert.match(
      source,
      /import \{ adminAcademicsEn, adminAcademicsVi \} from '@\/i18n\/messages-admin-academics';/,
      `${file} must import the fragment directly`,
    );
    assert.match(
      source,
      new RegExp(
        `const copy = \\{ en: adminAcademicsEn\\.${page}, vi: adminAcademicsVi\\.${page} \\}\\[locale\\];`,
      ),
      `${file} must pick its page group with the active locale`,
    );
    assert.doesNotMatch(
      source,
      /locale\s*===\s*['"]vi['"]\s*\?\s*['"{]/,
      `${file} still forks user-facing copy through an inline locale ternary`,
    );
    assert.equal(source.includes(viLoading), false, `${file} still owns "${viLoading}"`);
    assert.equal(source.includes(enLoading), false, `${file} still owns "${enLoading}"`);
    assert.doesNotMatch(
      source,
      /copy\.(?:deleteMessage|editLabel|deleteLabel|pageSummary|viewLabel|viewStudentLabel|enrollmentsCount)\(/,
      `${file} must fill catalogue templates instead of calling page-local copy functions`,
    );
  }
});

test('the pages fill template tokens at render time and keep the previous wording', () => {
  const source = (file) => read(file);

  assert.match(
    source('src/app/admin/academic-years/page.tsx'),
    /copy\.deleteMessage\.replace\('\{year\}', \(\) => String\(record\.year\)\)/,
    'the academic-year delete confirmation still interpolates the year',
  );
  assert.match(
    source('src/app/admin/classrooms/page.tsx'),
    /copy\.deleteMessage[\s\S]{0,160}?\.replace\('\{building\}', \(\) => room\.building\)[\s\S]{0,160}?\.replace\('\{roomNumber\}', \(\) => room\.roomNumber\)/,
    'the classroom delete confirmation still interpolates the room',
  );
  assert.match(
    source('src/app/admin/enrollments/page.tsx'),
    /copy\.deleteMessage\.replace\('\{learnerLabel\}', \(\) => learnerLabel\)/,
    'the enrollment delete confirmation still interpolates the learner',
  );
  assert.match(
    source('src/app/admin/enrollments/page.tsx'),
    /copy\.enrollmentsCount\.replace\('\{count\}', \(\) => formatNumber\(total\)\)/,
    'the enrollment counter still formats the total for the active locale',
  );
  assert.match(
    source('src/app/admin/semesters/page.tsx'),
    /copy\.statusLabels\[status as keyof typeof copy\.statusLabels\]/,
    'semester status labels still resolve through the fragment',
  );
  assert.match(
    source('src/app/admin/departments/page.tsx'),
    /copy\.banner\.labLabel/,
    'the department banner caption still reads the fragment',
  );
});
