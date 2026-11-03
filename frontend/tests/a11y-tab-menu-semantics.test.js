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

test('admin analytics chart tab controls declare tablist and tab semantics with 44px min touch target', () => {
  const sourceFile = readTsx('src/components/admin/AdminAnalyticsCharts.tsx');
  const divs = elements(sourceFile, 'div');
  const tablist = divs.find((node) => {
    const classAttr = staticString(attributes(node, sourceFile).get('className')) ?? '';
    return classAttr.includes('rounded-lg border border-border bg-secondary/30');
  });
  assert.ok(tablist, 'tablist container must exist');
  const tablistAttrs = attributes(tablist, sourceFile);
  assert.equal(staticString(tablistAttrs.get('role')), 'tablist', 'container must declare role="tablist"');

  const buttons = elements(sourceFile, 'Button');
  const tabButtons = buttons.filter((node) => {
    const text = node.getText(sourceFile);
    return text.includes('setActiveTab(');
  });
  assert.equal(tabButtons.length, 4, 'expected 4 chart tab buttons');

  for (const button of tabButtons) {
    const attrs = attributes(button, sourceFile);
    assert.equal(staticString(attrs.get('role')), 'tab', 'tab button must declare role="tab"');
    const ariaSelected = expressionText(attrs.get('aria-selected'), sourceFile);
    assert.match(ariaSelected, /activeTab ===/, 'tab button must bind aria-selected to activeTab');
    const className = expressionText(attrs.get('className'), sourceFile);
    assert.match(className, /min-h-\[44px\]/, 'tab button must declare min-h-[44px] for touch targets');
  }
});

test('academic templates popup button and menu declare popup, menu and menuitem semantics with Escape dismissal', () => {
  const sourceFile = readTsx('src/components/ui/rich-text-editor.tsx');
  const buttons = elements(sourceFile, 'button');
  const templateButton = buttons.find((node) => {
    const text = node.getText(sourceFile);
    return text.includes('setTemplatesOpen(!templatesOpen)') || text.includes('copy.templatesTitle');
  });
  assert.ok(templateButton, 'template toggle button must exist');

  const btnAttrs = attributes(templateButton, sourceFile);
  assert.equal(staticString(btnAttrs.get('aria-haspopup')), 'true', 'template toggle button must declare aria-haspopup="true"');
  const ariaExpanded = expressionText(btnAttrs.get('aria-expanded'), sourceFile);
  assert.match(ariaExpanded, /templatesOpen/, 'template toggle button must bind aria-expanded to templatesOpen');

  // Verify menu container role and menuitem roles
  const divs = elements(sourceFile, 'div');
  const menuContainer = divs.find((node) => {
    const classAttr = staticString(attributes(node, sourceFile).get('className')) ?? '';
    return classAttr.includes('bg-popover');
  });
  assert.ok(menuContainer, 'template popup menu container must exist');
  const menuAttrs = attributes(menuContainer, sourceFile);
  assert.equal(staticString(menuAttrs.get('role')), 'menu', 'template popup container must declare role="menu"');

  const menuItems = buttons.filter((node) => {
    const parent = node.parent && ts.isJsxElement(node.parent) ? node.parent : node;
    const text = parent.getText(sourceFile);
    return text.includes('tmpl.contentVi') || text.includes('templateCopy[tmpl.id]');
  });
  assert.ok(menuItems.length > 0, 'menu items must exist');
  for (const item of menuItems) {
    const itemAttrs = attributes(item, sourceFile);
    assert.equal(staticString(itemAttrs.get('role')), 'menuitem', 'template item must declare role="menuitem"');
  }

  // Verify Escape key handling in popup container
  const onKeyDown = expressionText(menuAttrs.get('onKeyDown'), sourceFile);
  assert.match(onKeyDown, /Escape/, 'menu container must handle Escape key');
  assert.match(onKeyDown, /setTemplatesOpen\(false\)/, 'menu container Escape handler must close menu');
});
