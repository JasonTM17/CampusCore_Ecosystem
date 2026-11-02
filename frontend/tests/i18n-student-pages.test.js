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

test('studentPages fragment is mounted', () => {
  const { en, vi } = loadMessages();
  assert.equal(Object.hasOwn(en, 'studentPages'), true);
  assert.equal(Object.hasOwn(vi, 'studentPages'), true);
  assert.deepEqual(keyPaths(en.studentPages), keyPaths(vi.studentPages));
});

function placeholders(value) {
  return [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

function assertCatalogParity(en, vi, path = 'studentPages') {
  if (Array.isArray(en)) {
    assert.equal(Array.isArray(vi), true, `${path} must be an array in both locales`);
    assert.equal(vi.length, en.length, `${path} array lengths must match`);
    en.forEach((value, index) => assertCatalogParity(value, vi[index], `${path}[${index}]`));
    return;
  }

  if (en !== null && typeof en === 'object') {
    assert.notEqual(vi, null, `${path} must exist in Vietnamese`);
    assert.deepEqual(
      Object.keys(en).sort(),
      Object.keys(vi).sort(),
      `${path} key paths must match`,
    );
    for (const key of Object.keys(en)) {
      assertCatalogParity(en[key], vi[key], `${path}.${key}`);
    }
    return;
  }

  assert.equal(typeof en, 'string', `${path} English value must be a string`);
  assert.equal(typeof vi, 'string', `${path} Vietnamese value must be a string`);
  assert.notEqual(en.trim(), '', `${path} English value must be non-empty`);
  assert.notEqual(vi.trim(), '', `${path} Vietnamese value must be non-empty`);
  assert.deepEqual(placeholders(en), placeholders(vi), `${path} placeholder tokens must match`);
}

function render(template, values) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

test('studentPages locale catalogs have matching non-empty values and templates', () => {
  const { en, vi } = loadMessages();
  assert.deepEqual(keyPaths(en.studentPages), keyPaths(vi.studentPages));
  assertCatalogParity(en.studentPages, vi.studentPages);
});

test('the notifications load-more key resolves in both locales', () => {
  const { en, vi } = loadMessages();
  assert.equal(typeof en.studentPages.notifications?.loadMore, 'string');
  assert.equal(typeof vi.studentPages.notifications?.loadMore, 'string');
  assert.ok(en.studentPages.notifications.loadMore.trim(), 'English label must not be empty');
  assert.ok(vi.studentPages.notifications.loadMore.trim(), 'Vietnamese label must not be empty');
});

test('student page dynamic templates preserve the previous visible output', () => {
  const { en, vi } = loadMessages();
  const date = new Date('2026-11-01T12:00:00.000Z');
  const dateVi = new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).format(date);
  const dateEn = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).format(date);

  assert.equal(dateVi, date.toLocaleDateString('vi-VN'));
  assert.equal(dateEn, date.toLocaleDateString('en-US'));
  assert.equal(dateVi, '1/11/2026');
  assert.equal(dateEn, '11/1/2026');
  assert.equal(render(vi.studentPages.transcript.yearSemesterLabel, { year: 2026, semester: 1 }), 'Năm 2026 · HK 1');
  assert.equal(render(en.studentPages.transcript.yearSemesterLabel, { year: 2026, semester: 1 }), 'Year 2026 · Semester 1');
  assert.equal(render(vi.studentPages.transcript.print.generatedOn, { date: dateVi }), 'Bảng điểm được hệ thống tạo ngày 1/11/2026');
  assert.equal(render(en.studentPages.transcript.print.generatedOn, { date: dateEn }), 'Transcript generated by the system on 11/1/2026');
  assert.equal(vi.studentPages.transcript.programEmptyDescription, 'Danh sách môn học theo chương trình đào tạo sẽ hiển thị tại đây.');
  assert.equal(en.studentPages.transcript.programEmptyDescription, 'Courses from your study program will appear here.');
  assert.equal(vi.studentPages.transcript.print.systemName, 'CampusUTE');
  assert.equal(en.studentPages.transcript.print.systemName, 'CampusUTE');
  assert.equal(render(vi.studentPages.schedule.description, { semesterName: 'Học kỳ 1' }), 'Thời khóa biểu học tập của sinh viên trong Học kỳ 1.');
  assert.equal(render(en.studentPages.schedule.description, { semesterName: 'Học kỳ 1' }), 'Keep the weekly class agenda for Học kỳ 1 visible while the rest of the student area stays one click away.');
  assert.equal(render(vi.studentPages.schedule.ics.calendarName, { semesterName: 'Fall 2026' }), 'Lịch học - Fall 2026');
  assert.equal(render(en.studentPages.schedule.ics.calendarName, { semesterName: 'Fall 2026' }), 'Schedule - Fall 2026');
  assert.equal(render(vi.studentPages.conduct.activitiesCount, { count: 5 }), '5 hoạt động');
  assert.equal(render(en.studentPages.conduct.activitiesCount, { count: 5 }), '5 records');
});

