const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

async function loadLoginPortalModule() {
  const source = fs.readFileSync(path.join(root, 'src/lib/login-portal.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'login-portal.ts',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

test('the visible tab strip offers only the student and lecturer portals', async () => {
  const { VISIBLE_LOGIN_PORTALS } = await loadLoginPortalModule();
  assert.deepEqual([...VISIBLE_LOGIN_PORTALS], ['student', 'lecturer']);
  assert.equal(VISIBLE_LOGIN_PORTALS.includes('admin'), false);
});

test("'admin' stays a valid portal for deep links and guard redirects", async () => {
  const { LOGIN_PORTALS, parseLoginPortal, portalFromUser } = await loadLoginPortalModule();
  assert.equal(LOGIN_PORTALS.includes('admin'), true);
  assert.equal(parseLoginPortal('admin'), 'admin');
  assert.equal(portalFromUser({ roles: ['ADMIN'] }), 'admin');
  assert.equal(portalFromUser({ roles: ['SUPER_ADMIN'] }), 'admin');
  assert.equal(portalFromUser({ roles: ['TRUONG_KHOA'] }), 'admin');
});
