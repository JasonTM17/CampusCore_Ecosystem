const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const CONTROL_FILES = [
  'src/app/dashboard/editor/page.tsx',
  'src/components/admissions/AdmissionsApplyPage.tsx',
  'src/components/admissions/AdmissionsReviewPage.tsx',
  'src/components/careers/CareersDeskPage.tsx',
  'src/components/learning/LearningConsolePage.tsx',
  'src/components/ui/rich-text-editor.tsx',
];

function readTsx(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function jsxAttributes(node) {
  return new Map(
    node.attributes.properties
      .filter(ts.isJsxAttribute)
      .map((attribute) => [attribute.name.getText(node.getSourceFile()), attribute]),
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

function hasAccessibleName(attributes, idLabels, node) {
  for (const name of ['aria-label', 'aria-labelledby']) {
    const value = attributes.get(name);
    if (value && value.initializer?.getText(node.getSourceFile()) !== 'undefined') return true;
  }

  const id = staticString(attributes.get('id'));
  if (id && idLabels.has(id)) return true;

  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isJsxElement(parent) &&
      parent.openingElement.tagName.getText(node.getSourceFile()) === 'label'
    ) {
      return true;
    }
  }

  return false;
}

function collectControlViolations(relativePath) {
  const sourceFile = readTsx(relativePath);
  const idLabels = new Set();
  const controls = [];

  function collectLabels(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(sourceFile) === 'label') {
        const htmlFor = staticString(jsxAttributes(node).get('htmlFor'));
        if (htmlFor) idLabels.add(htmlFor);
      }
    }
    ts.forEachChild(node, collectLabels);
  }

  function collectControls(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (['input', 'select', 'textarea'].includes(tag)) {
        const attributes = jsxAttributes(node);
        const type = staticString(attributes.get('type'));
        const className = staticString(attributes.get('className')) ?? '';
        const hidden =
          attributes.has('hidden') ||
          type === 'hidden' ||
          /(?:^|\s)hidden(?:\s|$)/.test(className);

        if (!hidden && !hasAccessibleName(attributes, idLabels, node)) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          controls.push(`${relativePath}:${line} <${tag}>`);
        }
      }
    }
    ts.forEachChild(node, collectControls);
  }

  collectLabels(sourceFile);
  collectControls(sourceFile);
  return controls;
}

function isReservedAttendancePage(filePath) {
  const parts = path.relative(sourceRoot, filePath).split(path.sep);
  return parts[0] === 'app' && parts.slice(1).some((part) =>
    part.toLowerCase().startsWith('attendance'),
  );
}

function sourceTsxFiles(directory = sourceRoot) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceTsxFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      files.push(absolutePath);
    }
  }
  return files.filter((filePath) => !isReservedAttendancePage(filePath));
}

function imageHasReservedSpace(attributes, node) {
  if (attributes.has('width') && attributes.has('height')) return true;

  const style = attributes.get('style');
  return Boolean(style?.initializer?.getText(node.getSourceFile()).includes('aspectRatio'));
}

test('the audited native form controls all have accessible names', () => {
  assert.equal(CONTROL_FILES.length, 6, 'the audited source scope stays explicit');

  const violations = CONTROL_FILES.flatMap(collectControlViolations);
  assert.deepEqual(violations, [], `unlabeled native form controls: ${violations.join(', ')}`);
});

test('native images reserve layout space with dimensions or an aspect ratio', () => {
  const violations = [];
  let imageCount = 0;

  for (const absolutePath of sourceTsxFiles()) {
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
    const sourceFile = readTsx(relativePath);

    function inspect(node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(sourceFile) === 'img'
      ) {
        imageCount += 1;
        if (!imageHasReservedSpace(jsxAttributes(node), node)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          violations.push(`${relativePath}:${line}`);
        }
      }
      ts.forEachChild(node, inspect);
    }

    inspect(sourceFile);
  }

  assert.ok(imageCount >= 21, `expected to inspect at least the 21 audited images; saw ${imageCount}`);
  assert.deepEqual(violations, [], `images without reserved layout space: ${violations.join(', ')}`);
});