test('student print and export copy matches the previous output except approved wording', () => {
  const { en, vi } = loadMessages();
  const transcriptPrint = {
    en: {
      ministry: 'MINISTRY OF EDUCATION AND TRAINING — HCMC UNIVERSITY OF TECHNOLOGY AND ENGINEERING',
      office: 'ACADEMIC AFFAIRS OFFICE — CAMPUSUTE CREDIT SYSTEM',
      title: 'OFFICIAL CUMULATIVE ACADEMIC TRANSCRIPT',
      subtitle: '(Undergraduate Full-time Credit Program)',
      fullName: 'Full Name:', studentId: 'Student ID:', major: 'Major:', selectedTerm: 'Selected Term:',
      conversionTitle: '10-point → letter → 4.0 scale conversion',
      conversionDescription: 'Letter grades follow the UTE / MOET credit conversion table.',
      tenPointScale: '10-point scale', letterGrade: 'Letter grade', fourPointScale: '4.0 scale',
      failingNote: 'F (<4.0): not earned — the course must be retaken.',
      creditScaleNote: 'Credit-scale conversion note (UTE / MOET):',
      letterGradesLabel: 'Letter grades: ',
      letterGradesFailure: '. F (< 4.0): not earned — the course must be retaken.',
      preparedBy: 'PREPARED BY', signatureHint: '(Sign and print full name)',
    },
    vi: {
      ministry: 'BỘ GIÁO DỤC VÀ ĐÀO TẠO — TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM',
      office: 'PHÒNG ĐÀO TẠO — HỆ THỐNG QUẢN LÝ ĐÀO TẠO TÍN CHỈ CAMPUSUTE',
      title: 'BẢNG ĐIỂM TỔNG HỢP KẾT QUẢ HỌC TẬP TÍCH LŨY',
      subtitle: '(Dành cho sinh viên trình độ Đại học hệ Chính quy theo học chế tín chỉ)',
      fullName: 'Họ và tên:', studentId: 'Mã số SV:', major: 'Ngành đào tạo:', selectedTerm: 'Học kỳ in:',
      conversionTitle: 'Quy đổi thang điểm 10 → điểm chữ → thang điểm 4',
      conversionDescription: 'Thang điểm chữ theo quy đổi tín chỉ UTE / Bộ GD&ĐT.',
      tenPointScale: 'Thang điểm 10', letterGrade: 'Điểm chữ', fourPointScale: 'Thang điểm 4',
      failingNote: 'F (<4.0): chưa tích lũy, phải học lại.',
      creditScaleNote: 'Ghi chú quy đổi thang điểm tín chỉ UTE / Bộ GD&ĐT:',
      letterGradesLabel: 'Thang điểm chữ: ',
      letterGradesFailure: '. F (< 4.0): chưa tích lũy, phải học lại.',
      preparedBy: 'NGƯỜI LẬP BẢNG ĐIỂM', signatureHint: '(Ký và ghi rõ họ tên)',
    },
  };
  const conductPrint = {
    en: {
      institution: 'Ho Chi Minh City University of Technology and Engineering',
      office: 'Student Affairs Office • CampusUTE',
      printTitle: 'Student Conduct Evaluation Report',
      exportReport: 'Export conduct report',
      previewTitle: 'Activity record — unofficial preview',
      previewNote: 'This is an on-screen preview of a recorded activity, not an issued certificate. Official confirmation letters are issued by the Student Affairs Office.',
      classOfficers: 'Class officers', facultySignature: 'Faculty / Student Affairs',
      signHint: 'Signature and full name', sealHint: 'Signature, seal, and full name',
      certificateTitle: 'CONDUCT ACTIVITY RECORD (PREVIEW)',
      certificateSubtitle: 'Recorded evidence entry — not an issued certificate',
      confirmedStudent: 'Confirmed student:', studentId: 'Student ID:', classLabel: 'Class:',
      activityLabel: 'Activity:', fieldLabel: 'Field:', recordedDate: 'Recorded date:',
      organizerLabel: 'Organizer:', bonusConductPoints: 'Bonus conduct points:',
      printCertificate: 'Print record', close: 'Close', studentLabel: 'Student',
    },
    vi: {
      institution: 'TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM',
      office: 'PHÒNG CÔNG TÁC SINH VIÊN • CAMPUSUTE',
      printTitle: 'PHIẾU ĐÁNH GIÁ KẾT QUẢ RÈN LUYỆN SINH VIÊN',
      exportReport: 'Xuất phiếu rèn luyện',
      previewTitle: 'Hồ sơ hoạt động — bản xem trước',
      previewNote: 'Đây là bản xem trước của hoạt động đã ghi nhận, không phải chứng nhận được cấp. Giấy xác nhận chính thức do Phòng Công tác Sinh viên phát hành.',
      classOfficers: 'BAN CÁN SỰ LỚP', facultySignature: 'TRƯỞNG KHOA / BAN CTSV',
      signHint: 'Ký và ghi rõ họ tên', sealHint: 'Ký, đóng dấu và ghi rõ họ tên',
      certificateTitle: 'HỒ SƠ HOẠT ĐỘNG RÈN LUYỆN (BẢN XEM TRƯỚC)',
      certificateSubtitle: 'Bản ghi minh chứng đã lưu — không phải chứng nhận được cấp',
      confirmedStudent: 'Sinh viên xác nhận:', studentId: 'Mã số sinh viên:', classLabel: 'Lớp:',
      activityLabel: 'Hoạt động:', fieldLabel: 'Lĩnh vực:', recordedDate: 'Ngày ghi nhận:',
      organizerLabel: 'Đơn vị tổ chức:', bonusConductPoints: 'Điểm cộng rèn luyện:',
      printCertificate: 'In bản ghi', close: 'Đóng', studentLabel: 'Sinh viên',
    },
  };

  for (const [key, value] of Object.entries(transcriptPrint.en)) {
    assert.equal(en.studentPages.transcript.print[key], value, `English transcript print ${key}`);
  }
  for (const [key, value] of Object.entries(transcriptPrint.vi)) {
    assert.equal(vi.studentPages.transcript.print[key], value, `Vietnamese transcript print ${key}`);
  }
  for (const [key, value] of Object.entries(conductPrint.en)) {
    assert.equal(en.studentPages.conduct[key], value, `English conduct print ${key}`);
  }
  for (const [key, value] of Object.entries(conductPrint.vi)) {
    assert.equal(vi.studentPages.conduct[key], value, `Vietnamese conduct print ${key}`);
  }

  assert.equal(en.studentPages.conduct.requirement, 'Minimum 70 points');
  assert.equal(vi.studentPages.conduct.requirement, 'Yêu cầu tối thiểu 70 điểm');
  assert.equal(en.studentPages.schedule.print, 'Print Schedule');
  assert.equal(vi.studentPages.schedule.print, 'In thời khóa biểu');
  assert.equal(en.studentPages.schedule.ics.filenamePrefix, 'schedule-');
  assert.equal(vi.studentPages.schedule.ics.filenamePrefix, 'lich-hoc-');
  assert.equal(en.studentPages.schedule.creditsAbbreviation, 'TC');
  assert.equal(vi.studentPages.schedule.creditsAbbreviation, 'TC');
  assert.equal(en.studentPages.schedule.ics.semesterNameFallback, 'CampusUTE');
  assert.equal(vi.studentPages.schedule.ics.semesterNameFallback, 'CampusUTE');
  assert.equal(en.studentPages.ics.defaultCalendarName, 'CampusUTE Timetable');
  assert.equal(vi.studentPages.ics.defaultCalendarName, 'CampusUTE Timetable');
  assert.equal(en.studentPages.announcements.banner.campusPortal, 'HCMUTE Campus Portal');
  assert.equal(vi.studentPages.announcements.banner.campusPortal, 'HCMUTE Campus Portal');
  assert.equal(en.studentPages.schedule.courseCodeFallback, 'Course');
  assert.equal(vi.studentPages.schedule.courseCodeFallback, 'Course');
  assert.equal(en.studentPages.schedule.courseNameFallback, 'Unavailable');
  assert.equal(vi.studentPages.schedule.courseNameFallback, 'Unavailable');
});

