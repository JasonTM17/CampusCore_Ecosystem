const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assertPatterns(relPath, patterns) {
  const source = read(relPath);

  for (const pattern of patterns) {
    assert.match(source, pattern, `${relPath} is missing expected pattern: ${pattern}`);
  }
}

function walkFiles(dir, predicate) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, predicate));
      continue;
    }

    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function getJsxTagName(node) {
  if (!node.tagName) {
    return '';
  }

  if (ts.isIdentifier(node.tagName)) {
    return node.tagName.text;
  }

  if (ts.isPropertyAccessExpression(node.tagName)) {
    return node.tagName.name.text;
  }

  return node.tagName.getText();
}

function getAttributeName(attribute) {
  return ts.isJsxAttribute(attribute) ? attribute.name.text : '';
}

function getAttributeValue(attribute) {
  if (!ts.isJsxAttribute(attribute)) {
    return null;
  }

  if (!attribute.initializer) {
    return '';
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text.trim();
  }

  if (ts.isJsxExpression(attribute.initializer)) {
    const expression = attribute.initializer.expression;
    if (!expression) {
      return '';
    }

    if (expression.kind === ts.SyntaxKind.TrueKeyword) {
      return 'true';
    }

    if (expression.kind === ts.SyntaxKind.FalseKeyword) {
      return 'false';
    }

    return getNodeTextContent(expression).trim() || null;
  }

  return null;
}

function hasMeaningfulExpressionText(node) {
  if (!node) {
    return false;
  }

  if (
    ts.isStringLiteralLike(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isNumericLiteral(node)
  ) {
    return node.getText().replace(/['"`]/g, '').trim().length > 0;
  }

  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text.trim().length > 0 ||
      node.templateSpans.some(
        (span) =>
          hasMeaningfulExpressionText(span.expression) ||
          span.literal.text.trim().length > 0,
      )
    );
  }

  if (ts.isParenthesizedExpression(node)) {
    return hasMeaningfulExpressionText(node.expression);
  }

  if (ts.isConditionalExpression(node)) {
    return (
      hasMeaningfulExpressionText(node.whenTrue) ||
      hasMeaningfulExpressionText(node.whenFalse)
    );
  }

  if (ts.isBinaryExpression(node)) {
    return (
      hasMeaningfulExpressionText(node.left) ||
      hasMeaningfulExpressionText(node.right)
    );
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some(hasMeaningfulExpressionText);
  }

  if (ts.isCallExpression(node)) {
    return true;
  }

  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    return getNodeTextContent(node).trim().length > 0;
  }

  return false;
}

