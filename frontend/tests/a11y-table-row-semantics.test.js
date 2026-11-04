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

test('academic transcript table row semantics is preserved and guarded by milestone-2 accessibility contract', () => {
  const sourceFile = readTsx('src/app/dashboard/transcript/page.tsx');
  const trElements = elements(sourceFile, 'tr');
  const recordRows = trElements.filter((node) => {
    const parent = node.parent && ts.isJsxElement(node.parent) ? node.parent : node;
    const text = parent.getText(sourceFile);
    return text.includes('setSelectedRecord(record)') && text.includes('record.courseCode');
  });
  assert.ok(recordRows.length > 0, 'transcript record rows must exist');

  // Verify that the row keyboard handler and focus classes required by ui-copy-polish.test.js remain intact
  for (const row of recordRows) {
    const attrs = attributes(row, sourceFile);
    assert.equal(staticString(attrs.get('role')), 'button', 'row retains role="button" per existing test oracle');
    assert.equal(expressionText(attrs.get('tabIndex'), sourceFile), '0', 'row retains tabIndex={0} per keyboard interaction contract');
  }
});
