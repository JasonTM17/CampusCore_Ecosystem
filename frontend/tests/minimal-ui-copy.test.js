const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

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
  for (const [specifier, relativePath] of [
    ['@/i18n/messages-thesis-workflow', 'src/i18n/messages-thesis-workflow.ts'],
    ['@/i18n/messages-dean-overview', 'src/i18n/messages-dean-overview.ts'],
    ['@/i18n/messages-content', 'src/i18n/messages-content.ts'],
    ['@/i18n/messages-attendance-geofence', 'src/i18n/messages-attendance-geofence.ts'],
    ['@/i18n/messages-teaching-pages', 'src/i18n/messages-teaching-pages.ts'],
    ['@/i18n/messages-admin-pages', 'src/i18n/messages-admin-pages.ts'],
    ['@/i18n/messages-student-pages', 'src/i18n/messages-student-pages.ts'],
  ]) {
    aliases[specifier] = loadModule(relativePath);
  }
  return loadModule('src/i18n/messages.ts', aliases);
}

test('portal login descriptions are concise summaries', () => {
  const messages = loadMessages();
  const en = messages.getMessages('en');
  const vi = messages.getMessages('vi');
  assert.equal(vi.login.portals.student.description, 'Đăng ký học phần, lịch học và điểm số.');
  assert.equal(en.login.portals.student.description, 'Course registration, timetable, and grades.');
});

test('student dashboard title uses concise name placeholder and page header drops redundant description', () => {
  const messages = loadMessages();
  const en = messages.getMessages('en');
  const vi = messages.getMessages('vi');
  assert.equal(vi.studentDashboard.title, '{name}');
  assert.equal(en.studentDashboard.title, '{name}');
  const page = read('src/app/dashboard/page.tsx');
  assert.doesNotMatch(page, /description=\{copy\.description\}/);
});

