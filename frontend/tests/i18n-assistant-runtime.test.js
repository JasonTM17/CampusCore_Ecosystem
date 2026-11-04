const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const fragmentPath = 'src/components/assistant/assistant-messages.ts';
const sourcePaths = [
  'src/lib/assistant-student-resolver.ts',
  'src/components/assistant/AssistantMessages.tsx',
  'src/components/assistant/AssistantPanel.tsx',
  'src/components/assistant/useAssistantStream.ts',
  'src/app/dashboard/assistant-specialized/page.tsx',
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadFragment() {
  const output = ts.transpileModule(read(fragmentPath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', output)(moduleRecord, moduleRecord.exports);
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

function stringLeaves(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringLeaves(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      stringLeaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return typeof value === 'string' ? [[prefix, value]] : [];
}

function hasVietnameseDiacritics(value) {
  return /[\u00C0-\u024F\u1E00-\u1EFF]/u.test(value);
}

function assertLocaleText(en, vi, namespace) {
  for (const [key, value] of stringLeaves(en)) {
    assert.equal(hasVietnameseDiacritics(value), false, `${namespace}.${key} English copy has Vietnamese diacritics`);
  }
  const properBrands = new Set(['CampusUTE']);
  for (const [key, value] of stringLeaves(vi)) {
    const words = value
      .replace(/\{[^}]+\}/g, '')
      .replace(/\*\*/g, '')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
    const acronymOnly = words.length > 0 && words.every((word) => /^[A-Z0-9]+$/.test(word) || properBrands.has(word));
    assert.ok(
      hasVietnameseDiacritics(value) || acronymOnly,
      `${namespace}.${key} appears to be an ASCII-only English sentence in Vietnamese copy`,
    );
  }
}

function localeLiteralPairs(sourceText, relativePath) {
  const source = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pairs = [];
  const isLocaleCondition = (node) => {
    if (ts.isIdentifier(node)) return ['isVi', 'vi'].includes(node.text);
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
    return (
      (ts.isIdentifier(node.left) && node.left.text === 'locale' && ts.isStringLiteral(node.right) && node.right.text === 'vi') ||
      (ts.isStringLiteral(node.left) && node.left.text === 'vi' && ts.isIdentifier(node.right) && node.right.text === 'locale')
    );
  };
  const containsText = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return true;
    let found = false;
    ts.forEachChild(node, (child) => { found = found || containsText(child); });
    return found;
  };
  const visit = (node) => {
    if (ts.isConditionalExpression(node) && isLocaleCondition(node.condition) && containsText(node.whenTrue) && containsText(node.whenFalse)) {
      pairs.push(sourceText.slice(node.getStart(source), node.end));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return pairs;
}

const current = loadFragment().assistantWindowMessages.en;
const requiredKeys = [
  'resolver.defaultName',
  'resolver.greeting.header',
  'resolver.greeting.body.introduction',
  'resolver.greeting.body.topics[0]',
  'resolver.greeting.body.closing',
  'resolver.capabilities.introduction',
  'resolver.capabilities.points[0]',
  'resolver.capabilities.closing',
  'resolver.thankYou',
  'resolver.goodbye',
  'clipboard.copyFailed',
  'specialized.retry',
];
const hasRequiredKeys = requiredKeys.every((pathName) => {
  let value = current;
  for (const part of pathName.replace(/\[(\d+)\]/g, '.$1').split('.')) value = value?.[part];
  return typeof value === 'string';
});

test('assistantWindowMessages has matching recursive keys and placeholders', { skip: !hasRequiredKeys }, () => {
  const { assistantWindowMessages } = loadFragment();
  assert.ok(assistantWindowMessages?.en && assistantWindowMessages?.vi);
  assert.deepEqual(keyPaths(assistantWindowMessages.en), keyPaths(assistantWindowMessages.vi));
  assertMessageParity(assistantWindowMessages.en, assistantWindowMessages.vi, 'assistantWindowMessages');
  assertLocaleText(assistantWindowMessages.en, assistantWindowMessages.vi, 'assistantWindowMessages');
});

test('assistant runtime uses the catalogue for localized literal pairs', () => {
  const remaining = sourcePaths.flatMap((relativePath) =>
    localeLiteralPairs(read(relativePath), relativePath).map((pair) => `${relativePath}: ${pair}`));
  assert.deepEqual(remaining, []);
});
