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

test('library catalogue section provides an h2 heading before book h3 titles', () => {
  const sourceFile = readTsx('src/components/library/LibraryCataloguePage.tsx');
  const sections = elements(sourceFile, 'section');
  const catalogueSection = sections.find((node) => {
    const parent = node.parent && ts.isJsxElement(node.parent) ? node.parent : node;
    const text = parent.getText(sourceFile);
    return text.includes('titles.map') && text.includes('library-catalogue');
  });
  assert.ok(catalogueSection, 'catalogue section must exist');

  const parent = catalogueSection.parent && ts.isJsxElement(catalogueSection.parent)
    ? catalogueSection.parent
    : catalogueSection;
  const sectionText = parent.getText(sourceFile);
  assert.match(
    sectionText,
    /<h2[^>]*>\{copy\.title\}<\/h2>/,
    'catalogue section must contain an <h2> heading before <h3> book titles',
  );
});

test('lecturer grades page maintains valid heading hierarchy with h2 heading before section items', () => {
  const sourceFile = readTsx('src/app/dashboard/lecturer/grades/page.tsx');
  // Lecturer grades wraps the class sections list in WorkspacePanel with queueTitle
  const panels = elements(sourceFile, 'WorkspacePanel');
  const queuePanel = panels.find((node) => {
    const parent = node.parent && ts.isJsxElement(node.parent) ? node.parent : node;
    const text = parent.getText(sourceFile);
    return text.includes('sections.map');
  });
  assert.ok(queuePanel, 'queue WorkspacePanel must exist');

  // Verify that WorkspacePanel internally renders CardTitle as="h2"
  const workspaceSurface = readTsx('src/components/dashboard/WorkspaceSurface.tsx');
  const cardTitles = elements(workspaceSurface, 'CardTitle');
  const h2Title = cardTitles.find((node) => node.getText(workspaceSurface).includes('as="h2"'));
  assert.ok(h2Title, 'WorkspacePanel renders CardTitle as="h2", establishing valid H1 -> H2 -> H3 hierarchy');
});
