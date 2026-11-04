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

function assertLocaleShape(english, vietnamese, path = 'teachingPages') {
  assert.equal(Array.isArray(english), Array.isArray(vietnamese), `${path} array shape`);
  if (Array.isArray(english)) {
    assert.equal(english.length, vietnamese.length, `${path} array length`);
    english.forEach((value, index) => assertLocaleShape(value, vietnamese[index], `${path}[${index}]`));
    return;
  }
  if (english && typeof english === 'object') {
    assert.deepEqual(Object.keys(english).sort(), Object.keys(vietnamese).sort(), `${path} keys`);
    for (const key of Object.keys(english)) {
      assertLocaleShape(english[key], vietnamese[key], `${path}.${key}`);
    }
    return;
  }
  if (typeof english === 'string') {
    assert.equal(typeof vietnamese, 'string', `${path} value type`);
    assert.notEqual(english.trim(), '', `${path} English copy is non-empty`);
    assert.notEqual(vietnamese.trim(), '', `${path} Vietnamese copy is non-empty`);
    const tokens = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(tokens(english), tokens(vietnamese), `${path} placeholder tokens`);
  }
}

function loadExport(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const aliases = { '@/i18n/messages': loadMessages() };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadFunction(relativePath, functionName) {
  const source = read(relativePath);
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(declaration, `${functionName} exists in ${relativePath}`);
  const output = ts.transpileModule(declaration.getText(sourceFile), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', `${output}\nmodule.exports = ${functionName};`)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function render(template, values) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, () => String(value)),
    template,
  );
}

test('teachingPages fragment is mounted', () => {
  const { en, vi } = loadMessages();
  assert.equal(Object.hasOwn(en, 'teachingPages'), true);
  assert.equal(Object.hasOwn(vi, 'teachingPages'), true);
  assert.deepEqual(keyPaths(en.teachingPages), keyPaths(vi.teachingPages));
  assertLocaleShape(en.teachingPages, vi.teachingPages);
});

test('grade entry copy is an exact extraction of the old English and Vietnamese dictionary', () => {
  const { en, vi } = loadMessages();
  const expected = {
    en: {
      eyebrow: 'Lecturer area',
      title: 'Grade management',
      backToGrades: 'Back to grade management',
      missingSection: 'The selected class could not be found.',
      loadFailed: 'The grading view could not be loaded.',
      loading: 'Loading class grades',
      errorDescription: 'Resolve class-level grading issues before retrying the class view.',
      pageDescription: 'Capture grades for {courseName}, review student records, and release results only when the class is ready.',
      saveGrades: 'Save grades',
      savingGrades: 'Saving grades',
      publishGrades: 'Release grades',
      saveBeforePublish: 'Save your changes before releasing grades.',
      publishingGrades: 'Releasing grades',
      saved: 'Grades saved',
      saveFailed: 'Grades could not be saved.',
      staleVersionMessage: 'Grades changed after you loaded this sheet. Your edits are still here; reload to compare before saving.',
      reloadStaleGrades: 'Reload and compare',
      remoteChangedRows: 'Changed rows: {rows}',
      noRemoteChangedRows: 'No row changes were detected. Review your edits before continuing.',
      keepEditsOnLatestVersions: 'Keep my edits and use latest versions',
      invalidScore: 'Score must be a number between 0 and 10.',
      partialRowsOnly: '{count} row(s) have only one score filled — complete both columns to save.',
      partialRowsSkipped: '{count} row(s) with only one score filled were not saved.',
      unsavedTitle: 'Unsaved grades',
      unsavedBody: 'Some score cells have not been saved yet. Leaving this screen discards them. Continue?',
      publishTitle: 'Release grades',
      publishMessage: 'Release these grades now? Students will see the results immediately, so confirm that everything is ready.',
      published: 'Grades released',
      publishFailed: 'Grades could not be released.',
      students: 'Students',
      gradedRecords: 'Graded records',
      sectionStatus: 'Class status',
      publishWarning: 'At least one student still needs a grade before this class can release results.',
      emptyTitle: 'No enrolled students',
      emptyDescription: 'This class does not currently have any enrolled students to grade.',
      tableTitle: 'Student grades',
      headers: {
        number: 'STT', student: 'Student', studentId: 'Student ID', email: 'Email',
        processScore: 'Coursework (50%)', finalExamScore: 'Final (50%)', total: 'Total', letter: 'Letter', status: 'Status',
      },
      unavailableEmail: 'Unavailable',
      noLetterGrade: 'Not selected',
      processScoreLabel: 'Coursework (50%) for {studentName}',
      finalExamScoreLabel: 'Final exam score (50%) for {studentName}',
      letterGradeLabel: 'Letter grade for {studentName}',
      publishedStatus: 'Published',
      draftStatus: 'Draft',
      unsavedStatus: 'Unsaved',
      sectionPrefix: 'Class',
      unavailableTitle: 'Class grades unavailable',
      exportCsv: 'Export CSV',
      exportCsvSuccess: 'Grade roster CSV exported successfully.',
      print: {
        roster: 'Print grade sheet',
        officialHeader: 'HO CHI MINH CITY UNIVERSITY OF TECHNOLOGY AND ENGINEERING — CAMPUSUTE',
        department: 'CAMPUSUTE',
        reportTitle: 'COURSE SECTION FINAL GRADE ROSTER',
        instructorSignature: 'COURSE INSTRUCTOR',
        departmentHeadSignature: 'DEPARTMENT HEAD',
        signatureNotice: '(Signature and full name)',
        passRate: 'Pass rate',
        averageScore: 'Average',
        sectionLabel: 'Section:', courseLabel: 'Course:', semesterLabel: 'Semester:', lecturerLabel: 'Instructor:',
        dateTemplate: 'Ho Chi Minh City, {month} {day}, {year}',
      },
      confirm: { continue: 'Continue', keepEditing: 'Keep editing' },
      currentTermFallback: 'Current term',
      facultyFallback: 'Faculty',
    },
    vi: {
      eyebrow: 'Cổng Giảng viên',
      title: 'Quản lý điểm',
      backToGrades: 'Quay lại quản lý điểm',
      missingSection: 'Không thể xác định lớp học phần đã chọn.',
      loadFailed: 'Hiện chưa thể tải màn hình chấm điểm cho lớp học phần này.',
      loading: 'Đang tải lớp học phần',
      errorDescription: 'Hãy xử lý lỗi của lớp học phần trước khi thử mở lại màn hình chấm điểm.',
      pageDescription: 'Ghi nhận điểm cho {courseName}, rà soát hồ sơ sinh viên và chỉ công bố khi lớp học phần đã sẵn sàng.',
      saveGrades: 'Lưu điểm',
      savingGrades: 'Đang lưu điểm',
      publishGrades: 'Công bố điểm',
      saveBeforePublish: 'Lưu các thay đổi trước khi công bố điểm.',
      publishingGrades: 'Đang công bố điểm',
      saved: 'Đã lưu điểm',
      saveFailed: 'Hiện chưa thể lưu điểm.',
      staleVersionMessage: 'Bảng điểm đã thay đổi sau khi bạn tải. Các chỉnh sửa vẫn được giữ; hãy tải lại để so sánh trước khi lưu.',
      reloadStaleGrades: 'Tải lại và so sánh',
      remoteChangedRows: 'Các dòng đã thay đổi: {rows}',
      noRemoteChangedRows: 'Không phát hiện dòng nào thay đổi. Hãy rà soát chỉnh sửa trước khi tiếp tục.',
      keepEditsOnLatestVersions: 'Giữ chỉnh sửa và dùng phiên bản mới nhất',
      invalidScore: 'Điểm phải là số từ 0 đến 10.',
      partialRowsOnly: '{count} dòng mới nhập một nửa điểm — hãy điền đủ cả hai cột để lưu.',
      partialRowsSkipped: '{count} dòng chỉ mới nhập một nửa điểm nên chưa được lưu.',
      unsavedTitle: 'Điểm chưa được lưu',
      unsavedBody: 'Bạn còn ô điểm đã nhập chưa lưu. Rời khỏi màn hình sẽ mất các điểm đó. Tiếp tục?',
      publishTitle: 'Công bố điểm',
      publishMessage: 'Công bố điểm ngay bây giờ? Sinh viên sẽ nhìn thấy kết quả đã công bố, nên đây cần là một bước phát hành có chủ đích.',
      published: 'Đã công bố điểm',
      publishFailed: 'Hiện chưa thể công bố điểm.',
      students: 'Sinh viên',
      gradedRecords: 'Bản ghi đã chấm',
      sectionStatus: 'Trạng thái lớp học phần',
      publishWarning: 'Vẫn còn ít nhất một sinh viên cần điểm trước khi lớp học phần này có thể công bố kết quả.',
      emptyTitle: 'Chưa có sinh viên đăng ký',
      emptyDescription: 'Lớp học phần này hiện chưa có sinh viên nào để chấm điểm.',
      tableTitle: 'Điểm sinh viên',
      headers: {
        number: 'STT', student: 'Sinh viên', studentId: 'Mã sinh viên', email: 'Email',
        processScore: 'ĐQT (50%)', finalExamScore: 'ĐCK (50%)', total: 'Tổng kết', letter: 'Điểm chữ', status: 'Trạng thái',
      },
      unavailableEmail: 'Chưa có',
      noLetterGrade: 'Chưa chọn',
      processScoreLabel: 'ĐQT (50%) cho {studentName}',
      finalExamScoreLabel: 'ĐCK (50%) cho {studentName}',
      letterGradeLabel: 'Xếp loại cho {studentName}',
      publishedStatus: 'Đã công bố',
      draftStatus: 'Bản nháp',
      unsavedStatus: 'Chưa lưu',
      sectionPrefix: 'Lớp',
      unavailableTitle: 'Lớp học phần chưa sẵn sàng',
      exportCsv: 'Xuất CSV',
      exportCsvSuccess: 'Đã xuất bảng điểm CSV thành công.',
      print: {
        roster: 'In bảng điểm',
        officialHeader: 'TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM — CAMPUSUTE',
        department: 'HỆ THỐNG CAMPUSUTE',
        reportTitle: 'BẢNG ĐIỂM TỔNG KẾT HỌC PHẦN',
        instructorSignature: 'GIẢNG VIÊN CHẤM ĐIỂM',
        departmentHeadSignature: 'TRƯỞNG BỘ MÔN DUYỆT',
        signatureNotice: '(Ký và ghi rõ họ tên)',
        passRate: 'Tỷ lệ đạt',
        averageScore: 'Điểm TB',
        sectionLabel: 'Lớp học phần:', courseLabel: 'Học phần:', semesterLabel: 'Học kỳ:', lecturerLabel: 'Giảng viên:',
        dateTemplate: 'TP. Hồ Chí Minh, ngày {day} tháng {month} năm {year}',
      },
      confirm: { continue: 'Tiếp tục', keepEditing: 'Ở lại nhập điểm' },
      currentTermFallback: 'Học kỳ hiện tại',
      facultyFallback: 'Ban Giảng viên',
    },
  };
  assert.deepEqual(en.teachingPages.gradeEntry, expected.en);
  assert.deepEqual(vi.teachingPages.gradeEntry, expected.vi);
});

test('teaching print and thesis link templates render the exact prior copy', () => {
  const { en, vi } = loadMessages();
  assert.deepEqual(vi.teachingPages.attendancePrint, {
    sectionLabel: 'Lớp học phần:',
    courseLabel: 'Học phần:',
    signatureNotice: 'Ký và ghi rõ họ tên',
    dateTemplate: 'TP. Hồ Chí Minh, {date}',
    datePartsTemplate: 'ngày {day} tháng {month} năm {year}',
  });
  assert.deepEqual(en.teachingPages.attendancePrint, {
    sectionLabel: 'Section:',
    courseLabel: 'Course:',
    signatureNotice: 'Signature & full name',
    dateTemplate: 'Date: {date}',
    datePartsTemplate: '{year}-{month}-{day}',
  });
  assert.deepEqual(vi.teachingPages.thesisLinks, {
    archive: 'Kho lưu trữ luận án & báo cáo →',
    workspaceTopics: 'Quản lý Đề tài & Nhóm trong Workspace →',
  });
  assert.deepEqual(en.teachingPages.thesisLinks, {
    archive: 'Thesis & Report Archive →',
    workspaceTopics: 'Manage Topics & Groups in Workspace →',
  });
  assert.equal(render(vi.teachingPages.attendancePrint.dateTemplate, {
    date: render(vi.teachingPages.attendancePrint.datePartsTemplate, { year: '2026', month: '10', day: '18' }),
  }), 'TP. Hồ Chí Minh, ngày 18 tháng 10 năm 2026');
  assert.equal(render(en.teachingPages.attendancePrint.dateTemplate, {
    date: render(en.teachingPages.attendancePrint.datePartsTemplate, { year: '2026', month: '10', day: '18' }),
  }), 'Date: 2026-10-18');
  assert.equal(render(vi.teachingPages.gradeEntry.pageDescription, { courseName: 'Toán cao cấp' }),
    'Ghi nhận điểm cho Toán cao cấp, rà soát hồ sơ sinh viên và chỉ công bố khi lớp học phần đã sẵn sàng.');
  assert.equal(render(en.teachingPages.gradeEntry.pageDescription, { courseName: 'Calculus' }),
    'Capture grades for Calculus, review student records, and release results only when the class is ready.');
  assert.equal(render(vi.teachingPages.gradeEntry.print.dateTemplate, { day: '1', month: '11', year: '2026' }),
    'TP. Hồ Chí Minh, ngày 1 tháng 11 năm 2026');
  assert.equal(render(en.teachingPages.gradeEntry.print.dateTemplate, { day: '1', month: 'November', year: '2026' }),
    'Ho Chi Minh City, November 1, 2026');
  assert.equal(vi.teachingPages.gradeEntry.partialRowsOnly.replace('{count}', '2'),
    '2 dòng mới nhập một nửa điểm — hãy điền đủ cả hai cột để lưu.');
  assert.equal(en.teachingPages.gradeEntry.partialRowsOnly.replace('{count}', '2'),
    '2 row(s) have only one score filled — complete both columns to save.');
  assert.equal(vi.teachingPages.gradeEntry.partialRowsSkipped.replace('{count}', '2'),
    '2 dòng chỉ mới nhập một nửa điểm nên chưa được lưu.');
  assert.equal(en.teachingPages.gradeEntry.partialRowsSkipped.replace('{count}', '2'),
    '2 row(s) with only one score filled were not saved.');
  assert.equal(vi.teachingPages.gradeEntry.processScoreLabel.replace('{studentName}', () => 'Nguyễn Văn An'),
    'ĐQT (50%) cho Nguyễn Văn An');
  assert.equal(en.teachingPages.gradeEntry.processScoreLabel.replace('{studentName}', () => 'John Smith'),
    'Coursework (50%) for John Smith');
  assert.equal(vi.teachingPages.gradeEntry.finalExamScoreLabel.replace('{studentName}', () => 'Nguyễn Văn An'),
    'ĐCK (50%) cho Nguyễn Văn An');
  assert.equal(en.teachingPages.gradeEntry.finalExamScoreLabel.replace('{studentName}', () => 'John Smith'),
    'Final exam score (50%) for John Smith');
  assert.equal(vi.teachingPages.gradeEntry.letterGradeLabel.replace('{studentName}', () => 'Nguyễn Văn An'),
    'Xếp loại cho Nguyễn Văn An');
  assert.equal(en.teachingPages.gradeEntry.letterGradeLabel.replace('{studentName}', () => 'John Smith'),
    'Letter grade for John Smith');
});

test('useI18n date formatter options preserve grade print and thesis round-window output', () => {
  const date = new Date(2026, 10, 1, 14, 5);
  const formatDatePart = (locale, options) => new Intl.DateTimeFormat(
    locale === 'vi' ? 'vi-VN' : 'en-US',
    {
      year: 'numeric',
      month: locale === 'vi' ? '2-digit' : 'short',
      day: locale === 'vi' ? '2-digit' : 'numeric',
      ...options,
    },
  ).format(date);
  const printDate = (locale) => {
    const entry = loadMessages()[locale].teachingPages.gradeEntry.print;
    return render(entry.dateTemplate, {
      day: formatDatePart(locale, { year: undefined, month: undefined, day: 'numeric' }),
      month: formatDatePart(locale, {
        year: undefined,
        day: undefined,
        month: locale === 'vi' ? 'numeric' : 'long',
      }),
      year: formatDatePart(locale, { month: undefined, day: undefined, year: 'numeric' }),
    });
  };
  assert.equal(printDate('vi'), 'TP. Hồ Chí Minh, ngày 1 tháng 11 năm 2026');
  assert.equal(printDate('en'), 'Ho Chi Minh City, November 1, 2026');

  const formatRoundWindow = loadFunction('src/app/admin/thesis/page.tsx', 'formatRoundWindow');
  const roundWindowOptions = {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  };
  const expectedRoundWindow = {
    vi: '07:00 15/09/2026 → 08:30 16/09/2026',
    en: '09/15/2026, 07:00 → 09/16/2026, 08:30',
  };
  for (const locale of ['vi', 'en']) {
    const intlLocale = locale === 'vi' ? 'vi-VN' : 'en-US';
    const formatDateTime = (value, options) => new Intl.DateTimeFormat(intlLocale, {
      year: 'numeric',
      month: locale === 'vi' ? '2-digit' : 'short',
      day: locale === 'vi' ? '2-digit' : 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(value);
    assert.equal(
      formatRoundWindow(formatDateTime, '2026-09-15T07:00:00', '2026-09-16T08:30:00'),
      expectedRoundWindow[locale],
      `${locale} admin round-window output`,
    );
  }
  assert.throws(
    () => formatRoundWindow(() => '', 'invalid-start', '2026-09-16T08:30:00'),
    { name: 'RangeError', message: 'Invalid time value' },
  );
});

test('owned page and export consumers use teachingPages instead of the extracted local strings', () => {
  const attendance = read('src/app/dashboard/lecturer/attendance/page.tsx');
  const grades = read('src/app/dashboard/lecturer/grades/[id]/page.tsx');
  const thesis = read('src/app/admin/thesis/page.tsx');
  const attendanceExport = read('src/lib/attendance-export.ts');
  const gradeExport = read('src/lib/grade-export.ts');

  assert.match(attendance, /messages\.teachingPages\.attendancePrint/);
  assert.doesNotMatch(attendance, /const\s+copy\s*=|Lớp học phần:|Section:|Học phần:|Course:|Signature & full name|Ký và ghi rõ họ tên|Date: \$\{selectedDate\}/);
  assert.match(grades, /messages\.teachingPages\.gradeEntry/);
  assert.doesNotMatch(grades, /const\s+copy\s*=|Cổng Giảng viên|Lecturer area|Quản lý điểm|Grade management|Tỷ lệ đạt|Pass rate|toLocaleDateString/);
  assert.match(thesis, /messages\.teachingPages\.thesisLinks/);
  assert.doesNotMatch(thesis, /Kho lưu trữ luận án & báo cáo|Thesis & Report Archive|Quản lý Đề tài & Nhóm trong Workspace|Manage Topics & Groups in Workspace/);
  assert.match(thesis, /formatDateTime\(startDate, options\)/);
  assert.doesNotMatch(thesis, /new Intl\.DateTimeFormat|vi-VN|en-US/);
  assert.match(attendanceExport, /getMessages\(locale\)\.teachingPages\.attendanceCsv/);
  assert.match(gradeExport, /getMessages\(locale\)\.teachingPages\.gradeCsv/);
  assert.doesNotMatch(attendanceExport, /STATUS_LABELS|BẢNG ĐIỂM DANH|COURSE SECTION ATTENDANCE|Lớp học phần:|Attendance Rate:/);
  assert.doesNotMatch(gradeExport, /BẢNG ĐIỂM TỔNG KẾT|COURSE SECTION FINAL GRADE|GRADE DISTRIBUTION SUMMARY|Đã công bố|Published/);
});

test('CSV exports remain byte-identical to the prior Vietnamese and English output', () => {
  const { generateAttendanceCsv } = loadExport('src/lib/attendance-export.ts');
  const { generateGradeCsv } = loadExport('src/lib/grade-export.ts');
  const attendanceOptions = {
    sectionNumber: 'CS101-01', courseCode: 'CS101', courseName: 'Intro to "CS", A', date: '2026-10-18',
    lecturerName: 'Nguyen, A', semesterName: 'Fall 2026',
    metrics: { total: 1, present: 0, absent: 0, late: 1, excused: 0, rate: 100 },
    students: [{ studentId: 'id-1', studentCode: 'SV001', studentName: 'Nguyen "An"', status: 'LATE', notes: 'Arrived, 5m' }],
  };
  const gradeOptions = {
    sectionNumber: 'CS101-01', courseCode: 'CS101', courseName: 'Intro to "CS", A', semesterName: 'Fall 2026', lecturerName: 'Nguyen, A',
    students: [{ studentId: 'id-1', studentCode: 'SV001', studentName: 'Nguyen "An"', email: 'an@example.test', processScore: 8.5, finalExamScore: 9, totalScore: 8.75, letterGrade: 'A', gradeStatus: 'PUBLISHED' }],
  };
  const expectedAttendance = {
    vi: `\uFEFF"TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP. HỒ CHÍ MINH — CAMPUSUTE"\r\n"BẢNG ĐIỂM DANH LỚP HỌC PHẦN"\r\n\r\n"Lớp học phần:","CS101-01","Học phần:","CS101 - Intro to ""CS"", A"\r\n"Ngày điểm danh:","2026-10-18","Học kỳ:","Fall 2026"\r\n"Giảng viên phụ trách:","Nguyen, A"\r\n"Tổng sĩ số:","1","Có mặt:","0","Vắng:","0","Đi trễ:","1","Có phép:","0","Tỷ lệ chuyên cần:","100.0%"\r\n\r\n"STT","Mã sinh viên","Họ và tên","Trạng thái điểm danh","Ghi chú"\r\n"1","SV001","Nguyen ""An""","Đi trễ","Arrived, 5m"\r\n`,
    en: `\uFEFF"HO CHI MINH CITY UNIVERSITY OF TECHNOLOGY AND ENGINEERING — CAMPUSUTE"\r\n"COURSE SECTION ATTENDANCE ROSTER"\r\n\r\n"Section:","CS101-01","Course:","CS101 - Intro to ""CS"", A"\r\n"Date:","2026-10-18","Semester:","Fall 2026"\r\n"Instructor:","Nguyen, A"\r\n"Total:","1","Present:","0","Absent:","0","Late:","1","Excused:","0","Attendance Rate:","100.0%"\r\n\r\n"No.","Student ID","Full Name","Attendance Status","Notes"\r\n"1","SV001","Nguyen ""An""","Late","Arrived, 5m"\r\n`,
  };
  const expectedGrade = {
    vi: `\uFEFF"TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP. HỒ CHÍ MINH — CAMPUSUTE"\r\n"BẢNG ĐIỂM TỔNG KẾT HỌC PHẦN"\r\n\r\n"Lớp học phần:","CS101-01","Học phần:","CS101 - Intro to ""CS"", A"\r\n"Học kỳ:","Fall 2026","Giảng viên:","Nguyen, A"\r\n\r\n"'--- THỐNG KÊ KẾT QUẢ ĐÁNH GIÁ ---"\r\n"Sĩ số:","1","Đã chấm:","1","Chưa chấm:","0","Đạt (>= 4.0):","1","Không đạt (< 4.0):","0","Tỷ lệ đạt:","100.0%","Điểm trung bình:","8.75"\r\n"A+ / A:","1","B+ / B:","0","C+ / C:","0","D+ / D:","0","F:","0"\r\n\r\n"STT","Mã sinh viên","Họ và tên","Email","Điểm quá trình (50%)","Điểm thi kết thúc (50%)","Tổng kết (Hệ 10)","Điểm chữ","Trạng thái"\r\n"1","SV001","Nguyen ""An""","an@example.test","8.5","9.0","8.75","A","Đã công bố"\r\n`,
    en: `\uFEFF"HO CHI MINH CITY UNIVERSITY OF TECHNOLOGY AND ENGINEERING — CAMPUSUTE"\r\n"COURSE SECTION FINAL GRADE ROSTER"\r\n\r\n"Section:","CS101-01","Course:","CS101 - Intro to ""CS"", A"\r\n"Semester:","Fall 2026","Instructor:","Nguyen, A"\r\n\r\n"'--- GRADE DISTRIBUTION SUMMARY ---"\r\n"Total:","1","Graded:","1","Ungraded:","0","Passed:","1","Failed:","0","Pass Rate:","100.0%","Average:","8.75"\r\n"A+ / A:","1","B+ / B:","0","C+ / C:","0","D+ / D:","0","F:","0"\r\n\r\n"No.","Student ID","Full Name","Email","Coursework (50%)","Final Exam Score (50%)","Total (Scale 10)","Letter Grade","Status"\r\n"1","SV001","Nguyen ""An""","an@example.test","8.5","9.0","8.75","A","Published"\r\n`,
  };
  for (const locale of ['vi', 'en']) {
    assert.equal(generateAttendanceCsv({ ...attendanceOptions, locale }), expectedAttendance[locale], `${locale} attendance CSV`);
    assert.equal(generateGradeCsv({ ...gradeOptions, locale }), expectedGrade[locale], `${locale} grade CSV`);
  }
});

test('attendance print date and signature block render the exact prior copy', () => {
  const { en, vi } = loadMessages();
  const printDate = (locale, selectedDate) => {
    const print = locale === 'vi'
      ? vi.teachingPages.attendancePrint
      : en.teachingPages.attendancePrint;
    const [year, month, day] = selectedDate.split('-');
    return render(print.dateTemplate, {
      date: render(print.datePartsTemplate, { year, month, day }),
    });
  };
  // The old JSX split the ISO date and interpolated the raw segments, so a
  // zero-padded day and month must stay padded.
  assert.equal(printDate('vi', '2026-10-18'), 'TP. Hồ Chí Minh, ngày 18 tháng 10 năm 2026');
  assert.equal(printDate('vi', '2026-01-05'), 'TP. Hồ Chí Minh, ngày 05 tháng 01 năm 2026');
  assert.equal(printDate('en', '2026-10-18'), 'Date: 2026-10-18');
  assert.equal(printDate('en', '2026-01-05'), 'Date: 2026-01-05');
  assert.equal(`(${vi.teachingPages.attendancePrint.signatureNotice})`, '(Ký và ghi rõ họ tên)');
  assert.equal(`(${en.teachingPages.attendancePrint.signatureNotice})`, '(Signature & full name)');
});

test('CSV fallback labels and status text keep the prior output', () => {
  const { generateAttendanceCsv } = loadExport('src/lib/attendance-export.ts');
  const { generateGradeCsv } = loadExport('src/lib/grade-export.ts');
  const attendanceOptions = {
    sectionNumber: 'S1',
    date: '2026-10-18',
    metrics: { total: 2, present: 0, absent: 0, late: 0, excused: 0, rate: 0 },
    students: [
      { studentId: 'id-1', studentCode: 'A', studentName: 'No Mark', status: null, notes: '' },
      { studentId: 'id-2', studentCode: 'B', studentName: 'Unknown', status: 'RETIRED', notes: '' },
    ],
  };
  const gradeOptions = {
    sectionNumber: 'S1',
    students: [{ studentId: 'id-1', studentCode: 'A', studentName: 'No Status', processScore: 8, finalExamScore: 8 }],
  };
  const attendanceVi = generateAttendanceCsv({ ...attendanceOptions, locale: 'vi' });
  const attendanceEn = generateAttendanceCsv({ ...attendanceOptions, locale: 'en' });
  assert.match(attendanceVi, /"Học kỳ:","Học kỳ hiện tại"/);
  assert.match(attendanceVi, /"1","A","No Mark","Chưa điểm danh",""/);
  assert.match(attendanceVi, /"2","B","Unknown","RETIRED",""/);
  assert.match(attendanceEn, /"Semester:","Current term"/);
  assert.match(attendanceEn, /"1","A","No Mark","Unmarked",""/);
  assert.match(attendanceEn, /"2","B","Unknown","RETIRED",""/);

  const gradeVi = generateGradeCsv({ ...gradeOptions, locale: 'vi' });
  const gradeEn = generateGradeCsv({ ...gradeOptions, locale: 'en' });
  assert.match(gradeVi, /"Học kỳ:","Học kỳ hiện tại","Giảng viên:","Ban Giảng viên"/);
  assert.match(gradeVi, /"1","A","No Status","","8.0","8.0","8.00","B\+","Bản nháp"/);
  assert.match(gradeEn, /"Semester:","Current term","Instructor:","Faculty"/);
  assert.match(gradeEn, /"1","A","No Status","","8.0","8.0","8.00","B\+","Draft"/);
});
