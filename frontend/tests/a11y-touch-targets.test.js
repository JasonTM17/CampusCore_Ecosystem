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

test('enrollment drop buttons meet the minimum 44px touch target on mobile and desktop', () => {
  const sourceFile = readTsx('src/app/dashboard/enrollments/page.tsx');

  // Desktop table button
  const buttons = elements(sourceFile, 'Button');
  const desktopDrop = buttons.find((node) => {
    const text = node.getText(sourceFile);
    return text.includes('handleDrop') && text.includes('copy.dropCourse');
  });
  assert.ok(desktopDrop, 'desktop drop course button must exist');
  const desktopClasses = expressionText(attributes(desktopDrop, sourceFile).get('className'), sourceFile);
  assert.match(desktopClasses, /min-h-\[44px\]/, 'desktop drop button must declare min-h-[44px]');

  // Mobile card button
  const nativeButtons = elements(sourceFile, 'button');
  const mobileDrop = nativeButtons.find((node) => {
    const parent = node.parent && ts.isJsxElement(node.parent) ? node.parent : node;
    const text = parent.getText(sourceFile);
    return text.includes('handleDrop') && text.includes('copy.dropCourse');
  });
  assert.ok(mobileDrop, 'mobile drop course button must exist');
  const mobileClasses = expressionText(attributes(mobileDrop, sourceFile).get('className'), sourceFile);
  assert.match(mobileClasses, /min-h-\[44px\]/, 'mobile drop button must declare min-h-[44px]');
  assert.match(mobileClasses, /min-w-\[44px\]/, 'mobile drop button must declare min-w-[44px]');
});

test('thesis supervised group member removal and addition controls meet 44px touch target', () => {
  const sourceFile = readTsx('src/components/dashboard/thesis/SupervisedGroupMembers.tsx');
  const buttons = elements(sourceFile, 'Button');

  // Remove member button
  const removeBtn = buttons.find((node) => {
    const text = node.getText(sourceFile);
    return text.includes('remove(member.studentId)');
  });
  assert.ok(removeBtn, 'remove member button must exist');
  const removeClasses = expressionText(attributes(removeBtn, sourceFile).get('className'), sourceFile);
  assert.match(removeClasses, /min-h-\[44px\]/, 'remove member button must declare min-h-[44px]');
  assert.match(removeClasses, /min-w-\[44px\]/, 'remove member button must declare min-w-[44px]');

  // Add internal member button
  const addBtn = buttons.find((node) => {
    const text = node.getText(sourceFile);
    return text.includes('addInternal(');
  });
  assert.ok(addBtn, 'add internal member button must exist');
  const addClasses = expressionText(attributes(addBtn, sourceFile).get('className'), sourceFile);
  assert.match(addClasses, /min-h-\[44px\]/, 'add member button must declare min-h-[44px]');
});

test('announcement feed card share buttons meet 44px touch target without card-link conflicts', () => {
  const sourceFile = readTsx('src/components/announcements/feed/AnnouncementFeedCard.tsx');
  const buttons = elements(sourceFile, 'button');
  const shareButtons = buttons.filter((node) => {
    const text = node.getText(sourceFile);
    return text.includes('onClick={handleShare}');
  });
  assert.equal(shareButtons.length, 2, 'expected 2 share buttons (horizontal and vertical cards)');

  for (const btn of shareButtons) {
    const classes = expressionText(attributes(btn, sourceFile).get('className'), sourceFile);
    assert.match(
      classes,
      /min-h-\[44px\]|h-11/,
      'share button must declare min-h-[44px] or h-11',
    );
    assert.match(
      classes,
      /min-w-\[44px\]|w-11/,
      'share button must declare min-w-[44px] or w-11',
    );
  }
});
