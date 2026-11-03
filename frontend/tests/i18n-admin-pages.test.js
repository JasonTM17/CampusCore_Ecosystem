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

function assertMessageParity(en, vi, prefix = '') {
  if (Array.isArray(en)) {
    assert.equal(Array.isArray(vi), true, `${prefix} must be an array in both locales`);
    assert.equal(en.length, vi.length, `${prefix} array lengths must match`);
    en.forEach((value, index) => assertMessageParity(value, vi[index], `${prefix}[${index}]`));
    return;
  }
  if (en !== null && typeof en === 'object') {
    assert.equal(vi !== null && typeof vi === 'object' && !Array.isArray(vi), true, `${prefix} must be an object in both locales`);
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
  const tokens = (value) => [...value.matchAll(/\{([A-Za-z][\w]*)\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(tokens(en), tokens(vi), `${prefix} placeholder tokens must match`);
}

function renderTemplate(template, values) {
  return Object.entries(values).reduce(
    (rendered, [key, value]) => rendered.replace(`{${key}}`, () => String(value)),
    template,
  );
}

test('adminPages fragment is mounted', () => {
  const { en, vi } = loadMessages();
  assert.equal(Object.hasOwn(en, 'adminPages'), true);
  assert.equal(Object.hasOwn(vi, 'adminPages'), true);
  assert.deepEqual(keyPaths(en.adminPages), keyPaths(vi.adminPages));
});

test('adminPages locales have matching non-empty copy, arrays, keys, and placeholders', () => {
  const { en, vi } = loadMessages();
  assertMessageParity(en.adminPages, vi.adminPages, 'adminPages');
});

test('admin page templates render the exact previous Vietnamese and English output', () => {
  const { en, vi } = loadMessages();
  const viCopy = vi.adminPages;
  const enCopy = en.adminPages;
  const userStatusVi = vi.common.statuses.INACTIVE;
  const userStatusEn = en.common.statuses.INACTIVE;

  assert.deepEqual(viCopy.sections.weekdayLabels, [
    'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật',
  ]);
  assert.deepEqual(enCopy.sections.weekdayLabels, [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ]);
  // The page maps the catalogue order to the old ISO day values:
  // index 0..6 -> 2,3,4,5,6,7,1 (Monday..Sunday, Sunday = 1).
  assert.deepEqual(
    viCopy.sections.weekdayLabels.map((_, index) => String(((index + 1) % 7) + 1)),
    ['2', '3', '4', '5', '6', '7', '1'],
  );

  const cases = [
    {
      vi: viCopy.users.deleteMessage,
      en: enCopy.users.deleteMessage,
      values: { lastName: 'Nguyen', firstName: 'An' },
      expectedVi: 'Xóa Nguyen An? Hành động này sẽ gỡ bản ghi tài khoản khỏi màn hình quản trị hiện tại.',
      expectedEn: 'Delete Nguyen An? This action removes the account record from the current admin view.',
    },
    {
      vi: viCopy.users.resetMessage,
      en: enCopy.users.resetMessage,
      values: { lastName: 'Nguyen', firstName: 'An' },
      expectedVi: 'Cấp lại mật khẩu tạm thời cho Nguyen An? Mật khẩu hiện tại sẽ vô hiệu và mọi phiên đăng nhập của người dùng bị đăng xuất.',
      expectedEn: 'Re-issue a temporary credential for Nguyen An? The current password is invalidated and every session signs out.',
    },
    {
      vi: viCopy.users.resetInactiveWarning,
      en: enCopy.users.resetInactiveWarning,
      valuesVi: { status: userStatusVi },
      valuesEn: { status: userStatusEn },
      expectedVi: 'Tài khoản đang ở trạng thái Tạm dừng — phải kích hoạt lại tài khoản thì mật khẩu tạm thời mới đăng nhập được.',
      expectedEn: 'This account is currently Inactive — re-activate it before the temporary credential can sign in.',
    },
    {
      vi: viCopy.users.editUserLabel,
      en: enCopy.users.editUserLabel,
      values: { lastName: 'Nguyen', firstName: 'An' },
      expectedVi: 'Chỉnh sửa người dùng Nguyen An',
      expectedEn: 'Edit user Nguyen An',
    },
    {
      vi: viCopy.users.deleteUserLabel,
      en: enCopy.users.deleteUserLabel,
      values: { lastName: 'Nguyen', firstName: 'An' },
      expectedVi: 'Xóa người dùng Nguyen An',
      expectedEn: 'Delete user Nguyen An',
    },
    {
      vi: viCopy.users.filterAll,
      en: enCopy.users.filterAll,
      values: { count: 42 },
      expectedVi: 'Tất cả (42)',
      expectedEn: 'All (42)',
    },
    {
      vi: viCopy.users.pageSummary,
      en: enCopy.users.pageSummary,
      values: { page: 2, pages: 7 },
      expectedVi: 'Trang 2 / 7',
      expectedEn: 'Page 2 of 7',
    },
    {
      vi: viCopy.sections.pageSummary,
      en: enCopy.sections.pageSummary,
      values: { currentPage: 2, pages: 7 },
      expectedVi: 'Trang 2 / 7',
      expectedEn: 'Page 2 of 7',
    },
    {
      vi: viCopy.sections.deleteMessage,
      en: enCopy.sections.deleteMessage,
      values: { sectionNumber: 'SEC-01', courseCode: 'CS101' },
      expectedVi: 'Xóa lớp học phần SEC-01 của CS101?',
      expectedEn: 'Delete section SEC-01 for CS101?',
    },
    {
      vi: viCopy.sections.dayFallback,
      en: enCopy.sections.dayFallback,
      values: { day: 8 },
      expectedVi: 'Thứ 8',
      expectedEn: 'Day 8',
    },
    {
      vi: viCopy.sections.removeSchedule,
      en: enCopy.sections.removeSchedule,
      values: { index: 3 },
      expectedVi: 'Xóa lịch 3',
      expectedEn: 'Remove schedule 3',
    },
    {
      vi: viCopy.sections.editLabel,
      en: enCopy.sections.editLabel,
      values: { sectionNumber: 'SEC-01', courseCode: 'CS101' },
      expectedVi: 'Chỉnh sửa lớp học phần SEC-01 của CS101',
      expectedEn: 'Edit section SEC-01 for CS101',
    },
    {
      vi: viCopy.sections.deleteLabel,
      en: enCopy.sections.deleteLabel,
      values: { sectionNumber: 'SEC-01', courseCode: 'CS101' },
      expectedVi: 'Xóa lớp học phần SEC-01 của CS101',
      expectedEn: 'Delete section SEC-01 for CS101',
    },
    {
      vi: viCopy.sections.scheduleLabel,
      en: enCopy.sections.scheduleLabel,
      values: { index: 3 },
      expectedVi: 'Lịch 3',
      expectedEn: 'Meeting 3',
    },
    {
      vi: viCopy.announcements.contentTooLong,
      en: enCopy.announcements.contentTooLong,
      valuesVi: { limit: '1.200', excess: '25' },
      valuesEn: { limit: '1,200', excess: '25' },
      expectedVi: 'Nội dung vượt quá giới hạn 1.200 ký tự (cần bỏ bớt 25 ký tự). Hãy rút gọn văn bản hoặc bỏ bớt hình ảnh trước khi lưu.',
      expectedEn: 'The content exceeds the 1,200 character limit by 25 characters. Shorten the text or remove an image before saving.',
    },
    {
      vi: viCopy.announcements.page,
      en: enCopy.announcements.page,
      values: { current: 2, total: 7 },
      expectedVi: 'Trang 2 / 7',
      expectedEn: 'Page 2 of 7',
    },
  ];

  for (const item of cases) {
    const viValues = item.valuesVi ?? item.values;
    const enValues = item.valuesEn ?? item.values;
    assert.equal(renderTemplate(item.vi, viValues), item.expectedVi);
    assert.equal(renderTemplate(item.en, enValues), item.expectedEn);
  }

  assert.equal(
    renderTemplate(viCopy.announcements.contentTooLong, {
      limit: new Intl.NumberFormat('vi-VN').format(1200),
      excess: new Intl.NumberFormat('vi-VN').format(25),
    }),
    'Nội dung vượt quá giới hạn 1.200 ký tự (cần bỏ bớt 25 ký tự). Hãy rút gọn văn bản hoặc bỏ bớt hình ảnh trước khi lưu.',
  );
  assert.equal(
    renderTemplate(enCopy.announcements.contentTooLong, {
      limit: new Intl.NumberFormat('en-US').format(1200),
      excess: new Intl.NumberFormat('en-US').format(25),
    }),
    'The content exceeds the 1,200 character limit by 25 characters. Shorten the text or remove an image before saving.',
  );
});

test('admin page consumers read adminPages and no longer own localized dictionaries', () => {
  const pages = [
    ['users', 'src/app/admin/users/page.tsx'],
    ['sections', 'src/app/admin/sections/page.tsx'],
    ['announcements', 'src/app/admin/announcements/page.tsx'],
  ];

  for (const [key, file] of pages) {
    const source = read(file);
    assert.match(source, /messages\.adminPages/);
    assert.match(source, new RegExp(`${key}: copy`));
    assert.doesNotMatch(source, /const\s+(copy|conductCopy|text|labels|messages)\s*=/);
    assert.doesNotMatch(source, /locale\s*===\s*['"]vi['"]|\bvi\s*\?/);
    assert.doesNotMatch(source, /\b(?:vi-VN|en-US)\b|toLocale(?:String|DateString|TimeString)?\(/);
  }

  const users = read('src/app/admin/users/page.tsx');
  const sections = read('src/app/admin/sections/page.tsx');
  const announcements = read('src/app/admin/announcements/page.tsx');
  for (const literal of [
    'Loading user management', 'Quản lý người dùng', 'No matching records',
    'Sections unavailable', 'Thứ hai', 'Monday',
    'Manage announcements', 'Quản trị thông báo', 'Recorded by an administrator',
  ]) {
    assert.equal(users.includes(literal), false, `users page retains ${literal}`);
    assert.equal(sections.includes(literal), false, `sections page retains ${literal}`);
    assert.equal(announcements.includes(literal), false, `announcements page retains ${literal}`);
  }
});

test('admin page copy lives in the catalogue, not in the page modules', () => {
  const adminMessages = read('src/i18n/messages-admin-pages.ts');
  const pages = {
    'src/app/admin/users/page.tsx': [
      'Review campus accounts, create new records, and keep sensitive actions behind explicit confirmation.',
      'Rà soát tài khoản campus, tạo bản ghi mới và giữ các hành động nhạy cảm sau bước xác nhận rõ ràng.',
      'Centralized academic account issuance',
      'Chính sách cấp tài khoản học vụ tập trung',
    ],
    'src/app/admin/sections/page.tsx': [
      'Manage class capacity, teaching assignments, and classroom schedules from one consistent workflow.',
      'Quản lý sức chứa, phân công giảng dạy và lịch phòng học trong một quy trình nhất quán.',
      'Sections unavailable',
      'Lớp học phần chưa sẵn sàng',
    ],
    'src/app/admin/announcements/page.tsx': [
      'Edit, schedule, and store announcements with a clear change history.',
      'Chỉnh sửa, lập lịch và lưu trữ thông báo với lịch sử rõ ràng.',
      'Recorded by an administrator',
      'Tài khoản quản trị đã ghi nhận',
    ],
  };

  for (const [file, literals] of Object.entries(pages)) {
    const source = read(file);
    for (const literal of literals) {
      assert.equal(adminMessages.includes(literal), true, `catalogue is missing ${literal}`);
      assert.equal(source.includes(literal), false, `${file} still owns ${literal}`);
    }
  }
});
