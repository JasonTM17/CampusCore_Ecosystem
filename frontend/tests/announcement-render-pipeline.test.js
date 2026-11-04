const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/**
 * Transpile a DOM-free TS module (a lib) and evaluate it. `stubs` resolves the
 * `@/...` specifiers the module imports at runtime; anything else falls through
 * to this file's own require.
 */
function loadTs(relativePath, stubs = {}) {
  const ts = require('typescript');
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier) ? stubs[specifier] : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

/**
 * Transpile a TSX module whose imports must be redirected: `stubs` maps an
 * import specifier to a module record, anything else goes to Node's require
 * (real `react`, `react-dom/server`, `typescript`).
 */
function loadTsModule(relativePath, stubs) {
  const ts = require('typescript');
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      // The automatic runtime keeps JSX working for pages that (like Next)
      // never import React themselves.
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const stubRequire = (name) => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    return require(name);
  };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, stubRequire);
  return moduleRecord.exports;
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const dummyComponent = function DummyComponent() {
  return null;
};
// Every icon (and the `default` a namespace import may ask for) is the same
// inert component; `__esModule` keeps the interop helper from re-wrapping it.
const lucideStub = new Proxy(
  {},
  { get: (_target, prop) => (prop === '__esModule' ? true : dummyComponent) },
);
const utilsStub = { cn: (...args) => args.filter(Boolean).join(' ') };

const sanitizer = loadTs('src/lib/html-sanitizer.ts');
const attendanceCheckin = loadTs('src/lib/attendance-checkin.ts');
const announcementWorkspace = loadTs('src/i18n/messages-announcements.ts');
const editorSurfaces = loadTs('src/i18n/messages-editor.ts');
const presentation = loadTs('src/lib/announcement-presentation.ts', {
  '@/lib/html-sanitizer': sanitizer,
  '@/lib/api': {},
  '@/i18n/config': {},
  '@/i18n/messages-announcements': announcementWorkspace,
});
const FIXTURE = JSON.parse(read('tests/fixtures/announcement-content-policy.json'));

function rendererStubs() {
  return {
    '@/lib/html-sanitizer': sanitizer,
    '@/lib/attendance-checkin': attendanceCheckin,
    '@/lib/utils': utilsStub,
    'lucide-react': lucideStub,
    // CodeBlock/SafeImage read the active locale for their copy-button and
    // broken-image labels; the harness renders with the Vietnamese default.
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        messages: { common: { states: { dataTable: 'Bảng dữ liệu' } } },
      }),
    },
    '@/i18n/config': { localeCodes: { vi: 'vi-VN', en: 'en-US' } },
    '@/i18n/messages': {
      getMessages: (locale) => ({
        meta: {
          emblemAlt: locale === 'vi' ? 'Biểu trưng HCMUTE' : 'HCMUTE Emblem',
        },
      }),
    },
    '@/i18n/messages-editor': editorSurfaces,
  };
}

function loadRenderer(stubs) {
  return loadTsModule('src/components/ui/rich-content-renderer.tsx', stubs || rendererStubs());
}

function loadToc(renderer) {
  return loadTsModule('src/components/announcements/reader/TableOfContents.tsx', {
    ...rendererStubs(),
    '@/components/ui/rich-content-renderer': renderer,
    '@/i18n/messages-announcements': announcementWorkspace,
  });
}

function renderElement(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props));
}

/** The `.rich-html-content` body of a rendered article, without the wrapper. */
function renderedBodyHtml(content) {
  const renderer = loadRenderer();
  return renderElement(renderer.RichContentRenderer, { content });
}

const HTML_ARTICLE = [
  '<h2>Điều khoản</h2><p>Nội dung một.</p>',
  '<h2>Điều khoản</h2><p>Nội dung hai.</p>',
  '<h3>Phụ lục &amp; biểu mẫu</h3>',
  '<h3><strong>Quy</strong> trình</h3>',
].join('');

test('out-of-range numeric URL references do not abort article rendering', () => {
  const renderer = loadRenderer();

  for (const entity of ['&#1114112;', '&#x110000;']) {
    let rendered;
    assert.doesNotThrow(() => {
      rendered = renderer.renderHtmlDocument(`<p><a href="${entity}">Details</a></p>`);
    }, entity);
    assert.doesNotMatch(rendered, /href=/);
  }
});

