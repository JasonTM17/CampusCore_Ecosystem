const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('the unused notifications compatibility proxy is retired while the /api/v1 proxy remains', () => {
  const legacyRoute = path.join(root, 'src/app/notifications/[[...path]]/route.ts');
  const hardenedProxy = path.join(root, 'src/app/api/v1/[...path]/route.ts');

  assert.equal(fs.existsSync(legacyRoute), false, 'the credential-forwarding legacy route must stay absent');
  assert.equal(fs.existsSync(hardenedProxy), true, 'the authenticated API proxy remains the frontend entry point');
});
