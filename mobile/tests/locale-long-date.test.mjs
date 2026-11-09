import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const { formatLongDate } = await loadTs('src/i18n/locale.ts');

test('the long date uses the web weekday, month and year order', () => {
  assert.equal(formatLongDate('2026-11-09', 'vi'), 'Thứ Hai, 9 tháng 11, 2026');
  assert.equal(formatLongDate('2026-11-09', 'en'), 'Monday, November 9, 2026');
});

test('the long date keeps Sunday and the empty sentinel', () => {
  assert.equal(formatLongDate('2026-11-08', 'vi'), 'Chủ Nhật, 8 tháng 11, 2026');
  assert.equal(formatLongDate(null, 'vi'), '—');
});
