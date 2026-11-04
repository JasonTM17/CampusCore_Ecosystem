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
  const asciiSentence = /^[ -~]+$/.test(vi) && /[a-z]/i.test(vi) && vi.length > 3;
  const technical = /^(Email:|HK|T\{|T$|AM|PM|Eve|TODAY|items?$|mục$|vd:)/;
  assert.equal(asciiSentence && !technical.test(vi), false, `${prefix} Vietnamese copy must not be a bare ASCII English sentence`);
}

const fragment = loadModule('src/i18n/messages-admin-ops.ts');
const en = fragment['adminOpsEn'];
const vi = fragment['adminOpsVi'];

test('adminOps EN/VI parity', () => {
  assertMessageParity(en, vi);
  assertLocalePurity(en, vi);
});

test('converted sources contain no remaining inline locale literal pairs', () => {
  const files = ['src/app/admin/assistant-knowledge/page.tsx','src/components/admin/AdminAnalyticsCharts.tsx','src/app/admin/events/page.tsx','src/app/admin/audit/page.tsx'];
  for (const file of files) {
    const source = read(file);
    const matches = source.match(/locale === 'vi' \? '[^']*'|locale === 'en' \? '[^']*'|isVi \? '[^']*'|vi \? '[^']*'/g) || [];
    // 'vi'/'en' literal branches are locale-selection logic, not copy.
    const left = matches.filter((m) => !/^vi \? '(vi|en|both)'$/.test(m));
    assert.deepEqual(left, [], `${file} still contains inline literal locale branches: ${left.slice(0, 3).join(' | ')}`);
  }
});
