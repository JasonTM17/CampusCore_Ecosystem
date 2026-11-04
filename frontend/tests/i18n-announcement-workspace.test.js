const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadFragment() {
  const output = ts.transpileModule(read('src/i18n/messages-announcements.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, require);
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

function assertMessageParity(en, vi, prefix = '') {
  if (Array.isArray(en)) {
    assert.equal(Array.isArray(vi), true, `${prefix} must be an array in both locales`);
    assert.equal(en.length, vi.length, `${prefix} array lengths must match`);
    en.forEach((value, index) => assertMessageParity(value, vi[index], `${prefix}[${index}]`));
    return;
  }
  if (en !== null && typeof en === 'object') {
    assert.equal(
      vi !== null && typeof vi === 'object' && !Array.isArray(vi),
      true,
      `${prefix} must be an object in both locales`,
    );
    const enKeys = Object.keys(en).sort();
    const viKeys = Object.keys(vi).sort();
    assert.deepEqual(enKeys, viKeys, `${prefix} keys must match`);
    for (const key of enKeys) {
      assertMessageParity(en[key], vi[key], prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  assert.equal(typeof en, 'string', `${prefix} must be a string`);
  assert.equal(typeof vi, 'string', `${prefix} must be a string`);
  assert.notEqual(en.trim(), '', `${prefix} English copy must not be empty`);
  assert.notEqual(vi.trim(), '', `${prefix} Vietnamese copy must not be empty`);
  const tokens = (value) => [...value.matchAll(/\{([A-Za-z][\w]*)\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(tokens(en), tokens(vi), `${prefix} placeholder tokens must match`);
}

const VI_DIACRITIC =
  /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;

/**
 * One deliberate exception: the VI-content badge is a bilingual accessibility
 * label by design (it marks Vietnamese body content on the English surface),
 * and the binding rule for this package is to keep the exact aria/title text.
 */
const BILINGUAL_BY_DESIGN = new Set(['badge.title']);

function leaves(value, prefix = '') {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, value]];
}

test('announcementWorkspace has identical EN/VI key trees', () => {
  const { announcementWorkspaceEn, announcementWorkspaceVi } = loadFragment();
  assert.ok(announcementWorkspaceEn, 'announcementWorkspaceEn must be exported');
  assert.ok(announcementWorkspaceVi, 'announcementWorkspaceVi must be exported');
  assert.deepEqual(
    keyPaths(announcementWorkspaceEn),
    keyPaths(announcementWorkspaceVi),
    'EN and VI key paths must match',
  );
  assertMessageParity(announcementWorkspaceEn, announcementWorkspaceVi, 'announcementWorkspace');
});

test('announcementWorkspace keeps the W15 namespace skeleton', () => {
  const { announcementWorkspaceEn } = loadFragment();
  for (const group of [
    'presentation',
    'covers',
    'composer',
    'composer.lecturer',
    'templates.body',
    'lecturer',
    'reader.toolbar',
    'reader.toc',
    'reader.related',
    'reader.attachments',
    'reader.progress',
    'reader.dispatch',
    'reader.magazine',
    'feed',
    'badge',
    'limits',
  ]) {
    assert.equal(
      keyPaths(announcementWorkspaceEn, 'announcementWorkspace').some((key) =>
        key.startsWith(`announcementWorkspace.${group}`),
      ),
      true,
      `announcementWorkspace.${group} must exist`,
    );
  }
});

test('EN values carry no Vietnamese diacritics and VI values are not English sentences', () => {
  const { announcementWorkspaceEn, announcementWorkspaceVi } = loadFragment();

  for (const [keyPath, value] of leaves(announcementWorkspaceEn)) {
    if (BILINGUAL_BY_DESIGN.has(keyPath)) continue;
    assert.doesNotMatch(
      value,
      VI_DIACRITIC,
      `EN copy at ${keyPath} must not contain Vietnamese text: ${value}`,
    );
  }

  for (const [keyPath, value] of leaves(announcementWorkspaceVi)) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length < 3) continue;
    assert.match(
      value,
      VI_DIACRITIC,
      `VI copy at ${keyPath} looks like untranslated English: ${value}`,
    );
  }
});

test('article taxonomy stays single-sourced from INSTITUTIONAL_ARTICLE_CATEGORIES', () => {
  const fragment = read('src/i18n/messages-announcements.ts');

  // No second taxonomy: the reader labels live in the presentation module.
  assert.doesNotMatch(fragment, /\btaxonomy\b/);
  for (const duplicatedLabel of [
    'Research & Technology',
    'Nghiên cứu & Công nghệ',
    'Student Life & Youth',
    'Đời sống Sinh viên',
    'Career & Industry',
    'Cơ hội Việc làm',
  ]) {
    assert.equal(
      fragment.includes(duplicatedLabel),
      false,
      `the fragment must not re-declare the ${duplicatedLabel} taxonomy label`,
    );
  }

  const presenter = read('src/lib/announcement-presentation.ts');
  assert.match(presenter, /INSTITUTIONAL_ARTICLE_CATEGORIES/);
  assert.match(presenter, /export function articleCategoryLabel\(/);
  assert.match(presenter, /locale === 'vi' \? meta\.nameVi : meta\.nameEn/);
});

// ---------------------------------------------------------------------------
// The converted surfaces read the fragment directly (it is not root-mounted
// yet) and no longer own the copy they used to interpolate inline.
// ---------------------------------------------------------------------------

const CONVERTED = [
  'src/components/announcements/AnnouncementEditModal.tsx',
  'src/components/announcements/LecturerAnnouncementCreateModal.tsx',
  'src/components/announcements/AnnouncementReaderModal.tsx',
  'src/components/announcements/ViContentBadge.tsx',
  'src/components/announcements/feed/AnnouncementFeedCard.tsx',
  'src/components/announcements/reader/ReadingToolbar.tsx',
  'src/components/announcements/reader/TableOfContents.tsx',
  'src/components/announcements/reader/RelatedAnnouncements.tsx',
  'src/components/announcements/reader/DocumentAttachmentsList.tsx',
  'src/components/announcements/reader/ReadingProgressBar.tsx',
  'src/components/announcements/reader/layouts/AdministrativeDispatchSheet.tsx',
  'src/components/announcements/reader/layouts/EditorialArticleMagazine.tsx',
  'src/app/dashboard/lecturer/announcements/page.tsx',
  'src/lib/announcement-limits.ts',
];

// The reader modal delegates its progress label to ReadingProgressBar, which
// reads the catalogue itself, so the modal has no direct fragment import.
const FRAGMENT_CONSUMERS = CONVERTED.filter(
  (file) => file !== 'src/components/announcements/AnnouncementReaderModal.tsx',
);

test('converted surfaces import the announcementWorkspace fragment directly', () => {
  for (const file of FRAGMENT_CONSUMERS) {
    const source = read(file);
    assert.match(
      source,
      /from '@\/i18n\/messages-announcements'/,
      `${file} must import the announcement workspace fragment`,
    );
    assert.doesNotMatch(
      source,
      /messages\.announcementWorkspace/,
      `${file} must not depend on the fragment being root-mounted`,
    );
  }
});

test('converted surfaces no longer own inline locale copy pairs', () => {
  for (const file of CONVERTED) {
    const source = read(file);
    // announcement-limits keeps a `locale === 'vi' ? 'vi-VN' : 'en-US'` branch
    // for number formatting only; its copy pair was removed (covered below).
    if (file !== 'src/lib/announcement-limits.ts') {
      assert.doesNotMatch(
        source,
        /locale\s*===\s*'vi'\s*\?/,
        `${file} still branches on locale for inline copy`,
      );
    }
    assert.doesNotMatch(
      source,
      /\bisVi\s*\?\s*'/,
      `${file} still owns an inline isVi string pair`,
    );
  }
});

test('the moved strings are gone from the components and present in the catalogue', () => {
  const fragment = read('src/i18n/messages-announcements.ts');
  const cases = [
    [
      'src/components/announcements/AnnouncementEditModal.tsx',
      [
        'Vui lòng nhập tiêu đề thông báo / công văn',
        'Quick edit via Admin Announcements',
        'Editorial Cover Image (HCMUTE Collection):',
        'Save Changes',
        'Khuôn viên học thuật HCMUTE',
      ],
    ],
    [
      'src/components/announcements/LecturerAnnouncementCreateModal.tsx',
      [
        'Vui lòng nhập nội dung thông báo',
        'Select quick academic template:',
        'Notice Title *',
        'Kính gửi các bạn sinh viên lớp học phần,',
      ],
    ],
    [
      'src/components/announcements/feed/AnnouncementFeedCard.tsx',
      ['Bài viết tiêu điểm', 'Read article', 'Copy link'],
    ],
    [
      'src/components/announcements/reader/ReadingToolbar.tsx',
      ['Giao diện Báo chí Học thuật', 'Decrease font size', 'Đã chép!', 'Close reader (Esc)'],
    ],
    [
      'src/components/announcements/reader/TableOfContents.tsx',
      ['Mục lục bài viết', 'Table of Contents'],
    ],
    [
      'src/components/announcements/reader/RelatedAnnouncements.tsx',
      ['Bài viết liên quan & Đáng chú ý'],
    ],
    [
      'src/components/announcements/reader/DocumentAttachmentsList.tsx',
      ['Tệp đính kèm chính thức', 'Digital document'],
    ],
    [
      'src/components/announcements/reader/ReadingProgressBar.tsx',
      ['Tiến trình đọc bài viết'],
    ],
    [
      'src/components/announcements/AnnouncementReaderModal.tsx',
      ['Tiến trình đọc bài viết', 'Reading progress'],
    ],
    [
      'src/components/announcements/reader/layouts/AdministrativeDispatchSheet.tsx',
      [
        'BỘ GIÁO DỤC VÀ ĐÀO TẠO',
        'MINISTRY OF EDUCATION AND TRAINING',
        'Published electronically on the Campus Portal',
      ],
    ],
    [
      'src/components/announcements/reader/layouts/EditorialArticleMagazine.tsx',
      [
        'Trường Đại học Công nghệ Kỹ thuật TP.HCM',
        'Ho Chi Minh City University of Technology and Engineering',
        'Tiêu điểm',
      ],
    ],
    [
      'src/components/announcements/ViContentBadge.tsx',
      ['Bài viết bằng tiếng Việt / Article in Vietnamese'],
    ],
    [
      'src/app/dashboard/lecturer/announcements/page.tsx',
      [
        'Cổng Giảng viên',
        'Teaching & Research Notices',
        '🌐 Thông báo toàn trường',
        'Archive this notice?',
      ],
    ],
    [
      'src/lib/announcement-limits.ts',
      ['Nội dung vượt quá giới hạn', 'The content exceeds the'],
    ],
  ];

  for (const [file, literals] of cases) {
    const source = read(file);
    for (const literal of literals) {
      assert.equal(source.includes(literal), false, `${file} still owns "${literal}"`);
      assert.equal(
        fragment.includes(literal),
        true,
        `messages-announcements.ts is missing "${literal}"`,
      );
    }
  }
});

test('presentation helpers keep their explicit-locale signatures and read the catalogue', () => {
  const source = read('src/lib/announcement-presentation.ts');

  for (const signature of [
    /announcementPriorityLabel\(value: unknown, locale: Locale\)/,
    /announcementRoleLabel\(value: unknown, locale: Locale\)/,
    /announcementAudienceLabel\(\s*announcement: Pick<AnnouncementRecord, 'isGlobal' \| 'targetRoles'>,\s*locale: Locale,/,
    /announcementHistoryActionLabel\(value: unknown, locale: Locale\)/,
    /announcementHistoryReason\(\s*value: unknown,\s*action: unknown,\s*locale: Locale,/,
    /formatAnnouncementSemester\(\s*announcement: Pick<AnnouncementRecord, 'semesterName' \| 'semester'>,\s*locale: Locale,/,
    /announcementAudienceBadge\(\s*announcement: Pick<AnnouncementRecord, 'isGlobal' \| 'targetRoles'>,\s*locale: Locale,/,
    /announcementSalutation\(\s*announcement: Pick<AnnouncementRecord, 'isGlobal' \| 'targetRoles'>,\s*locale: Locale,/,
    /calculateReadingTime\(\s*content: string \| null \| undefined,\s*locale: Locale = 'vi',/,
    /formatRelativeTime\(\s*dateString: string \| null \| undefined,\s*locale: Locale = 'vi',/,
  ]) {
    assert.match(source, signature, `presentation signature changed: ${signature}`);
  }

  assert.doesNotMatch(source, /useI18n|useState|useEffect/, 'lib must stay hook-free');
  for (const literal of [
    "'Khác'",
    "'Đối tượng khác'",
    "'Đã thay đổi'",
    "'Khởi tạo thông báo'",
    "'Toàn trường'",
    "'Chưa chọn đối tượng'",
    "'Đặt thứ tự hiển thị thành",
    "'Học kỳ'",
    "'Vừa xong'",
    "'Hôm qua'",
    'phút đọc',
    'Khoa Công nghệ Thông tin & Phòng Đào Tạo',
    '🌐 Thông báo toàn trường',
  ]) {
    assert.equal(
      source.includes(literal),
      false,
      `presentation still owns the localised literal ${literal}`,
    );
  }
  assert.doesNotMatch(source, /localizedPair|priorityLabels|roleLabels|historyActionLabels/);
});
