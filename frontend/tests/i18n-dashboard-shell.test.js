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

function atPath(value, pathParts) {
  return pathParts.split('.').reduce((current, key) => current?.[key], value);
}

function placeholders(value) {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

function assertCatalogParity(en, vi, pathName) {
  if (Array.isArray(en)) {
    assert.equal(Array.isArray(vi), true, `${pathName} must be an array in both locales`);
    assert.equal(vi.length, en.length, `${pathName} array lengths must match`);
    en.forEach((value, index) => assertCatalogParity(value, vi[index], `${pathName}[${index}]`));
    return;
  }
  if (en !== null && typeof en === 'object') {
    assert.ok(vi !== null && typeof vi === 'object' && !Array.isArray(vi), `${pathName} must exist in Vietnamese`);
    assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort(), `${pathName} keys must match`);
    for (const key of Object.keys(en)) {
      assertCatalogParity(en[key], vi[key], `${pathName}.${key}`);
    }
    return;
  }

  assert.equal(typeof en, 'string', `${pathName} English value must be a string`);
  assert.equal(typeof vi, 'string', `${pathName} Vietnamese value must be a string`);
  assert.notEqual(en.trim(), '', `${pathName} English value must not be empty`);
  assert.notEqual(vi.trim(), '', `${pathName} Vietnamese value must not be empty`);
  assert.deepEqual(placeholders(en), placeholders(vi), `${pathName} placeholder tokens must match`);
}

