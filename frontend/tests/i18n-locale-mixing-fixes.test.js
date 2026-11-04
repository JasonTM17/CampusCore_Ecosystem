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

// ---------------------------------------------------------------------------
// S1 — the inserted Markdown table template must stay 3 columns wide in both
// locales. The old EN branch printed "Giá trị B" and the last row only had two
// cells, so every generated table was malformed.
// ---------------------------------------------------------------------------

function renderTableTemplate() {
  const source = read('src/components/ui/rich-text-editor.tsx');
  const line = source
    .split(/\r?\n/)
    .find((candidate) => candidate.includes('copy.table.header1'));

  assert.ok(line, 'the three-column table template must stay in rich-text-editor.tsx');
  assert.match(source, /const copy = isVi \? editorSurfacesVi\.richText : editorSurfacesEn\.richText/);
  const start = line.indexOf('`');
  const end = line.lastIndexOf('`');
  assert.ok(start !== -1 && end > start, 'table template must be a template literal');
  const template = line.slice(start + 1, end);
  const { editorSurfacesEn, editorSurfacesVi } = loadModule('src/i18n/messages-editor.ts');

  return (isVi) => Function('copy', `return \`${template}\`;`)(
    isVi ? editorSurfacesVi.richText : editorSurfacesEn.richText,
  );
}

test('rich-text-editor inserts a structurally valid three-column table in both locales', () => {
  const render = renderTableTemplate();

  for (const [isVi, label] of [[true, 'vi'], [false, 'en']]) {
    const rows = render(isVi).split('\n').filter((row) => row.trim() !== '');
    assert.equal(rows.length, 4, `${label} table must have a header, separator, and two data rows`);

    for (const [index, row] of rows.entries()) {
      const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      assert.equal(cells.length, 3, `${label} table row ${index + 1} must have 3 cells: ${row}`);
    }
  }

  const english = render(false);
  assert.match(english, /Row 2/, 'English second row label must be localized');
  assert.match(english, /Value B/, 'English second row value must stay English');
  assert.doesNotMatch(english, /Giá trị/, 'English table must not contain Vietnamese copy');

  const vietnamese = render(true);
  assert.match(vietnamese, /Mục 2/);
  assert.match(vietnamese, /Giá trị B/);
});

// ---------------------------------------------------------------------------
// S6 — the code-block snippet comment must follow the active locale.
// ---------------------------------------------------------------------------

test('rich-text-editor code snippet comment follows the active locale', () => {
  const source = read('src/components/ui/rich-text-editor.tsx');
  const { editorSurfacesEn, editorSurfacesVi } = loadModule('src/i18n/messages-editor.ts');

  assert.equal(
    source.includes("insertSnippet('```java\\n// Mã nguồn minh họa\\n```')"),
    false,
    'the code-block snippet must not hardcode the Vietnamese comment',
  );

  const codeLine = source
    .split(/\r?\n/)
    .find((candidate) => candidate.includes('insertSnippet(') && candidate.includes('```java'));
  assert.ok(codeLine, 'the code-block snippet must stay in rich-text-editor.tsx');
  assert.ok(
    codeLine.includes('copy.codeComment'),
    `code-block snippet must use the editor fragment: ${codeLine}`,
  );
  assert.equal(editorSurfacesVi.richText.codeComment, '// Mã nguồn minh họa');
  assert.equal(editorSurfacesEn.richText.codeComment, '// Sample code');
});

// ---------------------------------------------------------------------------
// S2 — the English semester-name placeholder must not contain Vietnamese.
// ---------------------------------------------------------------------------

test('semester name placeholder is English in the English locale', () => {
  const source = read('src/app/admin/semesters/page.tsx');
  // The semester page copy lives in the adminAcademics fragment, so
  // the placeholder values are asserted on the catalogue the page now reads.
  const { adminAcademicsEn, adminAcademicsVi } = loadModule('src/i18n/messages-admin-academics.ts');

  assert.match(
    source,
    /placeholder=\{copy\.fields\.namePlaceholder\}/,
    'the name field must read the localized placeholder from its page copy',
  );
  assert.match(
    source,
    /placeholder=\{copy\.fields\.englishNamePlaceholder\}/,
    'the English-name field must read its localized placeholder from the page copy',
  );
  assert.equal(
    adminAcademicsEn.semesters.fields.englishNamePlaceholder,
    'e.g. Fall 2026',
    'English placeholder must not mix Vietnamese',
  );
  assert.equal(
    adminAcademicsEn.semesters.fields.namePlaceholder,
    'e.g. Fall Semester 2026',
    'the English page copy keeps the English semester-name example',
  );
  assert.equal(adminAcademicsVi.semesters.fields.namePlaceholder, 'Ví dụ: Học kỳ Thu 2026');
  assert.equal(adminAcademicsVi.semesters.fields.englishNamePlaceholder, 'Ví dụ: Fall 2026');
});