test('student page consumers read the central catalog and contain no extracted literal copy', () => {
  const pages = [
    ['src/app/dashboard/transcript/page.tsx', 'transcript', [
      'Transcript data could not be loaded.',
      'OFFICIAL CUMULATIVE ACADEMIC TRANSCRIPT',
      'new Date().toLocaleDateString(',
    ]],
    ['src/app/dashboard/announcements/page.tsx', 'announcements', [
      'Campus News & Academic Notices',
      'HCMUTE OFFICIAL NOTIFICATION CENTER',
      'HCMUTE Campus Banner',
      'HCMUTE Campus Portal',
    ]],
    ['src/app/dashboard/schedule/page.tsx', 'schedule', [
      'Weekly timetable grid',
      'DAY_LABELS_VI',
      'lich-hoc-',
      '>TC</span>',
      "|| 'CampusUTE'",
      "?? 'Course'",
      "?? 'Unavailable'",
    ]],
    ['src/app/dashboard/conduct/page.tsx', 'conduct', [
      'const conductCopy =',
      'Yêu cầu tối thiểu 70đ',
    ]],
  ];

  for (const [relativePath, namespace, removed] of pages) {
    const source = read(relativePath);
    assert.match(source, new RegExp(`messages\\.studentPages\\.${namespace}`), `${relativePath} must read its fragment`);
    assert.doesNotMatch(source, /const copy\s*=\s*\n\s*locale\s*===/);
    for (const literal of removed) assert.equal(source.includes(literal), false, `${relativePath} retains ${literal}`);
  }

  const helper = read('src/lib/ical-generator.ts');
  assert.match(helper, /getMessages\(locale\)\.studentPages\.ics/);
  for (const literal of ['Môn học:', 'Course:', 'Lớp học phần:', 'Section:', 'Phòng ', 'Room ']) {
    assert.equal(helper.includes(literal), false, `iCalendar helper retains ${literal}`);
  }
});
