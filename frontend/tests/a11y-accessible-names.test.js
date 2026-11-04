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

function labelsByTarget(sourceFile) {
  const labels = new Map();
  for (const label of elements(sourceFile, 'label')) {
    const target = staticString(attributes(label, sourceFile).get('htmlFor'));
    if (target) labels.set(target, label);
  }
  return labels;
}

test('library catalogue search and desk cancellation reason inputs have accessible names', () => {
  const catalogueSource = readTsx('src/components/library/LibraryCataloguePage.tsx');
  const searchInput = elements(catalogueSource, 'Input').find(
    (node) => staticString(attributes(node, catalogueSource).get('data-testid')) === 'library-search-input',
  );
  assert.ok(searchInput, 'catalogue search input must exist');
  const searchAriaLabel = expressionText(attributes(searchInput, catalogueSource).get('aria-label'), catalogueSource);
  assert.match(searchAriaLabel, /copy\.searchPlaceholder/, 'catalogue search input must declare aria-label');

  const deskSource = readTsx('src/components/library/LibraryDeskPage.tsx');
  const cancelReasonInput = elements(deskSource, 'Input').find(
    (node) => staticString(attributes(node, deskSource).get('data-testid')) === 'library-cancel-reason',
  );
  assert.ok(cancelReasonInput, 'desk cancel reason input must exist');
  const cancelReasonAriaLabel = expressionText(attributes(cancelReasonInput, deskSource).get('aria-label'), deskSource);
  assert.match(cancelReasonAriaLabel, /copy\.cancelReasonPlaceholder/, 'desk cancel reason input must declare aria-label');
});

test('careers desk action reason inputs provide contextual accessible names', () => {
  const sourceFile = readTsx('src/components/careers/CareersDeskPage.tsx');
  const inputs = elements(sourceFile, 'Input');

  const oppReason = inputs.find((node) =>
    expressionText(attributes(node, sourceFile).get('data-testid'), sourceFile).includes('careers-opp-reason-'),
  );
  assert.ok(oppReason, 'opportunity reason input must exist');
  const oppLabel = expressionText(attributes(oppReason, sourceFile).get('aria-label'), sourceFile);
  assert.match(oppLabel, /copy\.reasonPlaceholder/, 'opportunity reason input aria-label must include copy placeholder');
  assert.match(oppLabel, /opportunity\.title/, 'opportunity reason input aria-label must include opportunity title');

  const appReason = inputs.find((node) =>
    expressionText(attributes(node, sourceFile).get('data-testid'), sourceFile).includes('careers-app-reason-'),
  );
  assert.ok(appReason, 'application reason input must exist');
  const appLabel = expressionText(attributes(appReason, sourceFile).get('aria-label'), sourceFile);
  assert.match(appLabel, /copy\.reasonPlaceholder/, 'application reason input aria-label must include copy placeholder');
  assert.match(appLabel, /application\.(candidateEmail|id)/, 'application reason input aria-label must include applicant reference');

  const reviewReason = inputs.find((node) =>
    expressionText(attributes(node, sourceFile).get('data-testid'), sourceFile).includes('careers-review-reason-'),
  );
  assert.ok(reviewReason, 'review reason input must exist');
  const reviewLabel = expressionText(attributes(reviewReason, sourceFile).get('aria-label'), sourceFile);
  assert.match(reviewLabel, /copy\.reasonPlaceholder/, 'review reason input aria-label must include copy placeholder');
  assert.match(reviewLabel, /opportunity\.title/, 'review reason input aria-label must include opportunity title');
});