// --- (a) contents for HTML bodies -------------------------------------------

test('RT-P3-a an HTML article produces contents entries with de-duplicated anchors', () => {
  const { extractTocHeadings } = loadToc(loadRenderer());

  const headings = extractTocHeadings(HTML_ARTICLE);
  // The slug alphabet is `slugify`'s, which keeps ASCII letters and digits but
  // maps đ/Đ to d first (they have no NFD decomposition); what matters here is
  // that TOC and markup derive the same ids.
  assert.deepEqual(
    headings.map((heading) => [heading.level, heading.id, heading.text]),
    [
      [2, 'dieu-khoan', 'Điều khoản'],
      [2, 'dieu-khoan-2', 'Điều khoản'],
      [3, 'phu-luc-bieu-mau', 'Phụ lục biểu mẫu'],
      [3, 'quy-trinh', 'Quy trình'],
    ],
    'HTML headings must be read, inner markup and character references removed, repeats suffixed',
  );

  // Nothing collides, and the empty/absent cases stay empty.
  assert.equal(new Set(headings.map((h) => h.id)).size, headings.length);
  assert.deepEqual(extractTocHeadings(''), []);
  assert.deepEqual(extractTocHeadings(null), []);
  assert.deepEqual(extractTocHeadings('<p>Không có tiêu đề nào</p>'), []);
});

test('RT-P3-a the rendered HTML branch carries the ids the contents links to', () => {
  const renderer = loadRenderer();
  const { extractTocHeadings } = loadToc(renderer);

  const markup = renderedBodyHtml(HTML_ARTICLE);
  const headings = extractTocHeadings(HTML_ARTICLE);
  assert.ok(headings.length >= 2, 'the fixture must be rich enough to show a contents list');

  for (const heading of headings) {
    const hits = markup.match(new RegExp(`<h[1-6][^>]*\\bid="${heading.id}"`, 'g')) ?? [];
    assert.equal(
      hits.length,
      1,
      `contents anchor "${heading.id}" must exist exactly once in: ${markup}`,
    );
  }
  // The prose itself is untouched by the pass.
  assert.match(markup, /<p>Nội dung một\.<\/p>/);
});

test('RT-P3-a markdown bodies still produce contents and cannot collide either', () => {
  const renderer = loadRenderer();
  const { extractTocHeadings } = loadToc(renderer);

  const markdown = [
    '# Thông báo',
    'body',
    '## Điều khoản',
    '## Điều khoản',
    '##### Phụ lục',
    '```',
    '# không phải tiêu đề',
    '```',
  ].join('\n');

  assert.deepEqual(
    extractTocHeadings(markdown).map((heading) => heading.id),
    ['thong-bao', 'dieu-khoan', 'dieu-khoan-2', 'phu-luc'],
    'a `#` line inside a fenced code block is source text, not a section',
  );

  const markup = renderedBodyHtml(markdown);
  // React puts the class after the id, so match the attribute, not the tag end.
  assert.match(markup, /<h1 id="thong-bao"/);
  assert.match(markup, /<h2 id="dieu-khoan"/);
  assert.match(markup, /<h2 id="dieu-khoan-2"/);
  assert.match(markup, /<h5 id="phu-luc"/);
  assert.equal(markup.includes('id="dieu-khoan-3"'), false);
  // The fenced `#` line stays inside the code block; it must not become a heading.
  assert.equal(markup.includes('id="khong-phai-tieu-de"'), false);
});

test('RT-P3-a anchoring runs after sanitizing so every generated id survives', () => {
  const renderer = loadRenderer();
  const body = '<h2>2025 Tuyển sinh</h2><h2 id="muc-1">Mục 1</h2>';

  // The sanitizer only accepts letter-initial ids, so injecting before it would
  // silently delete the anchor for a numbered heading.
  assert.doesNotMatch(sanitizer.sanitizeAnnouncementHtml('<h2 id="2025-x">y</h2>'), /id=/);

  const markup = renderedBodyHtml(body);
  assert.match(markup, /<h2 id="2025-tuyen-sinh">/);
  // An authored anchor is left alone, and the contents row points at it.
  assert.match(markup, /<h2 id="muc-1">Mục 1<\/h2>/);
  assert.deepEqual(
    renderer.extractArticleHeadingsFromHtml(sanitizer.sanitizeAnnouncementHtml(body)).map((h) => h.id),
    ['2025-tuyen-sinh', 'muc-1'],
  );
});

