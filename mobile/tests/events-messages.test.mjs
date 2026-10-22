import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/i18n/events-messages.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { eventsMessages } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('mobile events VI/EN messages have matching nonempty keys including all states', () => {
  assert.deepEqual(Object.keys(eventsMessages.vi).sort(), Object.keys(eventsMessages.en).sort());
  assert.deepEqual(Object.keys(eventsMessages.vi.statusLabels).sort(), Object.keys(eventsMessages.en.statusLabels).sort());
  for (const copy of Object.values(eventsMessages)) {
    for (const value of Object.values(copy)) {
      for (const text of typeof value === 'string' ? [value] : Object.values(value)) assert.ok(text.trim());
    }
  }
});
test('mobile events localize participation, recovery and registration history', () => {
  for (const key of ['register', 'cancel', 'retry', 'full', 'registerFailed', 'cancelFailed', 'mine', 'loading']) assert.notEqual(eventsMessages.vi[key], eventsMessages.en[key]);
  assert.equal(eventsMessages.vi.statusLabels.CANCELLED, 'Đã hủy');
  assert.equal(eventsMessages.en.statusLabels.ATTENDED, 'Attended');
});
