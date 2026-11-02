const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const collectedDir = path.join(root, 'tests', 'e2e');
const manualDir = path.join(root, 'scripts', 'manual');

// Playwright only collects the specs under frontend/e2e. These Python probes
// drive a local stack by hand, so keeping them under tests/e2e advertises a
// gate that no runner executes.
const manualProbes = [
  'deep_browser_qa_audit.py',
  'inspect_chatbot_replies.py',
  'test_announcement_reader_ui.py',
  'test_chatbot_personalization.py',
  'test_rate_limiting.py',
  'test_rate_limiting_ui.py',
  'test_thesis_and_active_bigdata.py',
];

test('manual Python probes stay out of the collected test tree', () => {
  const strays = fs.existsSync(collectedDir)
    ? fs.readdirSync(collectedDir).filter((name) => name.endsWith('.py')).sort()
    : [];
  assert.deepEqual(strays, [],
    'files under tests/e2e must be collected Playwright specs, not manual probes');

  for (const name of manualProbes) {
    assert.ok(fs.existsSync(path.join(manualDir, name)),
      `${name} must remain available under scripts/manual`);
  }
});
