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
  const tokens = (value) => [...value.matchAll(/\{([A-Za-z][\w]*)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(tokens(en), tokens(vi), `${prefix} placeholder tokens must match`);
}

const VIETNAMESE = /[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
const ENGLISH_STOPWORD = /\b(the|and|of|to|in|for|with|on|by|from|this|that|these|those|your|you|is|are|was|were|be|will|not|or|as|at|it|its)\b/i;

function assertLocalePurity(en, vi, prefix = '') {
  if (Array.isArray(en)) {
    en.forEach((value, index) => assertLocalePurity(value, vi[index], `${prefix}[${index}]`));
    return;
  }
  if (en !== null && typeof en === 'object') {
    for (const key of Object.keys(en)) {
      assertLocalePurity(en[key], vi && vi[key], prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  assert.equal(VIETNAMESE.test(en), false, `${prefix} English copy must not contain Vietnamese diacritics`);
  // Abbreviations (GVHD:, CTĐT) stay as-is; only a real ASCII English sentence
  // is evidence that the VI value was copied from EN.
  const words = vi.trim().split(/\s+/);
  const asciiEnglishSentence =
    /^[\x20-\x7E]+$/.test(vi) && words.length >= 3 && ENGLISH_STOPWORD.test(vi);
  assert.equal(asciiEnglishSentence, false, `${prefix} Vietnamese copy must not be an ASCII English sentence`);
}

const fragment = loadModule('src/i18n/messages-thesis-workflow.ts');
const en = fragment.thesisWorkflowEn;
const vi = fragment.thesisWorkflowVi;

test('thesisWorkflow EN/VI parity for the new workspace sections', () => {
  for (const section of ['advisorDirectory', 'topicCatalog', 'repository', 'workspace', 'progress']) {
    assert.equal(Object.hasOwn(en, section), true, `EN is missing ${section}`);
    assert.equal(Object.hasOwn(vi, section), true, `VI is missing ${section}`);
    assertMessageParity(en[section], vi[section], section);
  }
  assert.deepEqual(keyPaths(en), keyPaths(vi), 'thesisWorkflow key paths must match');
  assertLocalePurity(en, vi);
});

test('thesis workspace copy keeps the previous exact wording in both locales', () => {
  assert.equal(en.advisorDirectory.table.workload, 'Supervision Quota');
  assert.equal(vi.advisorDirectory.table.workload, 'Chỉ tiêu hướng dẫn');
  assert.equal(en.advisorDirectory.council.badge, 'HCMUTE Thesis Committee');
  assert.equal(vi.advisorDirectory.council.badge, 'Hội đồng Khóa luận HCMUTE');
  assert.equal(en.advisorDirectory.loadMore, 'Load more advisors ({visible}/{total})');
  assert.equal(vi.advisorDirectory.loadMore, 'Tải thêm giảng viên ({visible}/{total})');
  assert.equal(en.topicCatalog.searchAction, 'Search');
  assert.equal(vi.topicCatalog.searchAction, 'Tìm kiếm');
  assert.deepEqual(en.topicCatalog.quickPills, [
    'Artificial Intelligence', 'Software & Web', 'Robotics & Mechatronics',
    'Information Systems', 'IoT & Telecom', 'Automotive', 'Civil Engineering',
  ]);
  assert.deepEqual(vi.topicCatalog.quickPills, [
    'Trí tuệ nhân tạo (AI)', 'Phần mềm & Web', 'Cơ điện tử & Robot',
    'Hệ thống thông tin', 'IoT & Viễn thông', 'Kỹ thuật Ô tô', 'Xây dựng',
  ]);
  assert.equal(en.repository.submittedBy, 'Submitted by:');
  assert.equal(vi.repository.submittedBy, 'Người nộp:');
  assert.equal(en.workspace.downloadedReport, 'Downloaded report artifact');
  assert.equal(vi.workspace.downloadedReport, 'Đã tải tài liệu báo cáo');
  assert.equal(en.workspace.members.searchHint, 'Type at least 2 characters to search by name, student ID or email.');
  assert.equal(vi.workspace.members.searchHint, 'Nhập ít nhất 2 ký tự để tìm theo tên, MSSV hoặc email.');
  assert.equal(en.progress.members, 'members');
  assert.equal(vi.progress.members, 'thành viên');
});

test('converted thesis components contain no remaining inline locale literal pairs', () => {
  const files = [
    'src/components/dashboard/thesis/ThesisAdvisorDirectoryPage.tsx',
    'src/components/dashboard/thesis/ThesisTopicCatalogPage.tsx',
    'src/features/thesis/components/ThesisRepositoryWorkspace.tsx',
    'src/app/dashboard/thesis/page.tsx',
    'src/components/dashboard/thesis/ThesisProgressPage.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    const pairs = source.match(/(?:locale === 'vi'|isVi)\s*\?\s*['"`][^'"`]*['"`]/g) || [];
    assert.deepEqual(
      pairs,
      [],
      `${file} still contains inline locale literal pairs: ${pairs.slice(0, 3).join(' | ')}`,
    );
    assert.match(source, /thesisWorkflow(?:En|Vi)/, `${file} must consume the thesisWorkflow fragment`);
  }

  // No moved Vietnamese literal may survive in any converted component.
  const movedLiterals = [
    'Danh sách Giảng viên Hướng dẫn',
    'Tìm kiếm đề tài',
    'tài liệu đính kèm',
    'Đã tải tài liệu báo cáo',
    'Không thể tải kho lưu trữ báo cáo',
    'Chưa có thông tin thành viên',
    'Đơn vị chuyên môn:',
  ];
  for (const file of files) {
    const source = read(file);
    for (const literal of movedLiterals) {
      assert.equal(source.includes(`'${literal}'`), false, `${file} still carries the literal ${literal}`);
    }
  }
});