// ---------------------------------------------------------------------------
// S3 — the Vietnamese studentPages block must not ship English UI values.
// ---------------------------------------------------------------------------

test('studentPages Vietnamese catalogue values are actually Vietnamese', () => {
  const { en, vi } = loadMessages();

  assert.deepEqual(
    keyPaths(en.studentPages),
    keyPaths(vi.studentPages),
    'studentPages key parity must hold after the copy fixes',
  );

  const pairs = [
    ['announcements.banner.imageAlt', en.studentPages.announcements.banner.imageAlt, 'HCMUTE Campus Banner'],
    ['announcements.banner.campusPortal', en.studentPages.announcements.banner.campusPortal, 'HCMUTE Campus Portal'],
    ['schedule.courseCodeFallback', en.studentPages.schedule.courseCodeFallback, 'Course'],
    ['schedule.courseNameFallback', en.studentPages.schedule.courseNameFallback, 'Unavailable'],
    ['ics.defaultCalendarName', en.studentPages.ics.defaultCalendarName, 'CampusUTE Timetable'],
  ];

  const viValues = {
    'announcements.banner.imageAlt': vi.studentPages.announcements.banner.imageAlt,
    'announcements.banner.campusPortal': vi.studentPages.announcements.banner.campusPortal,
    'schedule.courseCodeFallback': vi.studentPages.schedule.courseCodeFallback,
    'schedule.courseNameFallback': vi.studentPages.schedule.courseNameFallback,
    'ics.defaultCalendarName': vi.studentPages.ics.defaultCalendarName,
  };

  for (const [key, englishValue, expectedEnglish] of pairs) {
    assert.equal(englishValue, expectedEnglish, `${key} English value must be unchanged`);
    assert.notEqual(viValues[key], englishValue, `${key} Vietnamese value must be translated`);
    assert.match(viValues[key], /[à-ỹ]/i, `${key} Vietnamese value must contain Vietnamese characters`);
  }
});

// ---------------------------------------------------------------------------
// S4 — the unsaved-changes guard owns locale-aware copy instead of VI defaults.
// ---------------------------------------------------------------------------

test('unsaved-changes guard resolves its copy from the active locale', () => {
  const source = read('src/lib/use-unsaved-changes-guard.ts');

  assert.match(source, /import \{ useI18n \} from '@\/i18n'/);
  assert.match(source, /const \{ messages \} = useI18n\(\)/);
  assert.match(source, /messages\.common\.unsavedChanges/);

  for (const literal of [
    "'Bạn có nội dung chưa được lưu. Rời khỏi trang sẽ mất thay đổi.'",
    "'Nội dung chưa được lưu'",
    "'Bạn có nội dung chưa được lưu. Rời khỏi sẽ mất các thay đổi. Tiếp tục?'",
  ]) {
    assert.equal(source.includes(literal), false, `guard must not hardcode ${literal}`);
  }

  const { en, vi } = loadMessages();
  const enCopy = en.common.unsavedChanges;
  const viCopy = vi.common.unsavedChanges;
  assert.deepEqual(Object.keys(enCopy).sort(), Object.keys(viCopy).sort());
  for (const key of Object.keys(enCopy)) {
    assert.ok(enCopy[key].trim(), `English unsavedChanges.${key} must be non-empty`);
    assert.ok(viCopy[key].trim(), `Vietnamese unsavedChanges.${key} must be non-empty`);
    assert.notEqual(enCopy[key], viCopy[key], `unsavedChanges.${key} must be localized`);
  }
  assert.match(viCopy.beforeUnload, /[à-ỹ]/i);
  assert.doesNotMatch(enCopy.beforeUnload, /[à-ỹ]/i);
});

// ---------------------------------------------------------------------------
// S10 — advisor directory column label must describe the same thing in vi/en.
// ---------------------------------------------------------------------------