// --- (f) render-pipeline cost ------------------------------------------------

test('RT-P3-f the HTML render computation is cached on the content string', () => {
  const source = read('src/components/ui/rich-content-renderer.tsx');

  // The sanitizer rebuilds the whole body (up to the 200k-character server cap),
  // and the reader re-renders per scroll frame, so the work must sit behind a
  // memo keyed on `content` and the render path must not bypass it.
  assert.match(
    source,
    /const htmlBody = useMemo\(\(\) => \{[\s\S]*?return renderHtmlDocument\(content\);[\s\S]*?\}, \[content\]\);/,
  );
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{ __html: sanitizeHtml\(/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{ __html: annotateHtmlHeadingIds\(/);
  assert.match(source, /__html: htmlBody \}\}/);

  // Caching is only legal because the computation is pure: same bytes out for
  // the same body, every time.
  const renderer = loadRenderer();
  const first = renderer.renderHtmlDocument(HTML_ARTICLE);
  assert.equal(renderer.renderHtmlDocument(HTML_ARTICLE), first);
  assert.equal(
    first,
    renderer.annotateHtmlHeadingIds(
      renderer.addBannerWebpSources(sanitizer.sanitizeAnnouncementHtml(HTML_ARTICLE)),
    ),
  );
});

test('banner images in HTML readers use WebP with the sized JPEG fallback', () => {
  const renderer = loadRenderer();
  const markup = renderer.renderHtmlDocument(
    '<figure><img src="/images/banners/campus_academic_banner.jpg" alt="Campus" width="1376" height="768"></figure>',
  );

  assert.match(markup, /<picture class="block w-full"><source srcset="\/images\/banners\/campus_academic_banner\.webp" type="image\/webp"><img[^>]*src="\/images\/banners\/campus_academic_banner\.jpg"[^>]*alt="Campus"[^>]*width="1376"[^>]*height="768"[^>]*><\/picture>/);
  assert.doesNotMatch(
    renderer.renderHtmlDocument('<img src="/images/news/story.jpg" alt="Story">'),
    /<picture class="block w-full">/,
  );
});

test('RT-P3-f scroll progress is re-measured when a reading preference reflows the article', () => {
  const source = read('src/components/announcements/AnnouncementReaderModal.tsx');
  const effect = /container\.removeEventListener\('scroll', handleScroll\);[\s\S]*?\}, \[([\s\S]*?)\]\);/.exec(source);
  assert.ok(effect, 'the scroll listener effect must keep its teardown shape');

  // Font size and theme change `scrollHeight`, so the bar has to be recomputed
  // against the new layout instead of keeping the old percentage.
  for (const field of ['preferences.mode', 'preferences.theme', 'preferences.fontSize', 'preferences.fontFamily']) {
    assert.ok(effect[1].includes(field), `the scroll effect must depend on ${field}, saw: ${effect[1]}`);
  }
});

// --- (b) cover de-duplication guard ------------------------------------------

function loadMagazine() {
  return loadTsModule('src/components/announcements/reader/layouts/EditorialArticleMagazine.tsx', {
    ...rendererStubs(),
    'next/image': { __esModule: true, default: dummyComponent },
    '@/lib/announcement-presentation': presentation,
    '@/components/ui/rich-content-renderer': loadRenderer(),
    '@/lib/use-article-taxonomy': { useArticleTaxonomy: () => ({ categories: [], isLoading: false }) },
    '../DocumentAttachmentsList': { DocumentAttachmentsList: dummyComponent },
    '../TableOfContents': { TableOfContents: dummyComponent },
    '../RelatedAnnouncements': { RelatedAnnouncements: dummyComponent },
    '@/components/announcements/ViContentBadge': { ViContentBadge: dummyComponent },
    '@/i18n/messages-announcements': announcementWorkspace,
  });
}

const HERO_MARKER = 'data:image/png;base64,heromarker1234';
const RELATIVE_DIAGRAM = './uploads/sodo.png';