function leafValues(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => leafValues(child, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      leafValues(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

const p12Paths = [
  'common.notFound',
  'common.theme',
  'common.unsavedChanges',
  'dashboardShell.demoTag',
  'dashboardShell.demoAccount',
  'dashboardShell.notifications.academicAffairsNoticeBoard',
  'adminShell.menuSiteEditor',
  'adminShell.demoTag',
  'meta.manifest',
  'meta.jsonLd',
  'meta.emblemAlt',
  'meta.emblemWatermarkAlt',
  'meta.socialImage',
];

test('P12 root catalogue copy has recursive locale and placeholder parity', () => {
  const { en, vi } = loadMessages();
  for (const pathName of p12Paths) {
    assertCatalogParity(atPath(en, pathName), atPath(vi, pathName), pathName);
  }
});

test('P12 catalogue copy preserves the existing visible wording', () => {
  const { en, vi } = loadMessages();

  assert.deepEqual(
    [vi.adminShell.menuSiteEditor, en.adminShell.menuSiteEditor],
    ['Trình soạn thảo website', 'Site Editor & CMS'],
  );
  assert.deepEqual(
    [vi.dashboardShell.demoTag, en.dashboardShell.demoTag],
    ['TK Demo trải nghiệm', 'Demo account'],
  );
  assert.deepEqual(
    [vi.dashboardShell.demoAccount, en.dashboardShell.demoAccount],
    ['Tài khoản demo để trải nghiệm', 'Demo experience account'],
  );
  assert.deepEqual(
    [vi.dashboardShell.notifications.academicAffairsNoticeBoard, en.dashboardShell.notifications.academicAffairsNoticeBoard],
    ['Bảng tin Phòng Đào tạo', 'Academic Affairs Notice Board'],
  );
  assert.deepEqual(
    [vi.adminShell.demoTag, en.adminShell.demoTag],
    ['Demo trải nghiệm', 'Demo'],
  );
  assert.deepEqual(
    [vi.common.notFound.eyebrow, en.common.notFound.eyebrow],
    ['404 Not Found', '404 Not Found'],
  );
  assert.deepEqual(
    [vi.common.notFound.title, vi.common.notFound.description, vi.common.notFound.recoveryLinks, vi.common.notFound.backHome],
    [
      'Trang không tồn tại',
      'Đường dẫn bạn yêu cầu không tồn tại hoặc đã được chuyển sang vị trí mới.',
      'Liên kết khôi phục',
      'Quay lại trang chủ',
    ],
  );
  assert.deepEqual(
    [en.common.notFound.title, en.common.notFound.description, en.common.notFound.recoveryLinks, en.common.notFound.backHome],
    [
      'Page Not Found',
      'The page you requested does not exist or has been moved.',
      'Recovery links',
      'Back to Home',
    ],
  );
  assert.deepEqual(
    [vi.common.theme.switchToDark, en.common.theme.switchToDark, vi.common.theme.switchToLight, en.common.theme.switchToLight],
    ['Chuyển sang giao diện tối', 'Switch to dark theme', 'Chuyển sang giao diện sáng', 'Switch to light theme'],
  );
  assert.deepEqual(
    [vi.meta.manifest.name, vi.meta.manifest.shortName, vi.meta.manifest.description],
    [
      'CampusUTE - Cổng Thông Tin Đào Tạo & Quản Lý Sinh Viên HCM-UTE',
      'CampusUTE',
      'Cổng thông tin đào tạo và học vụ trực tuyến CampusUTE - Trường Đại học Công nghệ Kỹ thuật TP.HCM.',
    ],
  );
  assert.equal(en.meta.manifest.screenshots.homeEnLabel, 'CampusUTE homepage in English');
  assert.equal(vi.meta.manifest.screenshots.homeViLabel, 'Trang chủ CampusUTE bằng tiếng Việt');
  assert.equal(vi.common.unsavedChanges.beforeUnload, 'Bạn có nội dung chưa được lưu. Rời khỏi trang sẽ mất thay đổi.');
  assert.equal(en.common.unsavedChanges.beforeUnload, 'You have unsaved changes. Leaving this page will discard them.');
});

test('P12 English values have no Vietnamese diacritics and Vietnamese values have no English sentences', () => {
  const { en, vi } = loadMessages();
  const englishSentence = (value) => {
    const words = value.match(/[A-Za-z]{2,}/g) ?? [];
    return (
      words.length >= 4 &&
      !/[\u00C0-\u024F\u1E00-\u1EFF]/u.test(value) &&
      /\b(?:the|your|you|is|are|to|of|and|for|with|from|this|that|does)\b/i.test(value)
    );
  };

  for (const pathName of p12Paths) {
    for (const [key, value] of leafValues(atPath(en, pathName), pathName)) {
      assert.doesNotMatch(value, /[\u00C0-\u024F\u1E00-\u1EFF]/u, `${key} English copy must not contain Vietnamese diacritics`);
    }
    for (const [key, value] of leafValues(atPath(vi, pathName), pathName)) {
      assert.equal(englishSentence(value), false, `${key} Vietnamese copy must not be an ASCII-only English sentence`);
    }
  }
});

test('converted P12 components no longer contain their inline bilingual literals', () => {
  const removedLiterals = [
    ['src/app/dashboard/layout.tsx', [
      'Trình soạn thảo website', 'Site Editor & CMS',
      'TK Demo trải nghiệm', 'Demo account',
      'Bảng tin Phòng Đào tạo', 'Academic Affairs Notice Board',
      'Demo trải nghiệm',
      'Tài khoản demo để trải nghiệm', 'Demo experience account',
    ]],
    ['src/app/not-found.tsx', [
      '404 Not Found', 'Trang không tồn tại', 'Page Not Found',
      'Đường dẫn bạn yêu cầu không tồn tại hoặc đã được chuyển sang vị trí mới.',
      'The page you requested does not exist or has been moved.',
      'Liên kết khôi phục', 'Recovery links', 'Quay lại trang chủ', 'Back to Home',
    ]],
    ['src/components/ThemeToggle.tsx', [
      'Chuyển sang giao diện tối', 'Switch to dark theme',
      'Chuyển sang giao diện sáng', 'Switch to light theme',
    ]],
    ['src/app/manifest.ts', [
      'CampusUTE - Cổng Thông Tin Đào Tạo & Quản Lý Sinh Viên HCM-UTE',
      'Cổng thông tin đào tạo và học vụ trực tuyến CampusUTE - Trường Đại học Công nghệ Kỹ thuật TP.HCM.',
      'CampusUTE homepage in English', 'Trang chủ CampusUTE bằng tiếng Việt',
    ]],
    ['src/components/seo/JsonLd.tsx', [
      'Trường Đại học Công nghệ Kỹ thuật TP.HCM',
      'Ho Chi Minh City University of Technology and Engineering',
      'Cổng thông tin đào tạo và học vụ trực tuyến CampusUTE - Trường Đại học Công nghệ Kỹ thuật TP.HCM.',
      'CampusUTE online academic portal of Ho Chi Minh City University of Technology and Engineering.',
    ]],
    ['src/components/announcements/feed/AnnouncementFeedCard.tsx', ['HCMUTE Emblem Watermark']],
    ['src/components/announcements/reader/layouts/AdministrativeDispatchSheet.tsx', ['HCMUTE Emblem']],
    ['src/components/announcements/reader/layouts/EditorialArticleMagazine.tsx', ['HCMUTE Emblem']],
  ];

  for (const [relativePath, literals] of removedLiterals) {
    const source = read(relativePath);
    for (const literal of literals) {
      assert.equal(source.includes(literal), false, `${relativePath} must read ${literal} from the catalogue`);
    }
  }
});

test('S4 unsaved-change defaults and S8 social-image copy stay catalogue-driven', () => {
  const guard = read('src/lib/use-unsaved-changes-guard.ts');
  assert.match(guard, /messages\.common\.unsavedChanges/);
  assert.match(guard, /beforeUnloadMessage \?\? copy\.beforeUnload/);
  assert.match(guard, /confirmTitle \?\? copy\.title/);
  assert.match(guard, /confirmBody \?\? copy\.body/);

  const socialCopy = read('src/lib/social-image-copy.ts');
  const openGraph = read('src/app/opengraph-image.tsx');
  assert.match(socialCopy, /getMessages\(resolved\)\.meta\.socialImage/);
  assert.match(openGraph, /getSocialImageCopy\(\)/);
});