test('advisor directory supervision column label is semantically aligned', () => {
  const source = read('src/components/dashboard/thesis/ThesisAdvisorDirectoryPage.tsx');
  const { thesisWorkflowEn, thesisWorkflowVi } = loadModule('src/i18n/messages-thesis-workflow.ts');

  // The label lives in the thesisWorkflow catalogue; the locale
  // branches are gone from the page, so the assertion follows the copy.
  assert.equal(thesisWorkflowEn.advisorDirectory.table.workload, 'Supervision Quota');
  assert.equal(thesisWorkflowVi.advisorDirectory.table.workload, 'Chỉ tiêu hướng dẫn');
  assert.match(source, /copy\.table\.workload/);
  assert.equal(
    source.includes('Tải hướng dẫn'),
    false,
    'the VI column label must not mean "download instructions"',
  );
});

// ---------------------------------------------------------------------------
// S11 — no personal name or test probe marker in production placeholder copy.
// ---------------------------------------------------------------------------

test('admin audit search placeholder is neutral and localized', () => {
  const source = read('src/app/admin/audit/page.tsx');

  assert.match(source, /placeholder=\{\(locale === 'vi' \? adminOpsVi : adminOpsEn\)\.audit\.searchPlaceholder\}/);
  assert.equal(source.includes('Nguyễn Tiến Sơn'), false);
  assert.equal(source.includes('E2E PROBE'), false);

  const opsOutput = ts.transpileModule(read('src/i18n/messages-admin-ops.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const opsModule = { exports: {} };
  Function('module', 'exports', 'require', opsOutput)(opsModule, opsModule.exports, () => ({}));
  const { adminOpsEn, adminOpsVi } = opsModule.exports;
  assert.ok(adminOpsEn.audit.searchPlaceholder.trim());
  assert.ok(adminOpsVi.audit.searchPlaceholder.trim());
  assert.notEqual(adminOpsEn.audit.searchPlaceholder, adminOpsVi.audit.searchPlaceholder);
  assert.doesNotMatch(adminOpsEn.audit.searchPlaceholder, /Nguyễn Tiến Sơn|E2E PROBE/);
});

// ---------------------------------------------------------------------------
// Callout labels — the rich-content renderer must not print Vietnamese labels
// for English readers.
// ---------------------------------------------------------------------------

test('rich-content callout labels follow the active locale', () => {
  const source = read('src/components/ui/rich-content-renderer.tsx');
  const { editorSurfacesEn, editorSurfacesVi } = loadModule('src/i18n/messages-editor.ts');

  assert.match(source, /function AlertCallout[\s\S]*?const \{ locale \} = useI18n\(\)/);
  assert.match(source, /const calloutCopy = vi \? editorSurfacesVi\.renderer\.callout : editorSurfacesEn\.renderer\.callout/);

  const labels = [
    ['note', 'Note', 'LƯU Ý (NOTE)'],
    ['tip', 'Tip', 'MẸO (TIP)'],
    ['important', 'Important', 'QUAN TRỌNG (IMPORTANT)'],
    ['warning', 'Warning', 'CẢNH BÁO (WARNING)'],
    ['caution', 'Caution', 'CHÚ Ý NGUY CƠ (CAUTION)'],
  ];
  for (const [key, en, vi] of labels) {
    assert.ok(source.includes(`label: calloutCopy.${key}`), `${key} callout label must use localized copy`);
    assert.equal(editorSurfacesEn.renderer.callout[key], en);
    assert.equal(editorSurfacesVi.renderer.callout[key], vi);
  }
});

// ---------------------------------------------------------------------------
// S5 — every academic template carries a real English body beside the
// Vietnamese one. The locale decision must use the same `isVi` signal the
// template names already use, and the English body must not leak Vietnamese
// prose (placeholder tokens are preserved verbatim and excluded).
// ---------------------------------------------------------------------------

const VIETNAMESE =
  /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

const PLACEHOLDER = /\{\{[^}]*\}\}|\$\{[^}]*\}/g;

function visibleProse(markup) {
  return markup.replace(PLACEHOLDER, '');
}

function placeholders(markup) {
  return [...markup.matchAll(PLACEHOLDER)].map((match) => match[0]);
}

/** Text of a string/template literal, with `${…}` expressions left as tokens. */
function literalText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
    return node.text;
  }
  assert.ok(ts.isTemplateExpression(node), `unsupported template initializer: ${node.getText()}`);
  let text = node.head.text;
  for (const span of node.templateSpans) {
    text += `\${${span.expression.getText()}}${span.literal.text}`;
  }
  return text;
}

