import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareLocaleCatalogs,
  localeCatalogPairs,
  localeKeys,
} from './ecosystem-locale-keys.mjs';

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

test('catalog parser resolves nested objects and shared spread maps', () => {
  const sourceFiles = new Map([
    ['messages.ts', `
      import { sharedEn, sharedVi } from './messages-shared';
      export const en = {
        ...sharedEn,
        card: { title: 'Hello {name}', detail: { count: '{count}' } },
      };
      export const vi: Catalog = {
        ...sharedVi,
        card: { title: 'Xin chào {name}', detail: { count: '{count}' } },
      };
    `],
    ['messages-shared.ts', `
      export const sharedEn = { shared: { label: 'Name: {name}' } };
      export const sharedVi = { shared: { label: 'Tên: {name}' } };
    `],
  ]);
  const pairs = localeCatalogPairs(sourceFiles.get('messages.ts'), {
    name: 'messages.ts',
    sources: sourceFiles,
  });

  assert.equal(pairs.length, 1, 'the main file should produce one locale pair');
  const [pair] = pairs;
  assert.deepEqual([...pair.en.keys()].sort(), [
    'card.detail.count',
    'card.title',
    'shared.label',
  ]);
  assert.deepEqual([...pair.vi.keys()].sort(), [...pair.en.keys()].sort());
  assert.deepEqual(compareLocaleCatalogs(pair.vi, pair.en), []);
  assert.deepEqual([...pair.en.get('card.title')], ['name']);
});

test('main web locale fixture reports missing keys and interpolation placeholders', () => {
  const source = `
    export const en = {
      home: { title: 'Welcome {name}', onlyEnglish: 'Available {count}' },
    };
    export const vi = {
      home: { title: 'Xin chào {person}', onlyVietnamese: 'Chỉ tiếng Việt' },
    };
  `;
  const [pair] = localeCatalogPairs(source, { name: 'messages.ts' });
  const errors = compareLocaleCatalogs(pair.vi, pair.en);

  assert.ok(errors.some((error) => error.includes('home.onlyEnglish')),
    'a missing main-web key must be reported');
  assert.ok(errors.some((error) => error.includes('home.onlyVietnamese')),
    'an extra main-web key must be reported');
  assert.ok(errors.some((error) => error.includes('home.title')),
    'a placeholder mismatch must be reported');
});
