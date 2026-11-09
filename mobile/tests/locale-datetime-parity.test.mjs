import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-locale-datetime-'));

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

const { formatDateTime } = await load('src/i18n/locale.ts', 'locale');

// The web provider formats a date-only value as a civil UTC day and every other
// value in the fixed campus zone, with these exact Intl options. Copy them
// literally so the expected string is the web's own output.
function webDateTime(value, locale) {
  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = civil
    ? new Date(Date.UTC(+civil[1], +civil[2] - 1, +civil[3]))
    : new Date(value);
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    year: 'numeric',
    month: locale === 'vi' ? '2-digit' : 'short',
    day: locale === 'vi' ? '2-digit' : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: civil ? 'UTC' : 'Asia/Ho_Chi_Minh',
  }).format(date);
}

const INSTANTS = [
  '2026-11-09T07:30:00Z',
  '2026-10-30T08:00:00Z',
  '2026-03-07T02:05:00Z',
  '2026-01-01T00:00:00Z',
  '2026-06-15T12:00:00Z',
  '2026-06-15T13:00:00Z',
  '2026-06-15T00:30:00Z',
  '2026-06-15T11:59:00Z',
];

test('formatDateTime matches the web Intl output for fixed instants in the campus zone', () => {
  for (const locale of ['vi', 'en']) {
    for (const instant of INSTANTS) {
      assert.equal(
        formatDateTime(instant, locale),
        webDateTime(instant, locale),
        `${locale} ${instant}`,
      );
    }
  }
});

test('formatDateTime keeps a date-only value civil and matches the web UTC output', () => {
  for (const locale of ['vi', 'en']) {
    assert.equal(formatDateTime('2026-03-07', locale), webDateTime('2026-03-07', locale));
  }
});

test('formatDateTime keeps the dash for null and invalid values', () => {
  for (const locale of ['vi', 'en']) {
    assert.equal(formatDateTime(null, locale), '—');
    assert.equal(formatDateTime(undefined, locale), '—');
    assert.equal(formatDateTime('', locale), '—');
    assert.equal(formatDateTime('not a date', locale), '—');
  }
});
