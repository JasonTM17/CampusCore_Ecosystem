const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTs } = require('./dashboard-shell-harness');

const root = path.resolve(__dirname, '..');
const loginPortal = loadTs('src/lib/login-portal.ts');
const identity = (value) => value;

function withLocation(location, fn) {
  const previousWindow = global.window;
  global.window = { location };
  try {
    return fn();
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

// ---------------------------------------------------------------------------
// sessionExpiredLoginHref — one mint for the dead-session login link
// ---------------------------------------------------------------------------

test('the shared mint carries the requested admin page as next', () => {
  const href = withLocation(
    { pathname: '/vi/admin/users', search: '?tab=pending' },
    () => loginPortal.sessionExpiredLoginHref(identity, 'admin'),
  );
  const url = new URL(href, 'http://portal.test');
  assert.equal(url.searchParams.get('portal'), 'admin');
  assert.equal(url.searchParams.get('reason'), 'session-expired');
  assert.equal(
    url.searchParams.get('next'),
    '/admin/users?tab=pending',
    'the locale-stripped page plus its query survives as next',
  );
});

test('the shared mint derives the portal from the page when none is pinned', () => {
  const href = withLocation(
    { pathname: '/vi/dashboard/thesis', search: '' },
    () => loginPortal.sessionExpiredLoginHref(identity),
  );
  const url = new URL(href, 'http://portal.test');
  assert.equal(url.searchParams.get('portal'), 'lecturer');
  assert.equal(url.searchParams.get('next'), '/dashboard/thesis');
});

test('the shared mint rejects a target that cannot become next', () => {
  const href = withLocation({ pathname: '//evil.example', search: '' }, () =>
    loginPortal.sessionExpiredLoginHref(identity),
  );
  const url = new URL(href, 'http://portal.test');
  assert.equal(url.searchParams.get('next'), null);
});

// ---------------------------------------------------------------------------
// Guards — no page may hand-roll the session-expired login URL again
// ---------------------------------------------------------------------------

function sourceFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        found.push({ file: full, source: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return found;
}

test('no admin page hand-rolls the session-expired login URL', () => {
  const adminRoot = path.join(root, 'src/app/admin');
  for (const { file, source } of sourceFiles(adminRoot)) {
    assert.ok(
      !source.includes('reason=session-expired'),
      `${path.relative(root, file)} must route session death through the shared login helper`,
    );
  }
});

test('the assistant surfaces mint the sign-in link through the shared helper', () => {
  for (const relative of [
    'src/components/assistant/AssistantPanel.tsx',
    'src/app/dashboard/assistant-specialized/page.tsx',
  ]) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.ok(
      !source.includes('?reason=session-expired'),
      `${relative} must not hand-roll the session-expired login URL`,
    );
    assert.match(
      source,
      /sessionExpiredLoginHref\(href\)/,
      `${relative} must mint the sign-in link through the shared helper`,
    );
  }
});
