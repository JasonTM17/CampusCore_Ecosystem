const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'src/components/ui/rich-text-editor.tsx',
  'src/components/ui/tinymce-editor.tsx',
  'src/components/ui/rich-content-renderer.tsx',
  'src/lib/editor-templates.ts',
  'src/app/dashboard/editor/page.tsx',
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadFragment() {
  const output = ts.transpileModule(read('src/i18n/messages-editor.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function stringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText();
  return null;
}

function isLocaleCondition(node, source) {
  const condition = node.condition.getText(source).replace(/\s+/g, '');
  return condition === 'isVi'
    || condition === 'vi'
    || condition === "locale==='vi'"
    || condition === 'locale==="vi"';
}

function localeLiteralPairs(relativePath) {
  const text = read(relativePath);
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pairs = [];
  const propertyName = (property) => property.name.getText(source).replace(/^['"]|['"]$/g, '');
  function compareObjects(viObject, enObject) {
    if (!ts.isObjectLiteralExpression(viObject) || !ts.isObjectLiteralExpression(enObject)) return;
    for (const viProperty of viObject.properties) {
      if (!ts.isPropertyAssignment(viProperty)) continue;
      const enProperty = enObject.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property) === propertyName(viProperty));
      if (!enProperty) continue;
      const vi = stringValue(viProperty.initializer);
      const en = stringValue(enProperty.initializer);
      if (vi !== null && en !== null) {
        pairs.push({ vi, en, line: source.getLineAndCharacterOfPosition(viProperty.getStart(source)).line + 1 });
      } else {
        compareObjects(viProperty.initializer, enProperty.initializer);
      }
    }
  }
  function visit(node) {
    if (ts.isConditionalExpression(node) && isLocaleCondition(node, source)) {
      const vi = stringValue(node.whenTrue);
      const en = stringValue(node.whenFalse);
      if (vi !== null && en !== null) pairs.push({ vi, en, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      else compareObjects(node.whenTrue, node.whenFalse);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const viProperty = node.initializer.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property) === 'vi');
      const enProperty = node.initializer.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property) === 'en');
      if (viProperty && enProperty) compareObjects(viProperty.initializer, enProperty.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return pairs;
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
  assert.equal(typeof en, 'string', `${prefix} English copy must be a string`);
  assert.equal(typeof vi, 'string', `${prefix} Vietnamese copy must be a string`);
  assert.notEqual(en.trim(), '', `${prefix} English copy must not be empty`);
  assert.notEqual(vi.trim(), '', `${prefix} Vietnamese copy must not be empty`);
  const tokens = (value) => [...value.matchAll(/\{([A-Za-z][\w]*)\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(tokens(en), tokens(vi), `${prefix} placeholder tokens must match`);
  assert.doesNotMatch(en, /[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/, `${prefix} English copy contains Vietnamese diacritics`);
  const asciiSentence = /^[A-Za-z][A-Za-z0-9 ,.'’?!:/()&+-]*[.!?]$/.test(vi.trim())
    && vi.trim().split(/\s+/).length >= 4;
  assert.equal(asciiSentence, false, `${prefix} Vietnamese copy contains an ASCII-only English sentence`);
}

test('editorSurfaces has locale parity and the owned surfaces use catalogue copy', () => {
  // Run the source scan first so the required fail-first run fails on the old
  // inline locale branches before the catalogue exists.
  for (const file of sourceFiles) {
    const leftovers = localeLiteralPairs(file).filter((pair) => {
      if (['vi', 'en', 'vi-VN', 'en-US'].includes(pair.vi) && ['vi', 'en', 'vi-VN', 'en-US'].includes(pair.en)) return false;
      if (pair.vi === pair.en) return false;
      return true;
    });
    assert.deepEqual(leftovers, [], `${file} has locale-specific literal copy outside editorSurfaces`);
  }

  const { editorSurfacesEn, editorSurfacesVi } = loadFragment();
  assert.ok(editorSurfacesEn && editorSurfacesVi, 'both editorSurfaces exports must exist');
  assert.deepEqual(keyPaths(editorSurfacesEn), keyPaths(editorSurfacesVi));
  assertMessageParity(editorSurfacesEn, editorSurfacesVi, 'editorSurfaces');
  assert.deepEqual(editorSurfacesEn.renderer.callout, {
    note: 'Note',
    tip: 'Tip',
    important: 'Important',
    warning: 'Warning',
    caution: 'Caution',
  });
  assert.deepEqual(
    {
      copySource: editorSurfacesVi.renderer.copySource,
      copied: editorSurfacesVi.renderer.copied,
      copyFailed: editorSurfacesVi.renderer.copyFailed,
      copy: editorSurfacesVi.renderer.copy,
    },
    {
      copySource: 'Sao chép mã nguồn',
      copied: 'Đã chép',
      copyFailed: 'Chưa chép được',
      copy: 'Sao chép',
    },
  );
  assert.equal(editorSurfacesEn.renderer.imageLoadFailedWithAlt, '[Image failed to load: {alt}]');
  assert.equal(editorSurfacesVi.renderer.imageLoadFailedWithAlt, '[Hình ảnh không tải được: {alt}]');
  assert.equal(editorSurfacesEn.renderer.imageUnavailable, '[Illustration image cannot be displayed]');
  assert.equal(editorSurfacesVi.renderer.imageUnavailable, '[Hình ảnh minh họa không thể hiển thị]');
  assert.deepEqual(editorSurfacesVi.renderer.callout, {
    note: 'LƯU Ý (NOTE)',
    tip: 'MẸO (TIP)',
    important: 'QUAN TRỌNG (IMPORTANT)',
    warning: 'CẢNH BÁO (WARNING)',
    caution: 'CHÚ Ý NGUY CƠ (CAUTION)',
  });
  assert.doesNotMatch(read('src/components/ui/rich-text-editor.tsx'), /\b(?:name|description)(?:Vi|En)\s*:/);
  assert.doesNotMatch(read('src/components/ui/tinymce-editor.tsx'), /\b(?:title|description)(?:Vi|En)\s*:/);
});
