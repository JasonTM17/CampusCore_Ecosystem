import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './helpers/load-ts.mjs';

const { academicMessages } = await loadTs('src/i18n/academic-messages.ts');
const { operationsMessages } = await loadTs('src/i18n/operations-messages.ts');

test('the 50% process component uses the same English term on every mobile surface', () => {
  assert.equal(academicMessages.en.processScore, 'Coursework (50%)');
  assert.equal(operationsMessages.en.process, 'Coursework (50%)');
  assert.equal(operationsMessages.en.needsProcess, 'Enter the coursework score first');
});

test('the process component keeps its base Vietnamese term and states the 50% weight', () => {
  assert.equal(academicMessages.vi.processScore, 'Quá trình (50%)');
  assert.equal(operationsMessages.vi.process, 'ĐQT (50%)');
  assert.equal(operationsMessages.vi.needsProcess, 'Nhập điểm quá trình trước');
});

test('both locales keep the same catalogue keys', () => {
  assert.deepEqual(Object.keys(academicMessages.vi).sort(), Object.keys(academicMessages.en).sort());
  assert.deepEqual(Object.keys(operationsMessages.vi).sort(), Object.keys(operationsMessages.en).sort());
});