function magazineMarkup(overrides) {
  const magazine = loadMagazine();
  const announcement = {
    id: 'ann-1',
    title: 'Thông báo kế hoạch đào tạo',
    content: `<p>Mở đầu.</p><p><img src="${HERO_MARKER}" alt="Ảnh minh họa"></p><h2>Điều khoản</h2>`,
    priority: 'NORMAL',
    publishAt: '2026-01-05T07:00:00.000Z',
    createdAt: '2026-01-05T07:00:00.000Z',
    publishedBy: null,
    ...overrides,
  };
  return renderElement(magazine.EditorialArticleMagazine, {
    announcement,
    preferences: { mode: 'EDITORIAL', theme: 'light', fontFamily: 'sans', fontSize: 'base' },
    locale: 'vi',
  });
}

function countOccurrences(markup, needle) {
  return markup.split(needle).length - 1;
}

/** The rendered article body, i.e. everything after the hero figure. */
function bodyOf(markup) {
  const start = markup.indexOf('rich-html-content');
  assert.notEqual(start, -1, 'the article body must render');
  return markup.slice(start);
}

test('RT-P3-b the hero picture is shown once, not repeated under the hero', () => {
  const markup = magazineMarkup({});
  assert.equal(countOccurrences(markup, HERO_MARKER), 1, 'the body image became the hero, so the body drops it');
  assert.match(markup, /<h2 id="dieu-khoan"/, 'stripping must not eat the rest of the body');
});