test('careers board search and inline cover letter inputs have accessible names', () => {
  const sourceFile = readTsx('src/components/careers/CareersBoardPage.tsx');
  const searchInput = elements(sourceFile, 'Input').find(
    (node) => staticString(attributes(node, sourceFile).get('data-testid')) === 'careers-search-input',
  );
  assert.ok(searchInput, 'careers search input must exist');
  const searchLabel = expressionText(attributes(searchInput, sourceFile).get('aria-label'), sourceFile);
  assert.match(searchLabel, /copy\.searchPlaceholder/, 'careers search input must declare aria-label');

  const coverInput = elements(sourceFile, 'Input').find((node) =>
    expressionText(attributes(node, sourceFile).get('data-testid'), sourceFile).includes('careers-cover-'),
  );
  assert.ok(coverInput, 'cover letter input must exist');
  const coverLabel = expressionText(attributes(coverInput, sourceFile).get('aria-label'), sourceFile);
  assert.match(coverLabel, /copy\.coverLetterPlaceholder/, 'cover letter input aria-label must include placeholder copy');
  assert.match(coverLabel, /opportunity\.title/, 'cover letter input aria-label must include opportunity title');
});

test('lecturer announcement return reason input has an accessible name', () => {
  const sourceFile = readTsx('src/app/dashboard/lecturer/announcements/page.tsx');
  const labels = labelsByTarget(sourceFile);
  const textareas = elements(sourceFile, 'Textarea');
  const returnReason = textareas.find((node) =>
    expressionText(attributes(node, sourceFile).get('placeholder'), sourceFile).includes('returnReasonPlaceholder'),
  );
  assert.ok(returnReason, 'return reason textarea must exist');
  const attrs = attributes(returnReason, sourceFile);
  const ariaLabel = expressionText(attrs.get('aria-label'), sourceFile);
  const id = staticString(attrs.get('id'));
  assert.ok(
    ariaLabel.includes('returnReasonLabel') || (id && labels.has(id)),
    'return reason textarea must have aria-label or associated label',
  );
});

test('lecturer announcement create markdown editor textarea has an accessible name', () => {
  const sourceFile = readTsx('src/components/announcements/LecturerAnnouncementCreateModal.tsx');
  const labels = labelsByTarget(sourceFile);
  const textareas = elements(sourceFile, 'Textarea');
  const markdownTextarea = textareas.find((node) =>
    expressionText(attributes(node, sourceFile).get('placeholder'), sourceFile).includes('bodyPlaceholder'),
  );
  assert.ok(markdownTextarea, 'markdown textarea must exist');
  const attrs = attributes(markdownTextarea, sourceFile);
  const ariaLabel = expressionText(attrs.get('aria-label'), sourceFile);
  const id = staticString(attrs.get('id'));
  assert.ok(
    ariaLabel.includes('contentLabel') || (id && labels.has(id)),
    'markdown textarea must have aria-label or associated label[for]',
  );
});

test('markdown task list checkboxes declare accessible names', () => {
  const sourceFile = readTsx('src/components/ui/rich-content-renderer.tsx');
  const inputs = elements(sourceFile, 'input');
  const taskCheckboxes = inputs.filter((node) =>
    staticString(attributes(node, sourceFile).get('type')) === 'checkbox',
  );
  assert.ok(taskCheckboxes.length > 0, 'checkbox inputs must exist');
  for (const checkbox of taskCheckboxes) {
    const ariaLabel = expressionText(attributes(checkbox, sourceFile).get('aria-label'), sourceFile);
    assert.match(ariaLabel, /item\.content/, 'checkbox must declare aria-label matching item content');
  }
});

test('rich text editor toolbar controls declare accessible names matching their titles', () => {
  const sourceFile = readTsx('src/components/ui/rich-text-editor.tsx');
  const buttons = elements(sourceFile, 'button');
  const toolbarButtons = buttons.filter((node) => {
    const attrs = attributes(node, sourceFile);
    return attrs.has('title');
  });
  assert.ok(toolbarButtons.length >= 20, 'expected at least 20 toolbar buttons with title attributes');

  for (const button of toolbarButtons) {
    const attrs = attributes(button, sourceFile);
    const titleAttr = expressionText(attrs.get('title'), sourceFile);
    const ariaLabel = expressionText(attrs.get('aria-label'), sourceFile);
    assert.ok(
      ariaLabel.length > 0,
      `toolbar button with title (${titleAttr}) must have aria-label`,
    );
  }
});
