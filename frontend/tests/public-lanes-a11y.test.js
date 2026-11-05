const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const {
  createRuntime,
  elements,
  flush,
  loadMessages,
  loadTs,
} = require('./dashboard-shell-harness');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTsx(relativePath) {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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
    ts.isJsxExpression(attribute.initializer)
    && attribute.initializer.expression
    && ts.isStringLiteral(attribute.initializer.expression)
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

function jsxElements(sourceFile, tag) {
  const found = [];
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(sourceFile) === tag
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function controlByTestId(sourceFile, tag, testId) {
  return jsxElements(sourceFile, tag).find(
    (node) => staticString(attributes(node, sourceFile).get('data-testid')) === testId,
  );
}

function controlById(sourceFile, tag, id) {
  return jsxElements(sourceFile, tag).find(
    (node) => staticString(attributes(node, sourceFile).get('id')) === id,
  );
}

function renderStateBlock() {
  return loadTs('src/components/ui/state-block.tsx', {
    '@/i18n': {
      useI18n: () => ({
        messages: {
          common: {
            actions: { retry: 'Retry' },
            states: { loadingContent: 'Loading' },
          },
        },
      }),
    },
    '@/components/ui/button': {
      Button: ({ children, onClick }) => React.createElement(
        'button',
        { type: 'button', onClick },
        children,
      ),
    },
  });
}

const stateStubs = {
  EmptyState: ({ title }) => React.createElement('div', { 'data-state': 'empty' }, title),
  ErrorState: ({ title, description, onRetry }) => React.createElement(
    'div',
    { 'data-state': 'error', role: 'alert' },
    title,
    description,
    onRetry
      ? React.createElement('button', { type: 'button', onClick: onRetry }, 'retry')
      : null,
  ),
  LoadingState: () => React.createElement('div', { 'data-state': 'loading' }),
};

function pageStubs(runtime, extra) {
  return {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    sonner: { toast: { success() {}, error() {} } },
    '@/context/AuthContext': {
      useRequireAuth: () => ({ isLoading: false, hasAccess: true }),
    },
    '@/components/ui/button': {
      Button: ({ children, onClick, ...rest }) => React.createElement(
        'button',
        { type: 'button', onClick, disabled: rest.disabled, 'data-testid': rest['data-testid'] },
        children,
      ),
    },
    '@/components/ui/input': {
      Input: (props) => React.createElement('input', {
        value: props.value ?? '',
        onChange: props.onChange,
        'data-testid': props['data-testid'],
        'aria-label': props['aria-label'],
      }),
    },
    '@/components/ui/page-header': {
      PageHeader: ({ title, actions }) => React.createElement(
        'header',
        null,
        React.createElement('h1', null, title),
        actions,
      ),
      SectionEyebrow: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/state-block': stateStubs,
    '@/components/ProtectedRoute': {
      WorkspaceForbiddenState: () => React.createElement('div', { 'data-state': 'forbidden' }),
    },
    '@/components/ui/status': { statusToneClass: () => '' },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        messages: loadMessages('vi'),
        formatDateTime: (value) => String(value),
        href: (value) => value,
      }),
    },
    ...extra,
  };
}

async function settle(runtime, Page) {
  let tree = null;
  for (let index = 0; index < 8; index += 1) {
    const rendered = runtime.render(Page, {});
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
    await flush();
  }
  return tree;
}