function getNodeTextContent(node) {
  if (!node) {
    return '';
  }

  if (ts.isJsxText(node)) {
    return node.getText().replace(/\s+/g, ' ').trim();
  }

  if (ts.isJsxExpression(node)) {
    return hasMeaningfulExpressionText(node.expression) ? node.getText() : '';
  }

  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    return node.children.map(getNodeTextContent).join(' ').trim();
  }

  if (
    ts.isStringLiteralLike(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isNumericLiteral(node)
  ) {
    return node.getText().replace(/['"`]/g, '').trim();
  }

  if (ts.isTemplateExpression(node)) {
    const segments = [node.head.text, ...node.templateSpans.flatMap((span) => [getNodeTextContent(span.expression), span.literal.text])];
    return segments.join(' ').trim();
  }

  if (ts.isConditionalExpression(node)) {
    return `${getNodeTextContent(node.whenTrue)} ${getNodeTextContent(node.whenFalse)}`.trim();
  }

  if (ts.isBinaryExpression(node)) {
    return `${getNodeTextContent(node.left)} ${getNodeTextContent(node.right)}`.trim();
  }

  return '';
}

function getJsxAttributes(node) {
  if (ts.isJsxSelfClosingElement(node)) {
    return node.attributes.properties;
  }

  if (ts.isJsxElement(node)) {
    return node.openingElement.attributes.properties;
  }

  return [];
}

function hasAccessibleName(node) {
  return getJsxAttributes(node).some((attribute) => {
    const name = getAttributeName(attribute);
    if (name !== 'aria-label' && name !== 'aria-labelledby') {
      return false;
    }

    const value = getAttributeValue(attribute);
    return value === null || value.length > 0;
  });
}

function hasVisibleOrReadableText(node) {
  if (ts.isJsxSelfClosingElement(node)) {
    return false;
  }

  return node.children.some(
    (child) => getNodeTextContent(child).trim().length > 0,
  );
}

function hasSpreadAttributes(node) {
  return getJsxAttributes(node).some((attribute) => ts.isJsxSpreadAttribute(attribute));
}

function isHiddenFromAssistiveTech(node) {
  return getJsxAttributes(node).some((attribute) => {
    if (getAttributeName(attribute) === 'hidden') {
      return true;
    }

    return getAttributeName(attribute) === 'aria-hidden' && getAttributeValue(attribute) === 'true';
  });
}

function isInteractiveControl(node) {
  const tagName = getJsxTagName(node);
  if (['button', 'Button', 'a', 'Link'].includes(tagName)) {
    return true;
  }

  return getJsxAttributes(node).some((attribute) => {
    if (getAttributeName(attribute) !== 'role') {
      return false;
    }

    const value = getAttributeValue(attribute);
    if (!value) {
      return false;
    }

    return value
      .split(/\s+/)
      .some((role) => ['button', 'link', 'menuitem', 'tab'].includes(role));
  });
}

function collectButtonAuditFindings() {
  const files = walkFiles(path.join(root, 'src'), (filePath) =>
    filePath.endsWith('.tsx'),
  );
  const findings = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    function visit(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = getJsxTagName(node);
        if (
          isInteractiveControl(node) &&
          !isHiddenFromAssistiveTech(node) &&
          !hasAccessibleName(node) &&
          !hasSpreadAttributes(node) &&
          !hasVisibleOrReadableText(node)
        ) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          findings.push(
            `${path.relative(root, filePath).replace(/\\/g, '/')}:${line} <${tagName}> is icon-only or empty without an accessible name`,
          );
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return findings;
}

function collectImplementedAppRoutes() {
  const appRoot = path.join(root, 'src', 'app');
  return walkFiles(appRoot, (filePath) => path.basename(filePath) === 'page.tsx')
    .map((filePath) => {
      const routePath = path
        .relative(appRoot, path.dirname(filePath))
        .replace(/\\/g, '/');

      return routePath === '' ? '/' : `/${routePath}`;
    })
    .sort();
}

function collectCoveredE2ERoutes() {
  const source = read('e2e/full-stack.spec.ts');
  const coveredRoutes = new Set(['/admin', '/dashboard/lecturer/grades/[id]']);

  const publicRoutesMatch = source.match(/const publicRoutes = \[([\s\S]*?)\];/);
  if (publicRoutesMatch) {
    for (const match of publicRoutesMatch[1].matchAll(/'([^']+)'/g)) {
      coveredRoutes.add(match[1]);
    }
  }

  for (const match of source.matchAll(/path:\s*'([^']+)'/g)) {
    coveredRoutes.add(match[1]);
  }

  return [...coveredRoutes].sort();
}

test('ThemeProvider always renders through the context provider', () => {
  const source = read('src/components/ThemeProvider.tsx');

  assert.match(source, /ThemeContext\.Provider/);
  assert.doesNotMatch(
    source,
    /if\s*\(!mounted\)\s*\{\s*return children;\s*\}/s,
  );
});

test('dashboard chrome no longer exposes dead internal links', () => {
  const source = read('src/app/dashboard/layout.tsx');

  assert.doesNotMatch(source, /\/admin\/students/);
  assert.doesNotMatch(source, /\/dashboard\/notifications/);
  assert.doesNotMatch(source, /\/dashboard\/settings/);
  assert.match(source, /aria-label="Toggle notifications panel"/);
  assert.match(source, /aria-label="Toggle profile menu"/);
});

test('admin hub only links to implemented routes', () => {
  const source = read('src/app/admin/page.tsx');

  assert.doesNotMatch(source, /\/admin\/students/);
});

test('homepage copy avoids demo placeholders and dead hrefs', () => {
  const source = read('src/app/page.tsx');
  const deadHrefPattern = new RegExp('href="' + '#"');
  const contactSalesPattern = new RegExp(['Contact', 'Sales'].join(' '));

  assert.doesNotMatch(source, deadHrefPattern);
  assert.doesNotMatch(source, /50K\+/);
  assert.doesNotMatch(source, /Kubernetes-ready/);
  assert.doesNotMatch(source, contactSalesPattern);
  assert.match(source, /href=\{user \? '\/dashboard' : '\/login'\}/);
});

test('auth client uses cookie sessions and CSRF headers', () => {
  const apiSource = read('src/lib/api.ts');
  const authContextSource = read('src/context/AuthContext.tsx');

  assert.match(apiSource, /withCredentials:\s*true/);
  assert.match(apiSource, /cc_csrf/);
  assert.match(apiSource, /X-CSRF-Token/);
  assert.match(apiSource, /await api\.post\(\s*'\/auth\/logout',\s*\{\}\s*\);/s);
  assert.match(apiSource, /skipAuthRefresh:\s*true/);
  assert.doesNotMatch(apiSource, /localStorage\.(getItem|setItem|removeItem)/);
  assert.doesNotMatch(
    authContextSource,
    /localStorage\.(getItem|setItem|removeItem)/,
  );
});

test('shared UI no longer contains obvious mojibake arrows', () => {
  const source = read('src/components/ui/data-table.tsx');

  assert.doesNotMatch(source, /â†‘|â†“/);
});

test('root layout configures a latin-ext font stack for Vietnamese UI copy', () => {
  const layoutSource = read('src/app/layout.tsx');
  const globalsSource = read('src/app/globals.css');

  assert.match(layoutSource, /next\/font\/google/);
  assert.match(layoutSource, /Inter\(/);
  assert.match(layoutSource, /subsets:\s*\[\s*"latin"\s*,\s*"latin-ext"\s*\]/);
  assert.match(layoutSource, /variable:\s*"--font-sans"/);
  assert.match(globalsSource, /font-family:\s*var\(--font-sans\),/);
  assert.match(globalsSource, /button,\s*[\r\n]+\s*input,\s*[\r\n]+\s*select,\s*[\r\n]+\s*textarea\s*\{/);
});

test('all button-like controls expose text or an accessible name across frontend routes', () => {
  const findings = collectButtonAuditFindings();

  assert.deepEqual(
    findings,
    [],
    `Found icon-only controls without accessible names:\n${findings.map((finding) => `- ${finding}`).join('\n')}`,
  );
});

test('every implemented app route is covered by fast E2E smoke', () => {
  const implementedRoutes = collectImplementedAppRoutes();
  const coveredRoutes = collectCoveredE2ERoutes();

  assert.deepEqual(
    implementedRoutes,
    coveredRoutes,
    [
      'Fast E2E route coverage is out of sync with implemented app routes.',
      `Implemented: ${implementedRoutes.join(', ')}`,
      `Covered: ${coveredRoutes.join(', ')}`,
    ].join('\n'),
  );
});

test('modal exposes dialog semantics and a labeled close control', () => {
  const source = read('src/components/ui/modal.tsx');

  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-label="Close modal"/);
});

test('key frontend surfaces label icon-only buttons', () => {
  assertPatterns('src/app/login/page.tsx', [
    /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/,
  ]);
  assertPatterns('src/app/reset-password/page.tsx', [
    /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/,
  ]);
  assertPatterns('src/app/dashboard/profile/page.tsx', [
    /aria-label="Upload profile photo"/,
  ]);
  assertPatterns('src/app/dashboard/invoices/page.tsx', [
    /aria-label="Close invoice details"/,
  ]);
  assertPatterns('src/app/admin/academic-years/page.tsx', [
    /aria-label=\{`Edit academic year \$\{year\.year\}`\}/,
    /aria-label=\{`Delete academic year \$\{year\.year\}`\}/,
  ]);
  assertPatterns('src/app/admin/announcements/page.tsx', [
    /aria-label=\{`Delete announcement \$\{a\.title\}`\}/,
    /aria-label="Close new announcement form"/,
  ]);
  assertPatterns('src/app/admin/classrooms/page.tsx', [
    /aria-label=\{`Edit classroom \$\{room\.building\} \$\{room\.roomNumber\}`\}/,
    /aria-label=\{`Delete classroom \$\{room\.building\} \$\{room\.roomNumber\}`\}/,
  ]);
  assertPatterns('src/app/admin/courses/page.tsx', [
    /aria-label=\{`Edit course \$\{course\.code\}`\}/,
    /aria-label=\{`Delete course \$\{course\.code\}`\}/,
  ]);
  assertPatterns('src/app/admin/departments/page.tsx', [
    /aria-label=\{`Edit department \$\{dept\.name\}`\}/,
    /aria-label=\{`Delete department \$\{dept\.name\}`\}/,
  ]);
  assertPatterns('src/app/admin/enrollments/page.tsx', [
    /aria-label=\{`View enrollment details for \$\{enrollment\.student\?/,
    /aria-label=\{`Delete enrollment for \$\{enrollment\.student\?/,
    /aria-label="Close enrollment details"/,
  ]);
  assertPatterns('src/app/admin/invoices/page.tsx', [
    /aria-label=\{`View invoice \$\{invoice\.invoiceNumber\}`\}/,
    /aria-label=\{`Delete invoice \$\{invoice\.invoiceNumber\}`\}/,
    /aria-label="Close invoice details"/,
  ]);
  assertPatterns('src/app/admin/lecturers/page.tsx', [
    /aria-label=\{`Edit lecturer \$\{lecturer\.employeeId\}`\}/,
    /aria-label=\{`Delete lecturer \$\{lecturer\.employeeId\}`\}/,
  ]);
  assertPatterns('src/app/admin/sections/page.tsx', [
    /aria-label=\{`Edit section \$\{section\.sectionNumber\} for \$\{section\.course\?\.code \|\| 'course'\}`\}/,
    /aria-label=\{`Delete section \$\{section\.sectionNumber\} for \$\{section\.course\?\.code \|\| 'course'\}`\}/,
    /aria-label=\{`Remove schedule \$\{idx \+ 1\}`\}/,
  ]);
  assertPatterns('src/app/admin/semesters/page.tsx', [
    /aria-label=\{`Edit semester \$\{semester\.name\}`\}/,
    /aria-label=\{`Delete semester \$\{semester\.name\}`\}/,
  ]);
  assertPatterns('src/app/admin/users/page.tsx', [
    /aria-label=\{`Edit user \$\{u\.firstName\} \$\{u\.lastName\}`\}/,
    /aria-label=\{`Delete user \$\{u\.firstName\} \$\{u\.lastName\}`\}/,
  ]);
  assertPatterns('src/components/ui/data-table.tsx', [
    /aria-label="Go to previous page"/,
    /aria-label="Go to next page"/,
  ]);
  assertPatterns('src/app/admin/academic-years/page.tsx', [
    /aria-label="Back to admin dashboard"/,
  ]);
  assertPatterns('src/app/admin/analytics/page.tsx', [
    /aria-label="Back to admin dashboard"/,
  ]);
  assertPatterns('src/app/admin/classrooms/page.tsx', [
    /aria-label="Back to admin dashboard"/,
  ]);
  assertPatterns('src/app/admin/courses/page.tsx', [
    /aria-label="Back to admin dashboard"/,
  ]);
  assertPatterns('src/app/admin/departments/page.tsx', [
    /aria-label="Back to admin dashboard"/,
  ]);
  assertPatterns('src/app/admin/lecturers/page.tsx', [
    /aria-label="Back to admin dashboard"/,
  ]);
  assertPatterns('src/app/admin/semesters/page.tsx', [
    /aria-label="Back to admin dashboard"/,
  ]);
  assertPatterns('src/app/dashboard/lecturer/announcements/page.tsx', [
    /aria-label="Back to lecturer dashboard"/,
  ]);
  assertPatterns('src/app/dashboard/lecturer/grades/\[id\]/page.tsx', [
    /aria-label="Back to grade management"/,
  ]);
});
