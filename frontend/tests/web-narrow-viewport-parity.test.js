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

test('layout reserves bottom clearance token for mobile bottom nav and floating assistant', () => {
  const globals = read('src/app/globals.css');
  const dashboardLayout = read('src/app/dashboard/layout.tsx');
  const adminFrame = read('src/components/admin/AdminFrame.tsx');

  assert.match(
    globals,
    /--portal-bottom-clearance:\s*calc\(10\.5rem\s*\+\s*env\(safe-area-inset-bottom\)\)/,
    'globals.css must define --portal-bottom-clearance accounting for bottom nav and floating assistant',
  );
  assert.match(
    globals,
    /@media\s*\(min-width:\s*768px\)\s*\{\s*:root\s*\{\s*--portal-bottom-clearance:\s*7rem;/,
    'globals.css must reset --portal-bottom-clearance to 7rem at md breakpoint',
  );
  assert.match(
    dashboardLayout,
    /var\(--portal-bottom-clearance/,
    'dashboard layout must use --portal-bottom-clearance for page bottom padding',
  );
  assert.match(
    adminFrame,
    /var\(--portal-bottom-clearance/,
    'admin frame must use --portal-bottom-clearance for page bottom padding',
  );
});

test('input primitives ellipsize placeholder and long text at narrow widths', () => {
  const inputSource = read('src/components/ui/input.tsx');
  assert.match(
    inputSource,
    /placeholder:truncate/,
    'Input must declare placeholder:truncate to avoid abrupt character clipping',
  );
  assert.match(
    inputSource,
    /\btruncate\b/,
    'Input must declare truncate to ellipsize overflowing text value',
  );
});

test('thesis repository and announcement placeholders remain concise in both locales', () => {
  const thesisFragment = loadModule('src/i18n/messages-thesis-workflow.ts');
  const announcementsFragment = loadModule('src/i18n/messages-announcements.ts');

  const thesisEn = thesisFragment.thesisWorkflowEn.page.repositorySearchPlaceholder;
  const thesisVi = thesisFragment.thesisWorkflowVi.page.repositorySearchPlaceholder;
  assert.ok(thesisEn && thesisEn.length <= 50, `thesis EN placeholder too long: ${thesisEn} (${thesisEn?.length})`);
  assert.ok(thesisVi && thesisVi.length <= 50, `thesis VI placeholder too long: ${thesisVi} (${thesisVi?.length})`);

  const announceEn = announcementsFragment.announcementWorkspaceEn.lecturer.searchPlaceholder;
  const announceVi = announcementsFragment.announcementWorkspaceVi.lecturer.searchPlaceholder;
  assert.ok(announceEn && announceEn.length <= 40, `announcements EN placeholder too long: ${announceEn} (${announceEn?.length})`);
  assert.ok(announceVi && announceVi.length <= 40, `announcements VI placeholder too long: ${announceVi} (${announceVi?.length})`);
});

test('dashboard register page preserves vertical spacing between cards and filter inputs', () => {
  const registerPage = read('src/app/dashboard/register/page.tsx');
  assert.match(
    registerPage,
    /grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-12/,
    'register catalog grid must maintain gap-6 vertical spacing between policy card and search card',
  );
  assert.match(
    registerPage,
    /className="space-y-6"/,
    'register catalog panel must preserve space-y-6 container rhythm',
  );
});

test('header bell panel and notifications center strip transport prefix and end truncated preview with ellipsis', () => {
  const dashboardLayout = read('src/app/dashboard/layout.tsx');
  const notificationsCenter = read('src/components/dashboard/NotificationsCenterPage.tsx');
  const utils = loadModule('src/lib/utils.ts');

  assert.match(
    dashboardLayout,
    /stripNotificationTagPrefix\(notification\.title/,
    'dashboard bell panel must use stripNotificationTagPrefix for titles',
  );
  assert.match(
    dashboardLayout,
    /notificationPreview\(notification\.content\)/,
    'dashboard bell panel must use plain text preview helper for contents',
  );
  assert.match(
    notificationsCenter,
    /stripNotificationTagPrefix\(item\.title/,
    'notifications center must use stripNotificationTagPrefix for titles',
  );
  assert.match(
    notificationsCenter,
    /htmlToPlainText\(item\.content/,
    'notifications center must use htmlToPlainText for contents',
  );

  assert.equal(
    utils.stripNotificationTagPrefix('[Announcement] Important update'),
    'Important update',
  );
  assert.equal(
    utils.stripNotificationTagPrefix('[Thông báo] Cập nhật lịch học'),
    'Cập nhật lịch học',
  );
  assert.equal(
    utils.stripNotificationTagPrefix('[THÔNG BÁO] Cập nhật phòng thi'),
    'Cập nhật phòng thi',
  );

  const longText = 'A'.repeat(250);
  const truncated = utils.htmlToPlainText(longText, 50);
  assert.ok(truncated.endsWith('…'), 'truncated message preview must end with ellipsis');
  assert.equal(truncated.length, 51);
});