function findVariableInitializer(sourceFile, name) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node.initializer ?? null;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function templateObjects(relativePath, arrayName) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer = findVariableInitializer(sourceFile, arrayName);
  assert.ok(initializer, `${arrayName} must stay declared in ${relativePath}`);
  if (ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer) || ts.isSatisfiesExpression(initializer)) {
    initializer = initializer.expression;
  }
  assert.ok(ts.isArrayLiteralExpression(initializer), `${arrayName} must stay an array literal`);

  return initializer.elements.map((element, index) => {
    assert.ok(ts.isObjectLiteralExpression(element), `${arrayName}[${index}] must stay an object literal`);
    const properties = new Map();
    for (const property of element.properties) {
      assert.ok(ts.isPropertyAssignment(property), `${arrayName}[${index}] must use plain properties`);
      properties.set(property.name.getText(), literalText(property.initializer));
    }
    return properties;
  });
}

function assertBilingualTemplate(displayName, labels, properties) {
  for (const label of labels) {
    assert.equal(typeof properties.get(label), 'string', `${displayName} must declare ${label}`);
    assert.ok(properties.get(label).trim(), `${displayName}.${label} must be non-empty`);
  }
  const viBody = properties.get('contentVi');
  const enBody = properties.get('contentEn');
  assert.notEqual(viBody, enBody, `${displayName} English body must be a real translation`);
  assert.match(viBody, VIETNAMESE, `${displayName} Vietnamese body must stay Vietnamese`);
  assert.doesNotMatch(
    visibleProse(enBody),
    VIETNAMESE,
    `${displayName} English body must not contain Vietnamese prose`,
  );
  assert.deepEqual(
    placeholders(enBody),
    placeholders(viBody),
    `${displayName} must preserve every placeholder exactly`,
  );
}

test('Markdown editor templates insert an English body in the English locale', () => {
  const templates = templateObjects('src/components/ui/rich-text-editor.tsx', 'ACADEMIC_TEMPLATES');
  assert.equal(templates.length, 3, 'the Markdown editor must keep its three academic templates');
  const { editorSurfacesEn, editorSurfacesVi } = loadModule('src/i18n/messages-editor.ts');
  for (const properties of templates) {
    const id = properties.get('id');
    assertBilingualTemplate(
      id,
      ['contentVi', 'contentEn'],
      properties,
    );
    assert.ok(editorSurfacesEn.templates.richText[id].title.trim(), `${id} English title must be localized`);
    assert.ok(editorSurfacesVi.templates.richText[id].title.trim(), `${id} Vietnamese title must be localized`);
    assert.ok(editorSurfacesEn.templates.richText[id].description.trim(), `${id} English description must be localized`);
    assert.ok(editorSurfacesVi.templates.richText[id].description.trim(), `${id} Vietnamese description must be localized`);
  }

  const source = read('src/components/ui/rich-text-editor.tsx');
  assert.match(source, /templateCopy\[tmpl\.id\]\.title/);
  assert.match(source, /templateCopy\[tmpl\.id\]\.description/);
  assert.match(
    source,
    /handleTextChange\(isVi \? tmpl\.contentVi : tmpl\.contentEn\)/,
    'the template menu must insert the body that matches the editor locale',
  );
});

test('TinyMCE templates insert an English body in the English locale', () => {
  const templates = templateObjects('src/components/ui/tinymce-editor.tsx', 'TINYMCE_TEMPLATES');
  assert.equal(templates.length, 4, 'the TinyMCE editor must keep its four academic templates');
  const { editorSurfacesEn, editorSurfacesVi } = loadModule('src/i18n/messages-editor.ts');
  for (const properties of templates) {
    const id = properties.get('id');
    assertBilingualTemplate(
      id,
      ['contentVi', 'contentEn'],
      properties,
    );
    assert.ok(editorSurfacesEn.templates.tinyMce[id].title.trim(), `${id} English title must be localized`);
    assert.ok(editorSurfacesVi.templates.tinyMce[id].title.trim(), `${id} Vietnamese title must be localized`);
    assert.ok(editorSurfacesEn.templates.tinyMce[id].description.trim(), `${id} English description must be localized`);
    assert.ok(editorSurfacesVi.templates.tinyMce[id].description.trim(), `${id} Vietnamese description must be localized`);
  }

  const source = read('src/components/ui/tinymce-editor.tsx');
  assert.match(source, /templateCopy\[tmpl\.id\]\.title/);
  assert.match(source, /templateCopy\[tmpl\.id\]\.description/);
  assert.match(
    source,
    /handleInsertTemplate\(isVi \? tmpl\.contentVi : tmpl\.contentEn\)/,
    'the template menu must insert the body that matches the editor locale',
  );
});

