const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadModule(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(
    moduleRecord, moduleRecord.exports, () => ({}),
  );
  return moduleRecord.exports;
}

function assertMessageParity(en, vi, prefix = '') {
  if (en !== null && typeof en === 'object') {
    assert.equal(vi !== null && typeof vi === 'object', true, `${prefix} must be an object in both locales`);
    const enKeys = Object.keys(en).sort();
    const viKeys = Object.keys(vi).sort();
    assert.deepEqual(enKeys, viKeys, `${prefix} keys must match`);
    for (const key of enKeys) assertMessageParity(en[key], vi[key], prefix ? `${prefix}.${key}` : key);
    return;
  }
  assert.equal(typeof en, 'string', `${prefix} must be a string`);
  assert.equal(typeof vi, 'string', `${prefix} must be a string`);
  assert.notEqual(en.trim(), '', `${prefix} English copy must not be empty`);
  assert.notEqual(vi.trim(), '', `${prefix} Vietnamese copy must not be empty`);
  const tokens = (value) => [...String(value).matchAll(/\{([A-Za-z][\w]*)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(tokens(en), tokens(vi), `${prefix} placeholder tokens must match`);
}

function assertLocalePurity(en, vi, prefix = '') {
  if (en !== null && typeof en === 'object') {
    for (const key of Object.keys(en)) assertLocalePurity(en[key], vi && vi[key], prefix ? `${prefix}.${key}` : key);
    return;
  }
  const diacritics = /[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  assert.equal(diacritics.test(en), false, `${prefix} English copy must not contain Vietnamese diacritics`);
  // Short tokens (T2..CN, CTĐT, môn) and known shared technical labels are not
  // English sentences; everything longer must carry Vietnamese diacritics.
  const asciiSentence = /^[ -~]+$/.test(vi) && /[a-z]/i.test(vi) && vi.length > 3;
  assert.equal(asciiSentence, false, `${prefix} Vietnamese copy must not be a bare ASCII English sentence`);
}

const fragment = loadModule('src/i18n/messages-student-portal.ts');
const en = fragment['studentPortalEn'];
const vi = fragment['studentPortalVi'];

test('studentPortal EN/VI parity, placeholders, and locale purity', () => {
  assertMessageParity(en, vi);
  assertLocalePurity(en, vi);
});

test('studentPortal keeps the exact previously inline copy', () => {
  const cases = [
    ['home.stats.courses', 'Môn học kỳ này', 'Courses this term'],
    ['home.shifts.morning', 'Ca Sáng', 'Morning'],
    ['home.tomorrow', 'Ngày mai', 'Tomorrow'],
    ['home.progressStatus', 'Đã đạt {percent}% chỉ tiêu học kỳ', '{percent}% of term credit capacity'],
    ['home.pendingBadge', '{count} đăng ký chờ xử lý', '{count} registrations pending'],
    ['home.roomWithBuilding', 'Phòng {building}-{room}', 'Room {building}-{room}'],
    ['grades.eyebrow', 'Cổng Sinh viên', 'Student area'],
    ['grades.openBreakdown', 'Mở chi tiết điểm cho {courseCode} {courseName}', 'Open grade breakdown for {courseCode} {courseName}'],
    ['grades.tableHeaders.score', 'Điểm HP (10)', 'Total (10)'],
    ['enrollments.title', 'Môn học của tôi', 'My courses'],
    ['enrollments.confirmMessage', 'Hủy {courseLabel}? Hành động này giữ cho việc đổi lịch học luôn rõ ràng và có chủ đích.', 'Drop {courseLabel}? This keeps the action explicit and prevents accidental schedule changes.'],
    ['enrollments.exportSlip', 'Xuất phiếu đăng ký (PDF)', 'Download registration slip (PDF)'],
    ['gradeDetail.title', 'Chi tiết điểm học phần', 'Course Grade Breakdown'],
    ['gradeDetail.formula', 'ĐHP = ĐQT × 50% + ĐCK × 50%', 'Final = Coursework × 50% + Exam × 50%'],
    ['profile.demoAccount', 'Tài khoản demo để trải nghiệm', 'Demo experience account'],
    ['notifications.openRelated', 'Mở tính năng liên quan', 'Open related feature'],
    ['identity.student', 'Vào Cổng Sinh viên', 'Enter Student Portal'],
  ];
  const lookup = (source, keyPath) => keyPath.split('.').reduce((node, key) => node[key], source);
  for (const [keyPath, viText, enText] of cases) {
    assert.equal(lookup(vi, keyPath), viText, `${keyPath} Vietnamese copy changed`);
    assert.equal(lookup(en, keyPath), enText, `${keyPath} English copy changed`);
  }
});

test('converted student-portal sources read the fragment instead of inline locale pairs', () => {
  const files = [
    'src/app/dashboard/page.tsx',
    'src/app/dashboard/grades/page.tsx',
    'src/app/dashboard/enrollments/page.tsx',
    'src/app/dashboard/profile/page.tsx',
    'src/components/dashboard/GradeDetailModal.tsx',
    'src/components/dashboard/NotificationsCenterPage.tsx',
    'src/components/dashboard/StudentUteProfileGradeView.tsx',
    'src/components/home/HomeIdentityBoard.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /@\/i18n\/messages-student-portal/, `${file} must import the studentPortal fragment`);
    // The only allowed `locale === 'vi'` left is the catalogue selection
    // (studentPortalVi : studentPortalEn); a quote, template, or object literal
    // after the `?` means page-local copy survived.
    const inlinePair = source.match(/locale === 'vi'\s*\?\s*[{'"`]/g) || [];
    assert.deepEqual(inlinePair, [], `${file} still owns inline locale copy: ${inlinePair.slice(0, 3).join(' | ')}`);
  }
});

test('moved literals live in the fragment, not in the page modules', () => {
  const catalogue = read('src/i18n/messages-student-portal.ts');
  const pages = {
    'src/app/dashboard/page.tsx': ['Tổng quan thông tin học vụ và tiến độ học kỳ hiện tại.', 'Ca Sáng', 'Chưa có buổi học nào được xếp lịch.'],
    'src/app/dashboard/grades/page.tsx': ['Hiện chưa thể tải dữ liệu điểm số.', 'Điểm HP (10)', 'Chưa có điểm được công bố'],
    'src/app/dashboard/enrollments/page.tsx': ['Theo dõi chương trình đào tạo và các lớp đã đăng ký.', 'Xuất phiếu đăng ký (PDF)', 'Đang tải chương trình đào tạo'],
    'src/app/dashboard/profile/page.tsx': ['Tài khoản demo để trải nghiệm', 'Demo experience account'],
    'src/components/dashboard/GradeDetailModal.tsx': ['Thành phần điểm học phần (50% Quá trình + 50% Cuối kỳ)', 'Điểm quá trình (ĐQT - 50%)'],
    'src/components/dashboard/NotificationsCenterPage.tsx': ['Mở tính năng liên quan', 'Open related feature'],
    'src/components/dashboard/StudentUteProfileGradeView.tsx': ['Tài khoản demo để trải nghiệm', 'Demo account'],
    'src/components/home/HomeIdentityBoard.tsx': ['Vào Cổng Sinh viên', 'Enter Student Portal'],
  };
  for (const [file, literals] of Object.entries(pages)) {
    const source = read(file);
    for (const literal of literals) {
      assert.equal(catalogue.includes(literal), true, `fragment is missing ${literal}`);
      assert.equal(source.includes(literal), false, `${file} still owns ${literal}`);
    }
  }
});

test('wave-17 safe notification links stay on the notifications center', () => {
  const source = read('src/components/dashboard/NotificationsCenterPage.tsx');
  assert.match(source, /import \{ safeInternalPath \} from '@\/lib\/safe-url'/);
  assert.match(source, /const link = safeInternalPath\(notification\.link\)/);
});
