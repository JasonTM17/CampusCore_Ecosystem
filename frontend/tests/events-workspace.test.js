const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/i18n/events-messages.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const mod = { exports: {} };
new Function('exports', outputText)(mod.exports);
const { eventsMessages } = mod.exports;
function keys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? [`${prefix}${key}`] : keys(item, `${prefix}${key}.`)).sort();
}
test('events VI/EN domain messages have matching nonempty keys', () => {
  assert.deepEqual(keys(eventsMessages.vi), keys(eventsMessages.en));
  for (const dictionary of Object.values(eventsMessages)) {
    for (const value of Object.values(dictionary)) {
      for (const text of typeof value === 'string' ? [value] : Object.values(value)) assert.ok(text.trim());
    }
  }
});
test('event workflows have localized recovery, capabilities and lifecycle actions', () => {
  assert.equal(eventsMessages.vi.participation, 'Tham gia & lịch sử');
  assert.equal(eventsMessages.en.staffTools, 'Staff tools');
  for (const key of ['register', 'cancelRegistration', 'markPresent', 'markAbsent', 'failed', 'startLabel', 'endLabel', 'descriptionField']) {
    assert.notEqual(eventsMessages.vi[key], eventsMessages.en[key], key);
  }
  assert.equal(eventsMessages.vi.statusLabels.REGISTERED, 'Đã đăng ký');
});