test('editor block library and template library resolve bodies by locale', () => {
  const templates = loadModule('src/lib/editor-templates.ts');
  const { EDITOR_BLOCK_TYPES, EDITOR_BLOCK_HTML, EDITOR_BLOCK_HTML_EN } = templates;
  const { EDITOR_TEMPLATE_IDS, EDITOR_TEMPLATE_HTML, EDITOR_TEMPLATE_HTML_EN } = templates;

  assert.equal(EDITOR_BLOCK_TYPES.length, 7, 'the block builder must keep its seven blocks');
  assert.deepEqual(
    Object.keys(EDITOR_BLOCK_HTML_EN).sort(),
    [...EDITOR_BLOCK_TYPES].sort(),
    'every block must ship an English body',
  );
  for (const type of EDITOR_BLOCK_TYPES) {
    const viBody = EDITOR_BLOCK_HTML[type];
    const enBody = EDITOR_BLOCK_HTML_EN[type];
    assert.match(viBody, VIETNAMESE, `block.${type} Vietnamese body must stay Vietnamese`);
    assert.doesNotMatch(visibleProse(enBody), VIETNAMESE, `block.${type} English body must not contain Vietnamese`);
    assert.equal(templates.getEditorBlockHtml(type, true), viBody, `block.${type} must resolve VI for isVi`);
    assert.equal(templates.getEditorBlockHtml(type, false), enBody, `block.${type} must resolve EN for !isVi`);
  }

  assert.equal(EDITOR_TEMPLATE_IDS.length, 3, 'the template library must keep its three templates');
  assert.deepEqual(
    Object.keys(EDITOR_TEMPLATE_HTML_EN).sort(),
    [...EDITOR_TEMPLATE_IDS].sort(),
    'every library template must ship an English body',
  );
  for (const id of EDITOR_TEMPLATE_IDS) {
    const viBody = EDITOR_TEMPLATE_HTML[id];
    const enBody = EDITOR_TEMPLATE_HTML_EN[id];
    assert.match(viBody, VIETNAMESE, `template.${id} Vietnamese body must stay Vietnamese`);
    assert.doesNotMatch(visibleProse(enBody), VIETNAMESE, `template.${id} English body must not contain Vietnamese`);
    assert.equal(templates.getEditorTemplateHtml(id, true), viBody, `template.${id} must resolve VI for isVi`);
    assert.equal(templates.getEditorTemplateHtml(id, false), enBody, `template.${id} must resolve EN for !isVi`);
  }

  const page = read('src/app/dashboard/editor/page.tsx');
  assert.match(page, /htmlContent: getEditorBlockHtml\(type, isVi\)/);
  assert.match(page, /buildDefaultBlocks\(copy\.blocks, isVi\)/);
  assert.match(page, /applyTemplate\(getEditorTemplateHtml\(templateId, isVi\), templateCopy\.title\)/);
});

// ---------------------------------------------------------------------------
// S7 — one institutional taxonomy owns every article-category label. The
// homepage tabs, the keyword heuristics and the reader badges used to declare
// their own strings, and they had already drifted ("Student Life" vs
// "Student Life & Youth", "Việc làm & Doanh nghiệp" vs "Cơ hội Việc làm").
// ---------------------------------------------------------------------------

const CATEGORY_SLUGS = {
  RESEARCH_TECH: 'research-tech',
  AWARDS_HONORS: 'awards-honors',
  STUDENT_LIFE: 'student-life',
  CULTURE_ARTS: 'culture-arts',
  ACADEMIC_AFFAIRS: 'academic-affairs',
  CAREER_OPPORTUNITIES: 'career-opportunities',
};

function loadPresentation() {
  return loadModule('src/lib/announcement-presentation.ts', {
    '@/lib/html-sanitizer': loadModule('src/lib/html-sanitizer.ts'),
    '@/lib/api': {},
    '@/i18n/config': {},
    '@/i18n/messages-announcements': loadModule('src/i18n/messages-announcements.ts'),
  });
}

