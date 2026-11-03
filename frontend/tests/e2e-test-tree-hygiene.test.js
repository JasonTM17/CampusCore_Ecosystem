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

test('shipped source and tests stay free of internal hunt ledger and ticket tokens', () => {
  const targets = ['src', 'tests'];
  const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.css']);
  const forbiddenPattern = /\b(P4[a-z]|F-\d+|W\d+ P\d|Sol package|Wave \d+|wave-\d+)\b/;
  const selfFile = path.resolve(__filename);

  function collectFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath));
      } else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const violations = [];
  for (const target of targets) {
    const dir = path.join(root, target);
    if (!fs.existsSync(dir)) continue;
    for (const file of collectFiles(dir)) {
      if (path.resolve(file) === selfFile) continue;
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(forbiddenPattern);
        if (match) {
          const relPath = path.relative(root, file).replace(/\\/g, '/');
          violations.push(`${relPath}:${i + 1}: ${match[0]} in "${line.trim()}"`);
        }
      }
    }
  }

  assert.deepEqual(violations, [],
    'source and test files must state invariants rather than citing hunt-ledger IDs');
});
