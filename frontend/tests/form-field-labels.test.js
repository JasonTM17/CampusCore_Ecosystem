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

function descendants(sourceFile, node) {
  const root = node.parent && ts.isJsxElement(node.parent) ? node.parent : node;
  const start = root.getStart(sourceFile);
  const end = root.getEnd();
  const found = [];
  function visit(current) {
    if (
      current !== node &&
      (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) &&
      current.getStart(sourceFile) > start &&
      current.getStart(sourceFile) < end
    ) {
      found.push(current);
    }
    ts.forEachChild(current, visit);
  }
  visit(root);
  return found;
}

function textOf(node, sourceFile) {
  return node.parent && ts.isJsxElement(node.parent) ? node.parent.getText(sourceFile) : node.getText(sourceFile);
}

test('the careers opportunity title is associated with a label', () => {
  const sourceFile = readTsx('src/components/careers/CareersDeskPage.tsx');
  const input = elements(sourceFile, 'Input').find(
    (node) => staticString(attributes(node, sourceFile).get('data-testid')) === 'careers-opp-title-input',
  );
  assert.ok(input, 'the opportunity title input must exist');

  const id = staticString(attributes(input, sourceFile).get('id'));
  assert.ok(id, 'the opportunity title input needs an id');
  const label = labelsByTarget(sourceFile).get(id);
  assert.ok(label, `a label must reference the opportunity title input (${id})`);
  assert.match(textOf(label, sourceFile), /titleLabel/, 'the label must use the title copy');
});

test('each admissions checklist row names its fields and result', () => {
  const sourceFile = readTsx('src/components/admissions/AdmissionsReviewPage.tsx');
  const checklist = elements(sourceFile, 'div').find(
    (node) => staticString(attributes(node, sourceFile).get('data-testid')) === 'admissions-checklist',
  );
  assert.ok(checklist, 'the checklist container must exist');

  const controls = descendants(sourceFile, checklist);
  const selects = controls.filter((node) => node.tagName.getText(sourceFile) === 'select');
  assert.ok(selects.length > 0, 'the checklist must render a result select');

  for (const select of selects) {
    const name = expressionText(attributes(select, sourceFile).get('aria-label'), sourceFile);
    assert.match(name, /index/, 'each result select must include its row number in the accessible name');

    let fieldset = null;
    for (let parent = select.parent; parent; parent = parent.parent) {
      const opening = ts.isJsxElement(parent)
        ? parent.openingElement
        : ts.isJsxSelfClosingElement(parent)
          ? parent
          : null;
      if (opening && opening.tagName.getText(sourceFile) === 'fieldset') {
        fieldset = opening;
        break;
      }
    }
    assert.ok(fieldset, 'each checklist row must be grouped in a fieldset');
    assert.match(textOf(fieldset, sourceFile), /<legend/, 'each checklist fieldset needs a legend');
  }

  const inputs = controls.filter((node) => node.tagName.getText(sourceFile) === 'Input');
  assert.ok(inputs.length >= 2, 'the checklist must render item and note inputs');
  for (const input of inputs) {
    const name = expressionText(attributes(input, sourceFile).get('aria-label'), sourceFile);
    assert.match(name, /index/, 'each checklist input must include its row number in the accessible name');
  }
});

test('the create-assignment fields are associated with labels', () => {
  const sourceFile = readTsx('src/components/learning/LearningConsolePage.tsx');
  const modal = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'AssignmentModal',
  );
  assert.ok(modal, 'the AssignmentModal component must exist');

  const labels = labelsByTarget(sourceFile);
  const inputs = descendants(sourceFile, modal);
  for (const key of ['assignmentTitle', 'descriptionField', 'maxScore']) {
    const input = inputs.find(
      (node) =>
        node.tagName.getText(sourceFile) === 'Input' &&
        expressionText(attributes(node, sourceFile).get('placeholder'), sourceFile).includes(key),
    );
    assert.ok(input, `the ${key} input must exist`);

    const id = staticString(attributes(input, sourceFile).get('id'));
    assert.ok(id, `the ${key} input needs an id`);
    const label = labels.get(id);
    assert.ok(label, `the ${key} input needs a label`);
    assert.match(textOf(label, sourceFile), new RegExp(key), `the label must use the ${key} copy`);
  }
});
