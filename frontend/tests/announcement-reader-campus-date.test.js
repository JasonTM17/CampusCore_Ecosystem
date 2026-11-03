const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const MAGAZINE = 'src/components/announcements/reader/layouts/EditorialArticleMagazine.tsx';
const DISPATCH = 'src/components/announcements/reader/layouts/AdministrativeDispatchSheet.tsx';
const ZONES = ['America/New_York', 'UTC'];
const originalZone = process.env.TZ;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function inZone(zone, run) {
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = originalZone;
  }
}

function loadTs(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier) ? stubs[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const attendance = loadTs('src/lib/attendance-checkin.ts');

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const dummyComponent = function DummyComponent() {
  return null;
};
const lucideStub = new Proxy(
  {},
  { get: (_target, prop) => (prop === '__esModule' ? true : dummyComponent) },
);
const utilsStub = { cn: (...values) => values.filter(Boolean).join(' ') };
const configStub = { localeCodes: { vi: 'vi-VN', en: 'en-US' } };
const messagesStub = {
  getMessages: () => ({ meta: { emblemAlt: 'University emblem' } }),
};
const workspace = loadTs('src/i18n/messages-announcements.ts');

const presentationStub = {
  announcementAudienceBadge: () => ({ label: 'Toàn trường' }),
  announcementSalutation: () => 'Toàn thể sinh viên',
  announcementSectionLabel: () => '',
  calculateReadingTime: () => ({ displayText: '1 phút' }),
  extractAnnouncementExcerpt: () => '',
  extractCoverImage: () => null,
  extractCoverImageDetails: () => null,
  formatAnnouncementPublisher: () => 'HCMUTE',
  formatAnnouncementSemester: () => '',
  formatRelativeTime: () => 'vừa xong',
  isVietnameseText: () => false,
  resolveAnnouncementDomain: () => ({
    categoryLabel: 'Thông báo',
    categoryTone: 'info',
    iconType: 'book',
    accentGradient: '',
  }),
  resolveArticleCover: () => null,
  stripFirstCoverImage: (content) => content,
};

const commonStubs = {
  '@/lib/utils': utilsStub,
  '@/lib/attendance-checkin': attendance,
  'lucide-react': lucideStub,
  'next/image': { __esModule: true, default: dummyComponent },
  '@/lib/api': {},
  '@/i18n/config': configStub,
  '@/i18n/messages': messagesStub,
  '@/components/ui/rich-content-renderer': { RichContentRenderer: dummyComponent },
  '../DocumentAttachmentsList': { DocumentAttachmentsList: dummyComponent },
  '../TableOfContents': { TableOfContents: dummyComponent },
  '@/i18n/messages-announcements': workspace,
};

function campusFormatDate(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
    ...options,
  }).format(date);
}

function loadMagazine() {
  return loadTs(MAGAZINE, {
    ...commonStubs,
    '@/lib/announcement-presentation': presentationStub,
    '@/lib/use-article-taxonomy': { useArticleTaxonomy: () => ({ categories: [], isLoading: false }) },
    '@/components/announcements/ViContentBadge': { ViContentBadge: dummyComponent },
    '../RelatedAnnouncements': { RelatedAnnouncements: dummyComponent },
  });
}

function loadDispatch() {
  return loadTs(DISPATCH, {
    ...commonStubs,
    '@/i18n': {
      useI18n: () => ({
        formatDate: campusFormatDate,
        formatDateTime: campusFormatDate,
      }),
    },
    '@/lib/announcement-presentation': presentationStub,
  });
}

const announcement = {
  id: 'notice-1',
  title: 'Thông báo họp hội đồng',
  content: '<p>Nội dung thông báo.</p>',
  priority: 'NORMAL',
  // 00:30 on 3 November in campus time; still 2 November in New York.
  publishAt: '2026-11-03T00:30:00+07:00',
  createdAt: '2026-11-03T00:30:00+07:00',
  publishedBy: 'HCMUTE',
  isGlobal: true,
};

const preferences = { mode: 'EDITORIAL', theme: 'light', fontFamily: 'sans', fontSize: 'base' };

test('the magazine heading prints the campus day, not the device day', () => {
  const { EditorialArticleMagazine } = loadMagazine();
  for (const zone of ZONES) {
    inZone(zone, () => {
      const markup = renderToStaticMarkup(React.createElement(EditorialArticleMagazine, {
        announcement,
        preferences,
        locale: 'en',
      }));
      assert.match(markup, /November 3, 2026/, `${zone} magazine heading`);
      assert.doesNotMatch(markup, /November 2, 2026/, `${zone} device-day heading`);
    });
  }
});

test('the dispatch prose date matches its own official date stamp', () => {
  const { AdministrativeDispatchSheet } = loadDispatch();
  for (const zone of ZONES) {
    inZone(zone, () => {
      const markup = renderToStaticMarkup(React.createElement(AdministrativeDispatchSheet, {
        announcement,
        preferences,
        locale: 'vi',
      }));
      assert.match(markup, /03\/11\/2026/, `${zone} official date`);
      assert.match(markup, /3 tháng 11 năm 2026/, `${zone} prose date`);
      assert.doesNotMatch(markup, /2 tháng 11 năm 2026/, `${zone} device-day prose`);
    });
  }
});
