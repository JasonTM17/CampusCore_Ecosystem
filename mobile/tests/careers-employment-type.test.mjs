import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const { employmentTypeLabel, humanizeEmploymentType } = await loadTs('src/screens/content/content-rules.ts');
const { careersMessages } = await loadTs('src/i18n/careers-messages.ts');

const UPPER_TOKEN = /^[A-Z0-9_]+$/;

test('known employment-type enums localize in both locales', () => {
  for (const code of ['INTERNSHIP', 'FULL_TIME', 'PART_TIME', 'CONTRACT']) {
    const vi = employmentTypeLabel(careersMessages.vi.employmentTypeLabels, code);
    const en = employmentTypeLabel(careersMessages.en.employmentTypeLabels, code);
    assert.equal(vi, careersMessages.vi.employmentTypeLabels[code]);
    assert.equal(en, careersMessages.en.employmentTypeLabels[code]);
    assert.notEqual(vi, en, `${code} should differ between vi and en`);
    assert.notEqual(vi, code, `${code} must not surface the raw enum`);
    assert.notEqual(en, code, `${code} must not surface the raw enum`);
  }
  assert.equal(employmentTypeLabel(careersMessages.vi.employmentTypeLabels, 'INTERNSHIP'), 'Thực tập');
  assert.equal(employmentTypeLabel(careersMessages.en.employmentTypeLabels, 'FULL_TIME'), 'Full-time');
});

test('unknown values fall back to a humanized form, never a raw upper-case token', () => {
  for (const locale of ['vi', 'en']) {
    const labels = careersMessages[locale].employmentTypeLabels;
    assert.equal(employmentTypeLabel(labels, 'GRADUATE_SCHEME'), 'Graduate scheme');
    assert.equal(employmentTypeLabel(labels, 'PART_TIME_EVENING'), 'Part time evening');
    assert.equal(employmentTypeLabel(labels, 'co-op'), 'Co op');
    assert.equal(employmentTypeLabel(labels, 'casual'), 'Casual');
  }
});

test('the fallback never emits an all-caps enum token', () => {
  for (const code of ['SOMETHING_NEW', 'TEMP_CONTRACT_X', 'ZZ_TOP']) {
    const out = employmentTypeLabel(careersMessages.en.employmentTypeLabels, code);
    assert.ok(!UPPER_TOKEN.test(out), `${code} → ${out} still looks like a raw enum`);
  }
});

test('empty and missing codes produce no label', () => {
  for (const locale of ['vi', 'en']) {
    const labels = careersMessages[locale].employmentTypeLabels;
    assert.equal(employmentTypeLabel(labels, null), '');
    assert.equal(employmentTypeLabel(labels, undefined), '');
    assert.equal(employmentTypeLabel(labels, ''), '');
    assert.equal(employmentTypeLabel(labels, '   '), '');
  }
  assert.equal(humanizeEmploymentType(''), '');
});

test('vi and en employment-type label sets cover the same codes and are non-empty', () => {
  const vi = careersMessages.vi.employmentTypeLabels;
  const en = careersMessages.en.employmentTypeLabels;
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
  for (const [code, text] of Object.entries(vi)) assert.ok(text.trim(), `vi ${code} is empty`);
  for (const [code, text] of Object.entries(en)) assert.ok(text.trim(), `en ${code} is empty`);
});
