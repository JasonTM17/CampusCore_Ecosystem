const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadModule(relativePath, aliases = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const resolve = (specifier) =>
    Object.hasOwn(aliases, specifier) ? aliases[specifier] : require(specifier);
  new Function('module', 'exports', 'require', js)(mod, mod.exports, resolve);
  return mod.exports;
}

const messageFragments = [
  ['@/i18n/messages-thesis-workflow', 'src/i18n/messages-thesis-workflow.ts'],
  ['@/i18n/messages-dean-overview', 'src/i18n/messages-dean-overview.ts'],
  ['@/i18n/messages-content', 'src/i18n/messages-content.ts'],
  ['@/i18n/messages-attendance-geofence', 'src/i18n/messages-attendance-geofence.ts'],
  ['@/i18n/messages-teaching-pages', 'src/i18n/messages-teaching-pages.ts'],
  ['@/i18n/messages-admin-pages', 'src/i18n/messages-admin-pages.ts'],
  ['@/i18n/messages-student-pages', 'src/i18n/messages-student-pages.ts'],
];

function loadMessages() {
  const aliases = { '@/i18n/config': {} };
  for (const [specifier, relativePath] of messageFragments) {
    aliases[specifier] = loadModule(relativePath);
  }
  return loadModule('src/i18n/messages.ts', aliases);
}

const attendanceExport = loadModule('src/lib/attendance-export.ts', {
  '@/i18n/messages': loadMessages(),
});

const { escapeCsvField, generateAttendanceCsv } = attendanceExport;

test('Lecturer attendance sheet CSV and print export integrity', async (t) => {
  await t.test('attendance-export exposes the production CSV helpers', () => {
    assert.equal(typeof escapeCsvField, 'function', 'must export escapeCsvField');
    assert.equal(typeof generateAttendanceCsv, 'function', 'must export generateAttendanceCsv');
    assert.equal(typeof attendanceExport.downloadCsvFile, 'function', 'must export downloadCsvFile');
  });

  await t.test('escapeCsvField escapes strings with commas, quotes, and newlines', () => {
    assert.equal(escapeCsvField('Nguyen Van A'), '"Nguyen Van A"');
    assert.equal(escapeCsvField('A, B and C'), '"A, B and C"');
    assert.equal(escapeCsvField('He said "Hello"'), '"He said ""Hello"""');
    assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
    assert.equal(escapeCsvField(123), '"123"');
    assert.equal(escapeCsvField(null), '""');
    assert.equal(escapeCsvField(undefined), '""');
  });

  await t.test('escapeCsvField neutralizes spreadsheet formula cells', () => {
    assert.equal(escapeCsvField('=1+1'), '"\'=1+1"');
    assert.equal(escapeCsvField('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
    assert.equal(escapeCsvField('-10'), '"\'-10"');
    assert.equal(escapeCsvField('@mention'), '"\'@mention"');
    assert.equal(escapeCsvField('\t=1+1'), '"\'\t=1+1"');
    // Only the leading character is prefixed; ordinary text is untouched.
    assert.equal(escapeCsvField('safe text'), '"safe text"');
  });

  await t.test('generateAttendanceCsv outputs UTF-8 BOM and correct metadata and student rows', () => {
    const csv = generateAttendanceCsv({
      sectionNumber: 'SEC-01',
      courseCode: 'CS101',
      courseName: 'Intro to Programming',
      date: '2026-08-25',
      lecturerName: 'Nguyen Van A',
      semesterName: 'HK1 2026-2027',
      metrics: { total: 2, present: 1, absent: 1, late: 0, excused: 0, rate: 50 },
      students: [
        { studentId: 's1', studentCode: 'S001', studentName: '+SUM(A1:A2)', status: 'PRESENT', notes: '=1+1' },
        { studentId: 's2', studentCode: 'S002', studentName: 'Nguyen Van A', status: null, notes: 'a"b' },
      ],
    });

    assert.ok(csv.startsWith('\uFEFF'), 'must include UTF-8 BOM prefix for Excel');
    assert.ok(csv.includes('\r\n'), 'RFC 4180 rows use CRLF');
    assert.ok(
      csv.includes('"STT","Mã sinh viên","Họ và tên","Trạng thái điểm danh","Ghi chú"'),
      'roster header comes from the Vietnamese catalogue',
    );
    assert.ok(
      csv.includes('"1","S001","\'+SUM(A1:A2)","Có mặt","\'=1+1"'),
      'formula-like student names and notes are neutralized',
    );
    assert.ok(
      csv.includes('"2","S002","Nguyen Van A","Chưa điểm danh","a""b"'),
      'an unmarked student and doubled quotes export correctly',
    );
    assert.ok(csv.includes('"Tỷ lệ chuyên cần:","50.0%"'), 'rate uses one decimal');
    assert.ok(csv.includes('"Giảng viên phụ trách:","Nguyen Van A"'), 'lecturer metadata is exported');

    const english = generateAttendanceCsv({
      sectionNumber: 'SEC-01',
      date: '2026-08-25',
      metrics: { total: 0, present: 0, absent: 0, late: 0, excused: 0, rate: 0 },
      students: [],
      locale: 'en',
    });
    assert.ok(
      english.includes('"No.","Student ID","Full Name","Attendance Status","Notes"'),
      'the requested locale selects the roster header',
    );
    assert.equal(
      english.slice(1).split('\r\n')[0],
      '"HO CHI MINH CITY UNIVERSITY OF TECHNOLOGY AND ENGINEERING — CAMPUSUTE"',
    );
  });
});
