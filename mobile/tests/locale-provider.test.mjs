import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-locale-'));

async function load(relative, name) {
  const source = fs.readFileSync(path.join(mobileRoot, relative), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  const file = path.join(tmp, `${name}.mjs`);
  fs.writeFileSync(file, outputText);
  return import(pathToFileURL(file).href);
}

const locale = await load('src/i18n/locale.ts', 'locale');
const files = await load('src/files/file-adapter.ts', 'file-adapter');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: async (key) => (map.has(key) ? map.get(key) : null),
    setItem: async (key, value) => { map.set(key, value); },
  };
}

test('vi is the default and unknown values fall back to it', () => {
  assert.equal(locale.DEFAULT_LOCALE, 'vi');
  assert.equal(locale.normalizeLocale(undefined), 'vi');
  assert.equal(locale.normalizeLocale('fr-FR'), 'vi');
  assert.equal(locale.normalizeLocale('EN-us'), 'en');
});

test('preference round-trips through storage and survives failures', async () => {
  const storage = memoryStorage();
  assert.equal(await locale.loadLocale(storage), 'vi');
  assert.equal(await locale.saveLocale(storage, 'en'), true);
  assert.equal(storage.map.get(locale.LOCALE_STORAGE_KEY), 'en');
  assert.equal(await locale.loadLocale(storage), 'en');

  assert.equal(await locale.loadLocale(memoryStorage({ [locale.LOCALE_STORAGE_KEY]: 'zz' })), 'vi');
  const broken = {
    getItem: async () => { throw new Error('read'); },
    setItem: async () => { throw new Error('write'); },
  };
  assert.equal(await locale.loadLocale(broken), 'vi');
  assert.equal(await locale.saveLocale(broken, 'en'), false);
  assert.equal(await locale.saveLocale(undefined, 'en'), false);
});

test('dates use the locale order and date-only values do not shift', () => {
  assert.equal(locale.formatDate('2026-03-07', 'vi'), '07/03/2026');
  assert.equal(locale.formatDate('2026-03-07', 'en'), '03/07/2026');
  assert.equal(locale.formatDateTime(new Date(2026, 2, 7, 9, 5), 'vi'), '07/03/2026 09:05');
  assert.equal(locale.formatDate('not a date', 'vi'), '—');
  assert.equal(locale.formatDate(null, 'en'), '—');
});

test('numbers, credits and bytes follow locale separators', () => {
  assert.equal(locale.formatNumber(1234567.891, 'vi'), '1.234.567,89');
  assert.equal(locale.formatNumber(1234567.891, 'en'), '1,234,567.89');
  assert.equal(locale.formatNumber(3, 'vi', { minimumFractionDigits: 1 }), '3,0');
  assert.equal(locale.formatNumber(-0.001, 'en'), '0');
  assert.equal(locale.formatNumber(-12.5, 'en'), '-12.5');
  assert.equal(locale.formatNumber(Number.NaN, 'vi'), '—');
  assert.equal(locale.formatCredits(3, 'vi'), '3 tín chỉ');
  assert.equal(locale.formatCredits(1, 'en'), '1 credit');
  assert.equal(locale.formatCredits(2.5, 'en'), '2.5 credits');
  assert.equal(locale.formatBytes(512, 'vi'), '512 B');
  assert.equal(locale.formatBytes(1536, 'vi'), '1,5 KB');
  assert.equal(locale.formatBytes(5 * 1024 * 1024, 'en'), '5 MB');
  assert.equal(locale.formatBytes(-1, 'en'), '—');
});

test('date input accepts only real calendar dates', () => {
  assert.equal(locale.parseDateInput('07/03/2026', 'vi'), '2026-03-07');
  assert.equal(locale.parseDateInput('3/7/2026', 'en'), '2026-03-07');
  assert.equal(locale.parseDateInput('2026-03-07', 'vi'), '2026-03-07');
  assert.equal(locale.parseDateInput('29/02/2024', 'vi'), '2024-02-29');
  assert.equal(locale.parseDateInput('29/02/2026', 'vi'), null);
  assert.equal(locale.parseDateInput('31/04/2026', 'vi'), null);
  assert.equal(locale.parseDateInput('13/01/2026', 'en'), null);
  assert.equal(locale.parseDateInput('tomorrow', 'vi'), null);
  assert.equal(locale.parseDateInput('', 'vi'), null);
});

test('both locales define the same UI keys and interpolate parameters', () => {
  assert.deepEqual(Object.keys(locale.uiMessages.vi).sort(), Object.keys(locale.uiMessages.en).sort());
  for (const code of locale.SUPPORTED_LOCALES) {
    for (const [key, text] of Object.entries(locale.uiMessages[code])) {
      assert.ok(text.trim().length > 0, `${code}.${key} is empty`);
    }
  }
  assert.equal(locale.translate('en', 'dateTooEarly', { date: '01/02/2026' }), 'Date must be 01/02/2026 or later');
  assert.equal(locale.translate('vi', 'retry'), 'Thử lại');
});

test('default file adapter reports unavailable and never fakes success', async () => {
  const adapter = files.getFileAdapter();
  for (const operation of ['pick', 'share', 'save']) {
    const capability = adapter.capability(operation);
    assert.equal(capability.available, false);
    assert.ok(capability.reason.length > 0);
  }
  const target = { uri: 'file:///tmp/a.pdf', name: 'a.pdf' };
  for (const result of [await adapter.pick(), await adapter.share(target), await adapter.save(target)]) {
    assert.equal(result.status, 'unavailable');
    assert.ok(result.reason.length > 0);
  }

  const custom = files.createUnavailableFileAdapter('no picker');
  files.setFileAdapter(custom);
  assert.equal(files.getFileAdapter(), custom);
  assert.equal((await custom.pick()).reason, 'no picker');
  files.setFileAdapter();
  assert.notEqual(files.getFileAdapter(), custom);
  assert.equal(files.getFileAdapter().capability('pick').available, false);
});
