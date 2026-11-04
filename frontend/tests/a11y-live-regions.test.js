const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function readTsx(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function attributes(node, sourceFile) {
  return new Map(
    node.attributes.properties
      .filter((property) => ts.isJsxAttribute(property))
      .map((property) => [property.name.getText(sourceFile), property]),
  );
}

function staticString(attribute) {
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteral(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }
  return null;
}

function expressionText(attribute, sourceFile) {
  if (!attribute?.initializer) return '';
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression?.getText(sourceFile) ?? '';
  }
  return attribute.initializer.getText(sourceFile);
}

function elements(sourceFile, tag) {
  const found = [];
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === tag
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

test('announcement creation validation error container announces immediately via alert role and assertive live region', () => {
  const sourceFile = readTsx('src/components/announcements/LecturerAnnouncementCreateModal.tsx');
  // Find the validationError container div that contains AlertCircle and validationError text
  const divs = elements(sourceFile, 'div');
  const errorContainer = divs.find((node) => {
    const parent = node.parent && ts.isJsxElement(node.parent) ? node.parent : node;
    const text = parent.getText(sourceFile);
    return text.includes('AlertCircle') && text.includes('validationError');
  });
  assert.ok(errorContainer, 'validation error container must exist');

  const attrs = attributes(errorContainer, sourceFile);
  const role = staticString(attrs.get('role'));
  const ariaLive = staticString(attrs.get('aria-live'));

  assert.equal(role, 'alert', 'validation error container must declare role="alert"');
  assert.equal(ariaLive, 'assertive', 'validation error container must declare aria-live="assertive"');
});

test('grade import parsing feedback container announces status changes politely', () => {
  const sourceFile = readTsx('src/components/lecturer/GradeImportPanel.tsx');
  const divs = elements(sourceFile, 'div');
  const resultContainer = divs.find((node) => {
    const classAttr = staticString(attributes(node, sourceFile).get('className'));
    return classAttr === 'space-y-1 text-xs';
  });
  assert.ok(resultContainer, 'result feedback container must exist');

  const attrs = attributes(resultContainer, sourceFile);
  const role = staticString(attrs.get('role'));
  const ariaLive = staticString(attrs.get('aria-live'));

  assert.equal(role, 'status', 'grade import result container must declare role="status"');
  assert.equal(ariaLive, 'polite', 'grade import result container must declare aria-live="polite"');
});
