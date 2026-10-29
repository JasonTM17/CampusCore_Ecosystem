import assert from 'node:assert/strict';
import test from 'node:test';
import { localeKeys } from './ecosystem-locale-keys.mjs';

test('reconcile reads typed locale declarations without hiding missing keys', () => {
  const source = `const vi = {\n title: 'Tiêu đề',\n missing: 'Nội dung',\n};
const en: Record<string, string> = {\n title: 'Title',\n};`;
  assert.deepEqual([...localeKeys(source, 'vi')].sort(), ['missing', 'title']);
  assert.deepEqual([...localeKeys(source, 'en')], ['title']);
  assert.notDeepEqual(localeKeys(source, 'vi'), localeKeys(source, 'en'));
});

test('reconcile retains literal-map support and absent locales remain an error signal', () => {
  assert.deepEqual([...localeKeys(`const messages = { vi: {\n 'key-name': 'x',\n}, en: {\n 'key-name': 'y',\n} };`, 'vi')], ['key-name']);
  assert.equal(localeKeys('const other = {};', 'en'), null);
});
