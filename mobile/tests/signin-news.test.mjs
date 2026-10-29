import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './helpers/load-ts.mjs';

const rules = await loadTs('src/screens/content/content-rules.ts');
const rich = await loadTs('src/screens/content/rich-text.ts');
const locale = await loadTs('src/i18n/locale.ts');

const { newsHighlights, isUrgentPriority, newsCategoryLabel, newsTargetOf } = rules;
const { summaryOrExcerpt, excerptOf } = rich;
const { formatDate } = locale;

test('newsHighlights shapes the feed as a lead article plus follow-up rows', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];
  assert.deepEqual(newsHighlights([], 5), { featured: null, rest: [] });
  assert.deepEqual(newsHighlights([items[0]], 5), { featured: items[0], rest: [] });
  assert.deepEqual(newsHighlights(items, 5), { featured: items[0], rest: items.slice(1, 5) });
  assert.deepEqual(newsHighlights(items.slice(0, 3), 5), { featured: items[0], rest: items.slice(1, 3) });
  // A zero cap shows nothing, and the input array is never mutated.
  assert.deepEqual(newsHighlights(items, 0), { featured: null, rest: [] });
  assert.equal(items.length, 6);
});

test('isUrgentPriority only honours the server URGENT code', () => {
  assert.equal(isUrgentPriority('URGENT'), true);
  assert.equal(isUrgentPriority('HIGH'), false);
  assert.equal(isUrgentPriority('NORMAL'), false);
  assert.equal(isUrgentPriority('urgent'), false);
  assert.equal(isUrgentPriority(null), false);
  assert.equal(isUrgentPriority(undefined), false);
});

test('newsCategoryLabel normalizes server ids to the UPPER_SNAKE label keys', () => {
  const labels = { STUDENT_LIFE: 'Đời sống Sinh viên', ACADEMIC_AFFAIRS: 'Học vụ' };
  assert.equal(newsCategoryLabel(labels, 'student-life'), 'Đời sống Sinh viên');
  assert.equal(newsCategoryLabel(labels, 'STUDENT_LIFE'), 'Đời sống Sinh viên');
  assert.equal(newsCategoryLabel(labels, 'student life'), 'Đời sống Sinh viên');
  assert.equal(newsCategoryLabel(labels, ' academic_affairs '), 'Học vụ');
  // Unknown or missing ids never render a pill.
  assert.equal(newsCategoryLabel(labels, 'SPORTS'), '');
  assert.equal(newsCategoryLabel(labels, null), '');
  assert.equal(newsCategoryLabel(labels, '   '), '');
});

test('newsTargetOf prefers the permalink slug and falls back to the id', () => {
  assert.equal(newsTargetOf({ id: '42', slug: 'lich-thi-cuoi-ky' }), 'lich-thi-cuoi-ky');
  assert.equal(newsTargetOf({ id: '42' }), '42');
  assert.equal(newsTargetOf({ id: '42', slug: null }), '42');
});

test('summaryOrExcerpt prefers the authored summary and falls back to the body', () => {
  assert.equal(summaryOrExcerpt({ summary: 'Sapo ngắn', content: '<p>Dài hơn</p>' }), 'Sapo ngắn');
  assert.equal(summaryOrExcerpt({ summary: '  ', content: '<p>Đoạn đầu</p><p>Đoạn hai</p>' }), 'Đoạn đầu');
  assert.equal(summaryOrExcerpt({ content: '<p>Đoạn đầu</p><p>Đoạn hai</p>' }), 'Đoạn đầu');
  assert.equal(summaryOrExcerpt({}), '');
  // HTML never reaches the teaser and a long body is truncated with an ellipsis.
  const long = { content: `<p>${'x'.repeat(200)}</p>` };
  assert.equal(summaryOrExcerpt(long, 50).length, 50);
  assert.ok(summaryOrExcerpt(long, 50).endsWith('…'));
  assert.equal(excerptOf('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('formatDate localizes publish dates and degrades invalid input quietly', () => {
  assert.equal(formatDate('2026-10-20', 'vi'), '20/10/2026');
  assert.equal(formatDate('2026-10-20', 'en'), '10/20/2026');
  assert.equal(formatDate('not-a-date', 'vi'), '—');
  assert.equal(formatDate(undefined, 'vi'), '—');
});
