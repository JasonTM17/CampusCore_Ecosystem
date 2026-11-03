const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTsx(relativePath) {
  return ts.createSourceFile(relativePath, read(relativePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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

function className(node, sourceFile) {
  const attribute = attributes(node, sourceFile).get('className');
  if (!attribute?.initializer) return '';
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  const literals = [];
  function visit(current) {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      literals.push(current.text);
    }
    ts.forEachChild(current, visit);
  }
  visit(attribute.initializer);
  return literals.join(' ');
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

function ancestorText(node, sourceFile, tag) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    const opening = ts.isJsxElement(parent)
      ? parent.openingElement
      : ts.isJsxSelfClosingElement(parent)
        ? parent
        : null;
    if (opening && opening.tagName.getText(sourceFile) === tag) {
      return parent.getText(sourceFile);
    }
  }
  return '';
}

/** Effective control size in CSS pixels from the utility classes it carries. */
function dimension(classes, axis, fallback) {
  const explicit = classes.match(
    new RegExp(`(?:^|\\s)(?:min-)?${axis}-(\\d+|\\[[\\d.]+px\\])(?=\\s|$)`),
  );
  if (explicit) {
    return explicit[1].startsWith('[')
      ? Number.parseFloat(explicit[1].slice(1, -3))
      : Number(explicit[1]) * 4;
  }
  const padding = classes.match(/(?:^|\s)p-(\d+)(?=\s|$)/);
  if (padding) return Number(padding[1]) * 4 * 2 + 16;
  return fallback;
}

function assertTouchTarget(node, sourceFile, label, axis = 'height', fallback = 0) {
  const classes = className(node, sourceFile);
  const size = dimension(classes, axis === 'height' ? 'h' : 'w', fallback);
  assert.ok(size >= 44, `${label} measured ${size}px on ${axis}, below the 44px touch target (${classes})`);
}

test('the login controls meet the 44px touch target', () => {
  const sourceFile = readTsx('src/app/login/page.tsx');
  const buttons = elements(sourceFile, 'button');
  const links = elements(sourceFile, 'LocalizedLink');
  const anchors = elements(sourceFile, 'a');

  const passwordToggle = buttons.find((node) =>
    expressionText(attributes(node, sourceFile).get('aria-label'), sourceFile).includes('showPassword'),
  );
  assert.ok(passwordToggle, 'the password visibility toggle must exist');
  assertTouchTarget(passwordToggle, sourceFile, 'password visibility toggle', 'height');
  assertTouchTarget(passwordToggle, sourceFile, 'password visibility toggle', 'width');

  const dismiss = buttons.find((node) =>
    expressionText(attributes(node, sourceFile).get('aria-label'), sourceFile).includes('dismissNoticeAria'),
  );
  assert.ok(dismiss, 'the notice dismiss button must exist');
  assertTouchTarget(dismiss, sourceFile, 'notice dismiss', 'height');
  assertTouchTarget(dismiss, sourceFile, 'notice dismiss', 'width');

  const mismatch = links.find((node) =>
    expressionText(attributes(node, sourceFile).get('href'), sourceFile).includes('portalHref(mismatchPortal)'),
  );
  assert.ok(mismatch, 'the portal mismatch action must exist');
  assertTouchTarget(mismatch, sourceFile, 'portal mismatch action', 'height');

  const sso = anchors.find((node) =>
    expressionText(attributes(node, sourceFile).get('href'), sourceFile).includes('/session/login?return='),
  );
  assert.ok(sso, 'the SSO link must exist');
  assertTouchTarget(sso, sourceFile, 'SSO link', 'height');
});

test('the remaining sign-in controls meet the 44px touch target', () => {
  const sourceFile = readTsx('src/app/login/page.tsx');
  const buttons = elements(sourceFile, 'button');
  const links = elements(sourceFile, 'LocalizedLink');

  const quickFill = buttons.find((node) =>
    className(node, sourceFile).includes('shrink-0'),
  );
  assert.ok(quickFill, 'the demo quick-fill button must exist');
  assertTouchTarget(quickFill, sourceFile, 'demo quick-fill', 'height');

  const demoRows = buttons.filter((node) => {
    const classes = className(node, sourceFile);
    return classes.includes('w-full') && classes.includes('text-left');
  });
  assert.ok(demoRows.length > 0, 'the demo account rows must exist');
  for (const row of demoRows) {
    assertTouchTarget(row, sourceFile, 'demo account row', 'height');
  }

  for (const hrefValue of ['/forgot-password', '/register', '/']) {
    const link = links.find(
      (node) => staticString(attributes(node, sourceFile).get('href')) === hrefValue,
    );
    assert.ok(link, `the ${hrefValue} link must exist`);
    assertTouchTarget(link, sourceFile, `auth link ${hrefValue}`, 'height');
  }
});

test('the recovery and logged-out controls meet the 44px touch target', () => {
  const forgot = readTsx('src/app/forgot-password/page.tsx');
  const forgotBack = elements(forgot, 'LocalizedLink').filter(
    (node) => staticString(attributes(node, forgot).get('href')) === '/login',
  );
  assert.ok(forgotBack.length > 0, 'the forgot-password back link must exist');
  for (const link of forgotBack) {
    assertTouchTarget(link, forgot, 'back-to-sign-in link', 'height');
  }

  const reset = readTsx('src/app/reset-password/page.tsx');
  const toggles = elements(reset, 'button').filter((node) =>
    attributes(node, reset).has('aria-pressed'),
  );
  assert.ok(toggles.length > 0, 'the reset password toggles must exist');
  for (const toggle of toggles) {
    assertTouchTarget(toggle, reset, 'reset password visibility toggle', 'height');
    assertTouchTarget(toggle, reset, 'reset password visibility toggle', 'width');
  }
  const resetBack = elements(reset, 'LocalizedLink').filter(
    (node) => staticString(attributes(node, reset).get('href')) === '/login',
  );
  assert.equal(resetBack.length, 2, 'both reset-password back links must exist');
  for (const link of resetBack) {
    assertTouchTarget(link, reset, 'back-to-sign-in link', 'height');
  }

  const loggedOut = readTsx('src/app/session/logged-out/page.tsx');
  const home = elements(loggedOut, 'Link').find((node) =>
    className(node, loggedOut).includes('no-underline'),
  );
  assert.ok(home, 'the logged-out home link must exist');
  assertTouchTarget(home, loggedOut, 'logged-out home link', 'height');
});

test('the shared auth chrome toggles meet the 44px touch target', () => {
  const sourceFile = readTsx('src/components/LanguageToggle.tsx');
  let chipClassNode = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === 'chipClass'
    ) {
      chipClassNode = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(chipClassNode, 'the LanguageToggle chipClass must exist');

  const literals = [];
  function collect(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push(node.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(chipClassNode.initializer);
  const chipClasses = literals.join(' ');
  assert.ok(
    dimension(chipClasses, 'h', 0) >= 44,
    `the language chip measured ${dimension(chipClasses, 'h', 0)}px on height (${chipClasses})`,
  );
  assert.ok(
    dimension(chipClasses, 'w', 0) >= 44,
    `the language chip measured ${dimension(chipClasses, 'w', 0)}px on width (${chipClasses})`,
  );
});

test('the two-factor surface controls meet the 44px touch target', () => {
  const sourceFile = readTsx('src/app/dashboard/profile/page.tsx');
  const buttons = elements(sourceFile, 'button');

  const toggles = buttons.filter((node) =>
    attributes(node, sourceFile).has('aria-pressed'),
  );
  assert.ok(toggles.length > 0, 'the profile password toggles must exist');
  for (const toggle of toggles) {
    assertTouchTarget(toggle, sourceFile, 'password visibility toggle', 'height');
    assertTouchTarget(toggle, sourceFile, 'password visibility toggle', 'width');
  }

  const retry = buttons.find((node) =>
    className(node, sourceFile).includes('underline-offset-4'),
  );
  assert.ok(retry, 'the two-factor status retry must exist');
  assertTouchTarget(retry, sourceFile, 'two-factor status retry', 'height');
});

test('the title-less modal close meets the 44px touch target', () => {
  const sourceFile = readTsx('src/components/ui/modal.tsx');
  const close = elements(sourceFile, 'button').find((node) =>
    className(node, sourceFile).includes('absolute right-3 top-3'),
  );
  assert.ok(close, 'the title-less modal close button must exist');
  assertTouchTarget(close, sourceFile, 'title-less modal close', 'height');
  assertTouchTarget(close, sourceFile, 'title-less modal close', 'width');
});

test('the announcement search and category tabs meet the 44px touch target', () => {
  const sourceFile = readTsx('src/app/dashboard/announcements/page.tsx');
  const search = elements(sourceFile, 'Input').find((node) =>
    expressionText(attributes(node, sourceFile).get('aria-label'), sourceFile).includes('searchPlaceholder'),
  );
  assert.ok(search, 'the announcement search input must exist');
  assertTouchTarget(search, sourceFile, 'announcement search', 'height', 44);

  const tabs = elements(sourceFile, 'button').filter((node) =>
    attributes(node, sourceFile).has('aria-pressed'),
  );
  assert.ok(tabs.length > 0, 'the announcement category tabs must exist');
  for (const tab of tabs) {
    assertTouchTarget(tab, sourceFile, 'announcement category tab', 'height');
  }
});

test('the auth shell keeps one level-one heading at every width', () => {
  const sourceFile = readTsx('src/components/auth/AuthShell.tsx');
  const shell = read('src/components/auth/AuthShell.tsx');
  const headings = elements(sourceFile, 'h1');
  assert.equal(headings.length, 2, 'the shell needs a desktop heading and a narrow-width heading');

  const classes = headings.map((node) => className(node, sourceFile));
  assert.ok(
    classes.some((value) => value.includes('sr-only') && value.includes('lg:hidden')),
    'the narrow-width heading must be screen-reader only and hidden from lg up',
  );
  assert.ok(
    classes.some((value) => !value.includes('sr-only')),
    'the desktop heading must remain visible',
  );

  const desktopHeading = headings.find((node) => !className(node, sourceFile).includes('sr-only'));
  const desktopSection = ancestorText(desktopHeading, sourceFile, 'section');
  assert.match(desktopSection, /hidden/, 'the desktop heading must live in the panel hidden below lg');
  assert.match(desktopSection, /lg:flex/);

  assert.doesNotMatch(shell, /SectionEyebrow/, 'the marketing eyebrow must not render');
  assert.doesNotMatch(shell, /\bfeatures\b/, 'the marketing feature list must not render');
  assert.doesNotMatch(shell, /\beyebrow\b/, 'the auth shell must not take eyebrow copy');
});

test('the login form keeps one heading and drops the duplicated sentences', () => {
  const page = read('src/app/login/page.tsx');
  const sourceFile = readTsx('src/app/login/page.tsx');
  assert.doesNotMatch(page, /portalCopy\.destination/, 'the portal destination sentence is secondary copy');
  assert.doesNotMatch(page, /portalCopy\.subheading/, 'the subheading duplicates the shell description');
  assert.doesNotMatch(page, /eyebrow=\{portalCopy\.eyebrow\}/, 'the shell eyebrow prop is retired');
  assert.doesNotMatch(page, /features=\{portalCopy\.featureTitles/, 'the shell feature list is retired');
  assert.equal(elements(sourceFile, 'h2').length, 1, 'the form keeps exactly one heading');
});

test('the recovery and signup screens no longer pass marketing props', () => {
  for (const file of [
    'src/app/forgot-password/page.tsx',
    'src/app/reset-password/page.tsx',
    'src/app/register/page.tsx',
  ]) {
    const page = read(file);
    assert.doesNotMatch(page, /eyebrow=\{copy\.eyebrow\}/, `${file} still passes the shell eyebrow`);
    assert.doesNotMatch(page, /features=\{/, `${file} still passes the shell feature list`);
    assert.doesNotMatch(page, /copy\.sectionEyebrow/, `${file} still renders a section eyebrow`);
  }
});

test('the sign-out screen is one announced status line with one heading', () => {
  const sourceFile = readTsx('src/app/dashboard/sign-out/page.tsx');
  const page = read('src/app/dashboard/sign-out/page.tsx');
  assert.equal(elements(sourceFile, 'h1').length, 1, 'the sign-out screen needs exactly one h1');
  assert.match(page, /role="status"/, 'the status line must announce itself');
  assert.match(page, /aria-live="polite"/);
  assert.doesNotMatch(page, /signOutPage\.eyebrow/);
  assert.doesNotMatch(page, /signOutPage\.description/);
  assert.doesNotMatch(page, /signOutPage\.progress/);
});