test('article-category labels resolve from INSTITUTIONAL_ARTICLE_CATEGORIES', () => {
  const {
    INSTITUTIONAL_ARTICLE_CATEGORIES,
    articleCategoryLabel,
    resolveAnnouncementDomain,
  } = loadPresentation();

  assert.equal(
    typeof articleCategoryLabel,
    'function',
    'announcement-presentation must export one label resolver',
  );

  for (const [code, meta] of Object.entries(INSTITUTIONAL_ARTICLE_CATEGORIES)) {
    assert.equal(articleCategoryLabel(code, 'vi'), meta.nameVi, `${code} VI taxonomy label`);
    assert.equal(articleCategoryLabel(code, 'en'), meta.nameEn, `${code} EN taxonomy label`);

    const vi = resolveAnnouncementDomain({ categoryId: CATEGORY_SLUGS[code] }, 'vi');
    const en = resolveAnnouncementDomain({ categoryId: CATEGORY_SLUGS[code] }, 'en');
    assert.equal(vi.categoryCode, code, `${code} category-id branch must keep its code`);
    assert.equal(vi.categoryLabel, meta.nameVi, `${code} category-id branch VI label`);
    assert.equal(en.categoryLabel, meta.nameEn, `${code} category-id branch EN label`);
  }

  const heuristicCases = [
    ['Quyết định mở cổng đăng ký học phần', 'ACADEMIC_AFFAIRS'],
    ['Nhạc hội chào tân sinh viên', 'CULTURE_ARTS'],
    ['Mùa hè xanh tình nguyện', 'STUDENT_LIFE'],
    ['Học bổng khuyến khích học tập', 'AWARDS_HONORS'],
    ['Nghiên cứu bán dẫn', 'RESEARCH_TECH'],
    ['Ngày hội tuyển dụng', 'CAREER_OPPORTUNITIES'],
    ['Thư viện mở cửa cuối tuần', 'ACADEMIC_AFFAIRS'],
    ['Thông báo chung', 'ACADEMIC_AFFAIRS'],
  ];

  for (const [title, code] of heuristicCases) {
    const meta = INSTITUTIONAL_ARTICLE_CATEGORIES[code];
    const vi = resolveAnnouncementDomain({ title });
    const en = resolveAnnouncementDomain({ title }, 'en');
    assert.equal(vi.categoryCode, code, `heuristic "${title}" must resolve to ${code}`);
    assert.equal(vi.categoryLabel, meta.nameVi, `heuristic "${title}" VI label`);
    assert.equal(en.categoryLabel, meta.nameEn, `heuristic "${title}" EN label`);
  }

  const source = read('src/lib/announcement-presentation.ts');
  assert.equal(
    /categoryLabel:\s*isVi\s*\?\s*'/.test(source),
    false,
    'resolveAnnouncementDomain must not re-declare category label strings inline',
  );
  assert.equal(
    (source.match(/categoryLabel:\s*articleCategoryLabel\(/g) || []).length,
    14,
    'every heuristic branch must resolve its label from the taxonomy',
  );
});

test('homepage category tabs read their labels from the taxonomy', () => {
  const source = read('src/components/home/HomeNewsSection.tsx');

  assert.match(
    source,
    /import \{[\s\S]*?articleCategoryLabel[\s\S]*?\} from '@\/lib\/announcement-presentation'/,
    'HomeNewsSection must consume the shared label resolver',
  );
  assert.equal(source.includes('labelVi'), false, 'tab labels must not be re-declared in Vietnamese');
  assert.equal(source.includes('labelEn'), false, 'tab labels must not be re-declared in English');
  assert.match(source, /articleCategoryLabel\(tab\.key, locale\)/);

  const order = [...source.matchAll(/\{ key: '([A-Z_]+)', icon:/g)].map((match) => match[1]);
  assert.deepEqual(
    order,
    [
      'ALL',
      'RESEARCH_TECH',
      'AWARDS_HONORS',
      'STUDENT_LIFE',
      'CULTURE_ARTS',
      'ACADEMIC_AFFAIRS',
      'CAREER_OPPORTUNITIES',
    ],
    'tab count and order must stay identical',
  );
});

// ---------------------------------------------------------------------------
// S8 — the static opengraph/twitter card is the default-locale fallback for
// `messages.meta.socialImage`, the same catalogue the localized route reads.
// ---------------------------------------------------------------------------

function loadSocialImageCopy() {
  return loadModule('src/lib/social-image-copy.ts', {
    '@/i18n/config': loadModule('src/i18n/config.ts'),
    '@/i18n/messages': loadMessages(),
  });
}

test('social-card copy comes from the catalogue for both locales', () => {
  const { getSocialImageCopy, SOCIAL_IMAGE_SIZE } = loadSocialImageCopy();
  const { en, vi } = loadMessages();

  assert.deepEqual(SOCIAL_IMAGE_SIZE, { width: 1200, height: 630 }, 'the 1200x630 contract must not change');

  const viCopy = getSocialImageCopy();
  assert.equal(viCopy.locale, 'vi', 'the file convention has no locale segment, so it renders the default locale');
  assert.equal(viCopy.eyebrow, vi.meta.socialImage.eyebrow);
  assert.equal(viCopy.title, vi.meta.socialImage.title);
  assert.equal(viCopy.description, vi.meta.socialImage.description);
  assert.deepEqual(viCopy.badges, vi.meta.socialImage.badges);
  assert.equal(viCopy.alt, `${vi.meta.socialImage.eyebrow} — ${vi.meta.socialImage.title}`);

  const enCopy = getSocialImageCopy('en');
  assert.equal(enCopy.locale, 'en');
  assert.equal(enCopy.title, en.meta.socialImage.title);
  assert.notEqual(enCopy.title, viCopy.title, 'the two locales must not share a title');

  assert.equal(getSocialImageCopy('fr').locale, 'vi', 'unknown locales fall back to the default locale');
});

test('static opengraph image renders catalogue copy instead of hardcoded Vietnamese', () => {
  const source = read('src/app/opengraph-image.tsx');

  assert.match(
    source,
    /import \{ getSocialImageCopy, SOCIAL_IMAGE_SIZE \} from '@\/lib\/social-image-copy'/,
  );
  assert.match(source, /const social = getSocialImageCopy\(\)/);
  assert.match(source, /export const alt = social\.alt/);
  assert.match(source, /export const size = SOCIAL_IMAGE_SIZE/);
  assert.match(source, /export const contentType = 'image\/png'/);
  assert.match(source, /\{social\.title\}/);
  assert.match(source, /\{social\.description\}/);
  assert.match(source, /social\.badges\.map/);

  for (const literal of [
    'Cổng Thông Tin Đào Tạo',
    'Đăng Ký Môn Học',
    'Tra Cứu Điểm Số',
    'Đồ Án Tốt Nghiệp',
  ]) {
    assert.equal(source.includes(literal), false, `opengraph-image must not hardcode ${literal}`);
  }
});

test('localized social-image route resolves the same catalogue copy', () => {
  const source = read('src/app/social-image/[locale]/route.tsx');

  assert.match(source, /export const runtime = 'edge'/);
  assert.match(source, /getSocialImageCopy\(locale\)/);
  assert.match(source, /SOCIAL_IMAGE_SIZE/);
});

// ---------------------------------------------------------------------------
// S9 — the site editor author fallback must follow the active locale instead of
// printing a Vietnamese office name on the English editor/preview.
// ---------------------------------------------------------------------------

test('site editor author fallbacks follow the active locale', () => {
  const source = read('src/app/dashboard/editor/page.tsx');
  const { editorSurfacesEn, editorSurfacesVi } = loadModule('src/i18n/messages-editor.ts');

  assert.equal(source.includes(": 'Phòng Đào Tạo & Ban Giám Hiệu';"), false);
  assert.equal(source.includes("ann.publishedBy || 'Phòng Đào tạo'"), false);
  assert.match(source, /: copy\.publisherFallback/);
  assert.match(source, /const fallbackPublisher = copy\.authorFallback/);
  assert.equal(editorSurfacesVi.studio.publisherFallback, 'Phòng Đào Tạo & Ban Giám Hiệu');
  assert.equal(editorSurfacesEn.studio.publisherFallback, 'Academic Affairs Office & Board of Directors');
  assert.equal(editorSurfacesVi.studio.authorFallback, 'Phòng Đào tạo');
  assert.equal(editorSurfacesEn.studio.authorFallback, 'Academic Affairs Office');
  assert.equal(
    (source.match(/fallbackPublisher/g) || []).length,
    3,
    'the fallback must be declared once and reused by the title and the cell',
  );
});