test('student schedule page header omits redundant description', () => {
  const page = read('src/app/dashboard/schedule/page.tsx');
  assert.doesNotMatch(page, /description=\{scheduleMessages\.description/);
  const { studentPagesEn, studentPagesVi } = loadModule('src/i18n/messages-student-pages.ts');
  assert.equal(studentPagesVi.schedule.description, undefined);
  assert.equal(studentPagesEn.schedule.description, undefined);
});

test('student schedule table provides tooltip title for lecturer names', () => {
  const page = read('src/app/dashboard/schedule/page.tsx');
  assert.match(page, /title=\{item\.lecturerName \|\| undefined\}/);
});

test('attendance checkin landing copy uses standard campus phrasing without unlocalized loanword', () => {
  const { attendanceGeofenceVi } = loadModule('src/i18n/messages-attendance-geofence.ts');
  assert.doesNotMatch(attendanceGeofenceVi.landing.body, /tại campus/);
  assert.match(attendanceGeofenceVi.landing.body, /trong khuôn viên trường/);
});

test('lecturer geofence checkin panel omits redundant open hint', () => {
  const panel = read('src/components/lecturer/GeofenceCheckinPanel.tsx');
  assert.doesNotMatch(panel, /description=\{copy\.openHint\}/);
  const { attendanceGeofenceEn, attendanceGeofenceVi } = loadModule('src/i18n/messages-attendance-geofence.ts');
  assert.equal(attendanceGeofenceVi.lecturer.openHint, undefined);
  assert.equal(attendanceGeofenceEn.lecturer.openHint, undefined);
});

test('course registration policy accordion keeps button header concise and avoids layout overflow', () => {
  const page = read('src/app/dashboard/register/page.tsx');
  const buttonHeaderStart = page.indexOf('<button');
  const buttonHeaderEnd = page.indexOf('</button>', buttonHeaderStart);
  const buttonContent = page.slice(buttonHeaderStart, buttonHeaderEnd);
  assert.doesNotMatch(buttonContent, /copy\.limitPolicyDescription/);
  assert.match(page, /\{policyOpen \? \(\s*<CardContent[^>]*>[\s\S]*?copy\.limitPolicyDescription/);
});

test('course registration application placeholder uses neutral institutional register', () => {
  const messages = loadMessages();
  const vi = messages.getMessages('vi');
  assert.doesNotMatch(vi.courseRegistration.applicationReasonPlaceholder, /Ví dụ:\s*Em\b/);
  assert.match(vi.courseRegistration.applicationReasonPlaceholder, /Ví dụ:\s*Cần\b/);
});

test('student grades page header omits redundant description', () => {
  const page = read('src/app/dashboard/grades/page.tsx');
  assert.doesNotMatch(page, /description=\{copy\.description/);
  const { studentPortalEn, studentPortalVi } = loadModule('src/i18n/messages-student-portal.ts');
  assert.equal(studentPortalVi.grades.description, undefined);
  assert.equal(studentPortalEn.grades.description, undefined);
});

test('profile page omits redundant photo upload hint', () => {
  const page = read('src/app/dashboard/profile/page.tsx');
  assert.doesNotMatch(page, /messages\.profile\.photoHint/);
  const messages = loadMessages();
  const vi = messages.getMessages('vi');
  const en = messages.getMessages('en');
  assert.equal(vi.profile.photoHint, undefined);
  assert.equal(en.profile.photoHint, undefined);
});

test('empty notifications popover message stays concise without editorial commentary', () => {
  const messages = loadMessages();
  const vi = messages.getMessages('vi');
  const en = messages.getMessages('en');
  assert.doesNotMatch(vi.dashboardShell.notifications.empty, /Thông báo vẫn là kênh chính/);
  assert.doesNotMatch(en.dashboardShell.notifications.empty, /Announcements remain the main broadcast channel/);
  assert.equal(vi.dashboardShell.notifications.empty, 'Không có thông báo mới.');
  assert.equal(en.dashboardShell.notifications.empty, 'No unread notifications.');
});

test('admin shell demo tag remains compact without redundant marketing tagline', () => {
  const messages = loadMessages();
  const vi = messages.getMessages('vi');
  const en = messages.getMessages('en');
  assert.equal(vi.adminShell.demoTag, 'Demo');
  assert.equal(en.adminShell.demoTag, 'Demo');
});

test('announcement editor hero labels omit parenthetical English jargon', () => {
  const messages = loadMessages();
  const vi = messages.getMessages('vi');
  assert.equal(vi.editor.heroTitleLabel, 'Tiêu đề chính');
  assert.equal(vi.editor.heroDescriptionLabel, 'Đoạn giới thiệu');
  assert.equal(vi.editor.heroAccentLabel, 'Màu sắc điểm nhấn');
});

test('thesis group approval error omits raw backend state enums', () => {
  const messages = loadMessages();
  const vi = messages.getMessages('vi');
  assert.doesNotMatch(vi.thesis.groupStateConflict, /\(PENDING\)/);
  assert.equal(vi.thesis.groupStateConflict, 'Chỉ nhóm đang chờ xét duyệt và đã đăng ký đề tài mới có thể được duyệt.');
});

test('thesis workflow stepper guide omits parenthetical English UI verbs', () => {
  const { thesisWorkflowVi } = loadModule('src/i18n/messages-thesis-workflow.ts');
  const stage2 = thesisWorkflowVi.stepper.stages[2];
  assert.doesNotMatch(stage2.actions[2], /\(Approve\)/);
  assert.doesNotMatch(stage2.actions[2], /\(Reject/);
  assert.equal(stage2.actions[2], 'Mỗi nhóm chỉ đăng ký đúng 1 đề tài; Giảng viên hướng dẫn sẽ xét duyệt hoặc từ chối kèm lý do.');
});

test('admin announcement composer placeholder is concise and omits formatting capability list', () => {
  const { adminPagesVi } = loadModule('src/i18n/messages-admin-pages.ts');
  assert.doesNotMatch(adminPagesVi.announcements.tinyMcePlaceholder, /\(hỗ trợ bảng biểu/);
  assert.equal(adminPagesVi.announcements.tinyMcePlaceholder, 'Soạn thảo nội dung thông báo...');
});

test('student profile demo account badge is compact without redundant tagline', () => {
  const { studentPortalVi } = loadModule('src/i18n/messages-student-portal.ts');
  assert.equal(studentPortalVi.profile.demoAccountShort, 'Tài khoản demo');
});
