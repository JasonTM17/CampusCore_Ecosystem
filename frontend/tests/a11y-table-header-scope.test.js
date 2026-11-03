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

const cases = [
  {
    name: 'admin attendance records table',
    file: 'src/app/admin/attendance/page.tsx',
    expectedHeaders: 5,
  },
  {
    name: 'admin credit limit applications table',
    file: 'src/app/admin/credit-limit-applications/page.tsx',
    expectedHeaders: 7,
  },
  {
    name: 'admin system notifications sent log table',
    file: 'src/app/admin/notifications/page.tsx',
    expectedHeaders: 5,
  },
  {
    name: 'admin class sections table',
    file: 'src/app/admin/sections/page.tsx',
    expectedHeaders: 8,
  },
  {
    name: 'student attendance breakdown table',
    file: 'src/app/dashboard/attendance/page.tsx',
    expectedHeaders: 7,
  },
  {
    name: 'student semester grades table',
    file: 'src/app/dashboard/grades/page.tsx',
    expectedHeaders: 9,
  },
  {
    name: 'grade detail modal component table',
    file: 'src/components/dashboard/GradeDetailModal.tsx',
    expectedHeaders: 3,
  },
  {
    name: 'lecturer geofence check-in review table',
    file: 'src/components/lecturer/GeofenceCheckinPanel.tsx',
    expectedHeaders: 7,
  },
];

for (const c of cases) {
  test(`${c.name} headers declare scope="col" and table has accessible name`, () => {
    const sourceFile = readTsx(c.file);
    const tables = elements(sourceFile, 'table');
    assert.ok(tables.length > 0, `${c.file} must render a <table>`);

    for (const table of tables) {
      const tableAttrs = attributes(table, sourceFile);
      const ariaLabel = tableAttrs.get('aria-label');
      assert.ok(ariaLabel, `${c.file} <table> must have an aria-label`);
    }

    const thElements = elements(sourceFile, 'th');
    assert.ok(
      thElements.length >= c.expectedHeaders,
      `${c.file} expected at least ${c.expectedHeaders} <th> elements, found ${thElements.length}`,
    );

    for (const th of thElements) {
      const attrs = attributes(th, sourceFile);
      const scope = staticString(attrs.get('scope'));
      assert.equal(scope, 'col', `${c.file} <th> must declare scope="col"`);
    }
  });
}