test('RT-P3-b a picture the hero never showed stays in the body', () => {
  // A relative `./` source renders fine for the reader but is invisible to the
  // cover extractors, so the hero fell back to the branded placeholder while the
  // strip deleted the author's only picture — it appeared nowhere.
  const markup = magazineMarkup({
    content: `<p>Mở đầu.</p><p><img src="${RELATIVE_DIAGRAM}" alt="Sơ đồ quy trình"></p><h2>Điều khoản</h2>`,
  });
  assert.match(markup, /<img src="data:image\/svg\+xml,%3Csvg/, 'the branded placeholder is the hero here');
  assert.ok(
    bodyOf(markup).includes(RELATIVE_DIAGRAM),
    `the body must keep ${RELATIVE_DIAGRAM} when it is not the hero`,
  );
});

test('RT-P3-b a strip that would delete the wrong picture is refused', () => {
  // The extractors land on the second image (the first is a relative `./` src),
  // while the strip removes the first one. Losing a picture is worse than
  // showing the hero twice, so the body is kept whole.
  const markup = magazineMarkup({
    content: `<p><img src="${RELATIVE_DIAGRAM}" alt="Ảnh một"></p><p><img src="${HERO_MARKER}" alt="Ảnh hai"></p><h2>Điều khoản</h2>`,
  });
  assert.ok(bodyOf(markup).includes(RELATIVE_DIAGRAM), 'the first picture must not be taken for the hero');
  assert.ok(bodyOf(markup).includes(HERO_MARKER), 'and nothing else may be lost either');
});

test('RT-P3-b an imageless article keeps the branded placeholder hero and its body', () => {
  const markup = renderElement(loadMagazine().EditorialArticleMagazine, {
    announcement: {
      id: 'ann-2',
      title: 'Quy chế đánh giá điểm rèn luyện',
      content: '<p>Không có ảnh trong bài.</p>',
      priority: 'NORMAL',
      publishAt: '2026-01-05T07:00:00.000Z',
      createdAt: '2026-01-05T07:00:00.000Z',
    },
    preferences: { mode: 'EDITORIAL', theme: 'light', fontFamily: 'sans', fontSize: 'base' },
    locale: 'vi',
  });

  assert.match(markup, /<img src="data:image\/svg\+xml,%3Csvg/);
  assert.match(markup, /Không có ảnh trong bài\./);
});

// --- (c) pagebreak ----------------------------------------------------------

test('RT-P3-c the editor offers no page break, which nothing honoured anyway', () => {
  const source = read('src/components/ui/tinymce-editor.tsx');

  const plugins = source.slice(source.indexOf('plugins: ['), source.indexOf('],', source.indexOf('plugins: [')));
  const toolbar = source.slice(source.indexOf('toolbar: ['), source.indexOf('toolbar_mode'));
  const insertMenu = /insert: \{ title: 'Insert', items: '([^']*)' \}/.exec(source);

  assert.ok(plugins.includes("'lists'") && toolbar.includes('codesample') && insertMenu, 'the extraction windows must still find the config');
  for (const [label, region] of [['plugins', plugins], ['toolbar', toolbar], ['insert menu', insertMenu[1]]]) {
    assert.equal(region.includes('pagebreak'), false, `${label} still offers the dead pagebreak control`);
  }
  assert.equal(source.includes("'pagebreak'"), false);
  // The kept plugins stay available.
  assert.ok(plugins.includes("'accordion'") && plugins.includes("'anchor'"));
});

// --- (d) SVG images ---------------------------------------------------------

test('RT-P3-d an inlined SVG really is unpublishable, so the editor must refuse it', () => {
  // Premise of the fix: the sanitizer drops the `src`, leaving a broken image.
  const svgBody = '<p><img src="data:image/svg+xml;base64,PHN2Zy8-" alt="Sơ đồ"></p>';
  const cleaned = sanitizer.sanitizeAnnouncementHtml(svgBody);
  assert.equal(cleaned.includes('src='), false, `svg src survived: ${cleaned}`);
  assert.equal(sanitizer.isSafeAnnouncementImageUrl('data:image/svg+xml;base64,PHN2Zy8='), false);

  const source = read('src/components/ui/tinymce-editor.tsx');
  // Both insert points check the type before any payload is embedded.
  const uploadHandler = source.slice(source.indexOf('images_upload_handler'), source.indexOf('file_picker_callback'));
  const picker = source.slice(source.indexOf('file_picker_callback'), source.indexOf('table_default_attributes'));
  // Both insert points run a positive MIME allowlist before any payload is
  // embedded — the check rejects SVG and every other format the reader
  // sanitizer would strip (AVIF, HEIC, TIFF, …).
  assert.match(uploadHandler, /if \(!INLINE_IMAGE_MIME_TYPES\.has\(blobType\)\) \{\s*\n\s*reject\(blobType\.includes\('svg'\) \? svgRejected : unsupportedImageFormat\);/);
  assert.ok(
    uploadHandler.indexOf('INLINE_IMAGE_MIME_TYPES.has(blobType)') < uploadHandler.indexOf('resolve(`data:'),
    'the MIME allowlist must run before the payload is resolved into the document',
  );
  assert.match(picker, /if \(!INLINE_IMAGE_MIME_TYPES\.has\(file\.type\.toLowerCase\(\)\)\) \{[\s\S]*?toast\.error\(\s*file\.type\.toLowerCase\(\)\.includes\('svg'\) \? svgRejected : unsupportedImageFormat/);
  assert.ok(
    picker.indexOf("INLINE_IMAGE_MIME_TYPES.has(file.type") < picker.indexOf('readAsDataURL'),
    'the MIME allowlist must run before the file is read',
  );

  // The rejection is visible and localized through the directly imported
  // editor fragment, like the size rejection beside it.
  assert.match(source, /const svgRejected = copy\.svgRejected;/);
  const viMessage = editorSurfaces.editorSurfacesVi.tinyMce.svgRejected;
  const enMessage = editorSurfaces.editorSurfacesEn.tinyMce.svgRejected;
  assert.match(viMessage, /SVG/);
  assert.match(enMessage, /SVG/);
  assert.notEqual(viMessage, enMessage, 'the two locales must carry different text');
  assert.ok(
    /toast\.error\([\s\S]*?svgRejected/.test(source.slice(source.indexOf('file_picker_callback'))),
    'the picker path must surface the rejection to the author',
  );
});

test('RT-P3-d the image picker only lists the formats the reader allowlist keeps', () => {
  const source = read('src/components/ui/tinymce-editor.tsx');
  const accept = /input\.setAttribute\('accept', '([^']+)'\)/.exec(source);
  assert.ok(accept, 'the picker must declare an explicit accept list');
  assert.equal(source.includes("'image/*'"), false, 'image/* offered SVG files the sanitizer rejects');

  const allowed = FIXTURE.imageSchemes
    .map((scheme) => /^data:image\/([a-z+]+);base64$/.exec(scheme)?.[1])
    .filter(Boolean)
    .sort();
  const offered = accept[1].split(',').map((type) => type.replace('image/', '')).sort();
  assert.deepEqual(offered, allowed, 'the picker and the read-time image allowlist must agree');
});

// --- (e) reader style parity ------------------------------------------------

/** Declaration bodies of the rules whose selector list contains `selector`. */
function cssRuleBodies(css, selector) {
  const bodies = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    // Strip comments first: the explanatory comment in front of a rule is part
    // of this capture and contains commas.
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

test('RT-P3-e readers style the blocks the editor styles, with tokens only', () => {
  const css = read('src/app/globals.css');
  const parity = css.slice(css.indexOf('/* RT-P3-e'), css.indexOf('@media (prefers-reduced-motion'));
  assert.ok(parity.length > 200, 'the reader parity block must exist');

  for (const selector of [
    '.rich-html-content pre',
    '.rich-html-content code',
    '.rich-html-content pre code',
    '.rich-html-content details',
    '.rich-html-content summary',
    '.rich-html-content mark',
    '.rich-html-content figure',
    '.rich-html-content figcaption',
  ]) {
    assert.equal(cssRuleBodies(parity, selector).length, 1, `missing reader rule for ${selector}`);
  }

  // No raw hex or rgba in the block: every colour is a semantic token, so the
  // same markup reads correctly on the light, sepia and dark reader surfaces.
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(parity), false, 'reader parity rules must not use raw hex');
  assert.equal(parity.includes('rgba('), false, 'reader parity rules must not use raw rgba');
  assert.ok(parity.includes('hsl(var(--muted))'), 'code blocks use the muted surface token');
  assert.ok(parity.includes('hsl(var(--border))'), 'code and accordions keep a token hairline');
  assert.ok(parity.includes('hsl(var(--primary))'), 'the accordion summary reads as an affordance');
});

// --- (f) print --------------------------------------------------------------

test('RT-P3-f printing stops orphaning the article and forces the paper palette', () => {
  const css = read('src/app/globals.css');
  const printBlock = css.slice(css.indexOf('@media print'), css.indexOf('[data-reader-theme] {'));
  assert.ok(printBlock.length > 100, 'the print block must exist');

  const avoidRule = /([^{}]+)\{[^{}]*break-inside:\s*avoid;[^{}]*\}/.exec(printBlock);
  assert.ok(avoidRule, 'a break-inside guard must remain for blocks that fit on a page');
  const selectors = avoidRule[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((selector) => selector.trim())
    .filter(Boolean);
  assert.equal(
    selectors.some((s) => /\barticle\b/.test(s)),
    false,
    `article must not be break-inside: avoid — it pushed a long article to sheet 2: ${selectors.join(' | ')}`,
  );
  for (const kept of ['.card', 'figure', 'h1', 'h2']) {
    assert.ok(selectors.includes(kept), `the guard must stay for ${kept}`);
  }

  // Dark and sepia readers print as paper: the reader token overrides are the
  // light palette, byte for byte, from `.reader-theme-light`.
  const readerTokens = Object.fromEntries(
    [...css.slice(css.indexOf('[data-reader-theme] {')).matchAll(/(--[\w-]+):\s*([^;!]+?)\s*!important/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const lightStart = css.indexOf('.reader-theme-light {');
  const lightBlock = css.slice(lightStart, css.indexOf('}', lightStart));
  const lightTokens = Object.fromEntries(
    [...lightBlock.matchAll(/(--[\w-]+):\s*([^;!]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
  assert.ok(Object.keys(readerTokens).length >= 20, `expected the print reader block to redefine the palette, saw ${Object.keys(readerTokens).length}`);
  const drifted = Object.entries(readerTokens).filter(([token, value]) => lightTokens[token] !== value);
  assert.deepEqual(drifted, [], 'print reader tokens must equal the light reading theme');
  assert.equal(readerTokens['--reader-bg'], '#ffffff');
  assert.equal(lightTokens['--reader-bg'], '#ffffff');

  // A printer drops backgrounds, so the only thing left of a site-dark callout
  // would be its pale text colour. Print pins the light inks instead.
  for (const callout of ['info', 'warning', 'success']) {
    const selector = `[data-reader-theme] .academic-callout-${callout}`;
    const rule = cssRuleBodies(css.slice(css.indexOf('@media print')), selector).join('');
    assert.ok(rule, `the print block must pin the ${callout} callout ink`);
    assert.match(rule, /color:\s*#[0-9a-f]{6}\s*!important/, `print must pin the ${callout} callout ink`);
  }
});

test('RT-P3-a an authored anchor later in the document wins over an earlier generated slug', () => {
  // Adversarial case: the first heading would claim `quy-che` as its generated
  // slug while a later heading authors that exact id. Reserving authored ids in
  // a single forward pass let both end up with the same anchor, so the contents
  // scrolled to the wrong section.
  const { extractTocHeadings } = loadToc(loadRenderer());
  const body =
    '<h2>Quy chế</h2><p>Nội dung một.</p><h2 id="quy-che">Khác</h2><p>Nội dung hai.</p>';

  const headings = extractTocHeadings(body);
  assert.deepEqual(
    headings.map((heading) => heading.id),
    ['quy-che-2', 'quy-che'],
    'the generated slug must step aside for the authored id it would collide with',
  );
  assert.equal(new Set(headings.map((h) => h.id)).size, headings.length);

  const markup = renderedBodyHtml(body);
  for (const heading of headings) {
    const hits = markup.match(new RegExp(`<h[1-6][^>]*\\bid="${heading.id}"`, 'g')) ?? [];
    assert.equal(hits.length, 1, `anchor "${heading.id}" must appear exactly once in: ${markup}`);
  }
});

// Round-2 review: the cover pickers accepted any `data:image/` subtype, so an
// inlined SVG became the cover and then rendered as the broken frame the editor
// refuses to insert. The cover must satisfy the same allow-list as the body.
test('a cover is only taken from a source the reader allow-list keeps', () => {
  const svg = '<img src="data:image/svg+xml;base64,PHN2Zy8+"/ alt="logo">';
  assert.equal(presentation.extractCoverImage(svg), null, 'svg data uri must not become a cover');
  assert.equal(presentation.extractCoverImageDetails(svg), null);
  assert.equal(
    presentation.extractCoverImageDetails(
      '<figure><img src="data:image/svg+xml;base64,PHN2Zy8+"/><figcaption>hình</figcaption></figure>',
    ),
    null,
    'the figure branch is held to the same rule',
  );

  const png = '<p>lead</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="anh">';
  assert.equal(
    presentation.extractCoverImage(png),
    'data:image/png;base64,iVBORw0KGgo=',
    'an editor-inlined raster upload still becomes the cover',
  );
  assert.equal(
    presentation.extractCoverImage(
      '<p>a</p><img src="data:image/svg+xml;base64,PHN2Zy8+"><img src="https://x.test/y.png">',
    ),
    'https://x.test/y.png',
    'an unsafe first image is skipped for the next usable one',
  );
});

test('the cover keeps the author alt text while skipping an unusable image', () => {
  const details = presentation.extractCoverImageDetails(
    '<p>a</p><img src="data:image/svg+xml;base64,PHN2Zy8+" alt="logo svg"><img src="https://cdn.test/x.png" alt="Hội thảo">',
  );
  assert.equal(details?.url, 'https://cdn.test/x.png');
  assert.equal(details?.alt, 'Hội thảo', 'the usable candidate carries its own alt');
});

test('markdown tables name their columns and carry an accessible caption', () => {
  const markup = renderedBodyHtml('| Mức | Học phần |\n| --- | --- |\n| 1 | Toán |');

  assert.equal(
    (markup.match(/<th[^>]*scope="col"/g) ?? []).length,
    2,
    `every markdown header cell must declare its scope: ${markup}`,
  );
  assert.match(markup, /<caption[^>]*>Bảng dữ liệu<\/caption>/);
});

test('the warning category pill keeps AA contrast on the light reader canvas', () => {
  const magazine = read('src/components/announcements/reader/layouts/EditorialArticleMagazine.tsx');

  assert.match(magazine, /categoryTone === 'warning' && 'bg-amber-500\/10 text-amber-800 /);
  assert.doesNotMatch(magazine, /text-amber-600/);
});

test('feed cards expose one stretched title action instead of a nested button role', () => {
  const feedCard = read('src/components/announcements/feed/AnnouncementFeedCard.tsx');

  assert.doesNotMatch(feedCard, /<article\s+onClick=/);
  assert.equal((feedCard.match(/onClick=\{onClick\}/g) ?? []).length, 2);
  assert.equal(
    (feedCard.match(/after:absolute after:inset-0/g) ?? []).length,
    2,
    'both title buttons stretch their hit area across the card',
  );
  assert.match(feedCard, /group relative flex flex-col justify-between overflow-hidden rounded-xl/);
  assert.equal(
    (feedCard.match(/className="relative z-10 inline-flex h-8 w-8/g) ?? []).length,
    2,
    'share controls stay above the stretched title action',
  );
});

test('reader mode toggles expose their pressed state', () => {
  const toolbar = read('src/components/announcements/reader/ReadingToolbar.tsx');

  assert.equal(
    (toolbar.match(/aria-pressed=\{preferences\.mode === '(EDITORIAL|OFFICIAL)'\}/g) ?? []).length,
    2,
  );
});

test('table of contents scrolling respects prefers-reduced-motion', () => {
  const toc = read('src/components/announcements/reader/TableOfContents.tsx');

  assert.match(toc, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(toc, /behavior: reduceMotion \? 'auto' : 'smooth'/);
  assert.doesNotMatch(toc, /behavior: 'smooth'/);
});

// --- public permalink -------------------------------------------------------

const PUBLIC_NEWS_COPY = {
  backToList: 'Back to news',
  notFoundTitle: 'Story unavailable',
  notFoundBody: 'This story is not available.',
  loadErrorTitle: 'News feed unavailable',
  loadError: 'Could not load this story.',
  title: 'News',
  publishedOn: 'Published {date}',
};

/**
 * The anonymous permalink is a client page, so it is rendered with its route,
 * data, chrome and i18n dependencies stubbed; the body renderer stays the real
 * one, because the point of this test is which pipeline the page uses.
 */
function loadPublicNewsDetail(item) {
  return loadTsModule('src/app/news/[id]/news-detail-client.tsx', {
    'next/navigation': { useParams: () => ({ id: encodeURIComponent(item.id) }) },
    '@/lib/api': { announcementsApi: { getPublicById: async () => item } },
    '@/components/content/PublicChrome': {
      PublicChrome: ({ children }) => React.createElement('div', null, children),
      ContentBackLink: dummyComponent,
    },
    '@/components/ui/page-header': { SectionEyebrow: dummyComponent },
    '@/components/ui/skeleton': { HomeNewsBentoSkeleton: dummyComponent },
    '@/components/ui/state-block': { ErrorState: dummyComponent },
    '@/lib/campus-error': { campusErrorKind: () => 'unknown' },
    '@/i18n': {
      useI18n: () => ({ locale: 'vi', messages: { content: { news: PUBLIC_NEWS_COPY } } }),
    },
    '@/lib/query': { useApiQuery: () => ({ data: item, isLoading: false, isError: false }) },
    '@/lib/html-sanitizer': sanitizer,
    '@/lib/announcement-presentation': presentation,
    '@/components/ui/rich-content-renderer': loadRenderer(),
  });
}

test('the public permalink renders a markdown body through the shared reader pipeline', () => {
  const item = {
    id: 'ann-public',
    title: 'Lịch thi học kỳ',
    content: '# Lịch thi\n\n**Mang thẻ sinh viên**',
    publishAt: '2026-01-05T07:00:00.000Z',
    createdAt: '2026-01-05T07:00:00.000Z',
    publishedBy: null,
  };

  const markup = renderElement(loadPublicNewsDetail(item).default, {});

  // The body heading is anchored by the shared renderer (the page's own title
  // is an h1 without an id), and inline markdown becomes real markup.
  assert.match(markup, /<h1[^>]*id="lich-thi"/);
  assert.match(markup, /<strong[^>]*>Mang thẻ sinh viên<\/strong>/);
  assert.doesNotMatch(markup, /# Lịch thi/, 'the markdown heading marker must not reach the reader');
  assert.doesNotMatch(markup, /\*\*/, 'the markdown bold markers must not reach the reader');
});