test('public content lanes expose a skip link and a main landmark', () => {
  const { PublicMain } = loadTs('src/components/content/PublicMain.tsx', {
    '@/i18n': {
      useI18n: () => ({ messages: { home: { skipToContent: 'Skip to content' } } }),
    },
  });
  const html = renderToStaticMarkup(React.createElement(
    PublicMain,
    null,
    React.createElement('p', null, 'Lane content'),
  ));

  assert.match(html, /<a[^>]+href="#main-content"/, 'the lane needs a skip link');
  assert.match(html, /class="portal-skip-link"/, 'the skip link uses the shared skip styles');
  assert.match(html, /<main[^>]+id="main-content"/, 'the skip link target is the main landmark');
  assert.match(html, /<main[^>]+tabindex="-1"/, 'the main landmark receives programmatic focus');

  const chrome = read('src/components/content/PublicChrome.tsx');
  assert.match(chrome, /<a href="#main-content" className="portal-skip-link">/);
  assert.match(chrome, /<main id="main-content"/);

  for (const file of [
    'src/app/library/page.tsx',
    'src/app/careers/page.tsx',
    'src/app/apply/page.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /PublicMain/, `${file} must render the shared public main landmark`);
    assert.match(source, /<PublicMain>[\s\S]*<\/PublicMain>/, `${file} must wrap its surface`);
  }
});

test('state blocks start at h2 and the careers board names its list', () => {
  const stateBlock = renderStateBlock();
  const cases = [
    ['EmptyState', { title: 'Nothing here', description: '' }],
    ['ErrorState', { title: 'Unavailable', description: 'Try again', onRetry: () => {} }],
    ['ForbiddenState', { title: 'Forbidden', description: 'No access' }],
  ];
  for (const [name, props] of cases) {
    const html = renderToStaticMarkup(React.createElement(stateBlock[name], props));
    assert.match(html, /<h2/, `${name} must not jump from the page h1 to an h3`);
    assert.doesNotMatch(html, /<h3/, `${name} must not render an h3 under a page h1`);
  }

  const careers = read('src/components/careers/CareersBoardPage.tsx');
  const board = /data-testid="careers-board"[\s\S]*?opportunities\.map/.exec(careers)?.[0] ?? '';
  assert.ok(board, 'the careers board section must be discoverable');
  assert.match(
    board,
    /<h2 className="sr-only">\{copy\.board\}<\/h2>/,
    'the opportunity h3 titles need an h2 heading before them',
  );
});

test('credential and admissions forms expose required and invalid state', () => {
  const login = readTsx('src/app/login/page.tsx');
  for (const id of ['email', 'password', 'otp-code']) {
    const input = controlById(login, 'Input', id);
    assert.ok(input, `the login ${id} input must exist`);
    const attrs = attributes(input, login);
    assert.ok(attrs.has('aria-invalid'), `login ${id} must expose its invalid state`);
    assert.match(
      expressionText(attrs.get('aria-invalid'), login),
      /formError/,
      `login ${id} aria-invalid must follow the form error`,
    );
    assert.match(
      expressionText(attrs.get('aria-describedby'), login),
      /login-error/,
      `login ${id} must point at the error message`,
    );
  }

  const forgot = readTsx('src/app/forgot-password/page.tsx');
  const forgotEmail = controlById(forgot, 'Input', 'forgot-email');
  assert.ok(forgotEmail, 'the forgot-password email input must exist');
  const forgotAttrs = attributes(forgotEmail, forgot);
  assert.match(expressionText(forgotAttrs.get('aria-invalid'), forgot), /formError/);
  assert.match(expressionText(forgotAttrs.get('aria-describedby'), forgot), /forgot-error/);
  assert.match(expressionText(forgotAttrs.get('aria-describedby'), forgot), /forgot-email-hint/);
  assert.match(read('src/app/forgot-password/page.tsx'), /id="forgot-email-hint"/);

  const reset = readTsx('src/app/reset-password/page.tsx');
  for (const id of ['new-password', 'confirm-password']) {
    const input = controlById(reset, 'Input', id);
    assert.ok(input, `the reset ${id} input must exist`);
    const attrs = attributes(input, reset);
    assert.match(expressionText(attrs.get('aria-invalid'), reset), /formError/);
    assert.match(expressionText(attrs.get('aria-describedby'), reset), /reset-error/);
    assert.match(expressionText(attrs.get('aria-describedby'), reset), /reset-password-policy/);
  }
  assert.match(read('src/app/reset-password/page.tsx'), /id="reset-password-policy"/);

  const apply = readTsx('src/components/admissions/AdmissionsApplyPage.tsx');
  for (const testId of [
    'admissions-cycle-input',
    'admissions-fullname',
    'admissions-dob',
    'admissions-school',
    'admissions-major',
  ]) {
    const input = controlByTestId(apply, 'Input', testId);
    assert.ok(input, `the admissions ${testId} input must exist`);
    assert.ok(attributes(input, apply).has('required'), `${testId} must expose its required state`);
  }
  const essay = controlByTestId(apply, 'Textarea', 'admissions-essay');
  assert.ok(essay, 'the admissions essay must exist');
  assert.equal(
    attributes(essay, apply).has('required'),
    false,
    'the essay is optional and must not claim to be required',
  );
});

test('the login portal selector navigates with links, not tab semantics', () => {
  const source = read('src/app/login/page.tsx');
  assert.doesNotMatch(source, /role="tablist"/, 'the portal selector is navigation, not a tablist');
  assert.doesNotMatch(source, /role="tab"/, 'portal links must keep link semantics');
  assert.doesNotMatch(source, /aria-selected/, 'link navigation uses aria-current, not aria-selected');
  assert.match(
    source,
    /<nav\b[^>]*aria-label=\{messages\.login\.portals\.groupLabel\}/,
    'the portal navigation keeps its group label',
  );
  assert.match(
    source,
    /aria-current=\{selected \? 'page' : undefined\}/,
    'the active portal is announced with aria-current',
  );
});

test('library and careers do not claim empty lists while loading or after a failed read', async () => {
  const libraryRuntime = createRuntime();
  const LibraryPage = loadTs('src/components/library/LibraryCataloguePage.tsx', pageStubs(
    libraryRuntime,
    {
      '@/lib/library-api': {
        libraryApi: {
          cataloguePage: async () => { throw new Error('offline'); },
          myLoans: async () => [],
        },
        newLibraryIdempotencyKey: () => 'key',
      },
    },
  ), { cache: false }).LibraryCataloguePage;
  const libraryTree = await settle(libraryRuntime, LibraryPage);

  assert.ok(
    elements(libraryTree).some((element) => element.type === stateStubs.ErrorState),
    'a failed catalogue read renders the retryable error state',
  );
  assert.equal(
    elements(libraryTree).some((element) => element.type === stateStubs.EmptyState),
    false,
    'a failed read must not also claim the patron has no loans',
  );

  const careersRuntime = createRuntime();
  const CareersPage = loadTs('src/components/careers/CareersBoardPage.tsx', pageStubs(
    careersRuntime,
    {
      '@/lib/careers-api': {
        careersApi: {
          opportunitiesPage: async () => { throw new Error('offline'); },
          myApplications: async () => [],
        },
        newCareerIdempotencyKey: () => 'key',
      },
    },
  ), { cache: false }).CareersBoardPage;
  const careersTree = await settle(careersRuntime, CareersPage);

  assert.ok(
    elements(careersTree).some((element) => element.type === stateStubs.ErrorState),
    'a failed board read renders the retryable error state',
  );
  assert.equal(
    elements(careersTree).some((element) => element.type === stateStubs.EmptyState),
    false,
    'a failed read must not also claim the candidate has no applications',
  );
});

test('the reset password visibility toggles name the field they control', () => {
  const source = read('src/app/reset-password/page.tsx');
  const sourceFile = readTsx('src/app/reset-password/page.tsx');
  const toggles = jsxElements(sourceFile, 'button').filter(
    (node) => attributes(node, sourceFile).has('aria-pressed'),
  );
  assert.equal(toggles.length, 1, 'the shared toggle factory renders one button');

  const toggle = toggles[0];
  const attrs = attributes(toggle, sourceFile);
  assert.match(
    expressionText(attrs.get('aria-label'), sourceFile),
    /fieldLabel/,
    'each toggle name must include the field label so the two toggles are distinguishable',
  );
  assert.equal(
    attrs.has('aria-describedby'),
    false,
    'the toggle must not describe itself with the input it controls',
  );
  assert.match(source, /passwordToggle\(showNew,[\s\S]*?copy\.newPassword\)/);
  assert.match(source, /passwordToggle\(showConfirm,[\s\S]*?copy\.confirmPassword\)/);
});

test('relative dates past a week use the page locale', () => {
  const { formatRelativeTime } = loadTs('src/lib/announcement-presentation.ts');
  const moment = new Date('2020-03-04T12:00:00Z');
  const options = { day: '2-digit', month: '2-digit', year: 'numeric' };

  assert.equal(
    formatRelativeTime(moment.toISOString(), 'en'),
    new Intl.DateTimeFormat('en-US', options).format(moment),
    'an English page must format the absolute date the English way',
  );
  assert.equal(
    formatRelativeTime(moment.toISOString(), 'vi'),
    new Intl.DateTimeFormat('vi-VN', options).format(moment),
    'a Vietnamese page keeps the Vietnamese date order',
  );
  assert.equal(formatRelativeTime('not-a-date', 'en'), '', 'an invalid date never prints NaN components');
});

test('malformed route segments do not abort the public detail pages', () => {
  const { safeDecodeURIComponent } = loadTs('src/lib/safe-url.ts');
  assert.equal(safeDecodeURIComponent('100%'), '100%');
  assert.equal(safeDecodeURIComponent('H%E1%BB%8Dc'), 'Học');
  assert.equal(safeDecodeURIComponent('%E0%A4%A'), '%E0%A4%A');

  for (const file of [
    'src/app/news/[id]/news-detail-client.tsx',
    'src/app/docs/[slug]/page.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /safeDecodeURIComponent\(/, `${file} must decode defensively`);
    assert.doesNotMatch(
      source,
      /decodeURIComponent\(params\./,
      `${file} must not throw on a malformed percent escape`,
    );
  }
});
