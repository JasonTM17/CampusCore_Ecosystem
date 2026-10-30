const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function findNodes(rootNode, predicate) {
  const matches = [];
  const visit = node => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(rootNode);
  return matches;
}

test('admin announcement TinyMCE recovery key includes the authenticated admin id', () => {
  const pageAst = ts.createSourceFile(
    'admin-announcements.tsx',
    read('src/app/admin/announcements/page.tsx'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const editorElements = findNodes(pageAst, node =>
    ts.isJsxSelfClosingElement(node) && node.tagName.getText(pageAst) === 'TinyMceEditor');
  assert.equal(editorElements.length, 1, 'the admin announcements page has one TinyMCE callsite');

  const ownerAttribute = editorElements[0].attributes.properties.find(property =>
    ts.isJsxAttribute(property) && property.name.text === 'draftOwnerId');
  assert.ok(ownerAttribute, 'the announcement editor receives draftOwnerId');
  const ownerExpression = ownerAttribute.initializer.expression;
  assert.equal(ownerExpression.getText(pageAst), 'user?.id');
  const ownerId = Function('user', `return ${ownerExpression.getText(pageAst)};`)({ id: 'admin-b' });
  assert.equal(ownerId, 'admin-b');

  const editorSource = read('src/components/ui/tinymce-editor.tsx');
  const editorAst = ts.createSourceFile('tinymce-editor.tsx', editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const [idDeclaration] = findNodes(editorAst, node =>
    ts.isVariableDeclaration(node) && node.name.getText(editorAst) === 'editorId');
  assert.ok(idDeclaration, 'TinyMCE derives its storage identity from editorId');
  const output = ts.transpileModule(idDeclaration.getText(editorAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const editorId = Function('id', 'generatedId', 'draftOwnerId', `${output}; return editorId;`)(
    undefined,
    'test-editor',
    ownerId,
  );

  assert.equal(editorId, 'tinymce-test-editor-owner-admin-b');
});
