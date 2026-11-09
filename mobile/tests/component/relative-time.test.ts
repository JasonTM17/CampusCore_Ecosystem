import { afterEach, expect, jest, test } from '@jest/globals';

import { formatRelativeTime } from '../../src/screens/content/relative-time';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

afterEach(() => {
  jest.restoreAllMocks();
});

test('vi thresholds match the web relative-time helper', () => {
  expect(formatRelativeTime(ago(30 * 1000), 'vi', NOW)).toBe('Vừa xong');
  expect(formatRelativeTime(ago(5 * 60 * 1000), 'vi', NOW)).toBe('5 phút trước');
  expect(formatRelativeTime(ago(3 * 60 * 60 * 1000), 'vi', NOW)).toBe('3 giờ trước');
  expect(formatRelativeTime(ago(25 * 60 * 60 * 1000), 'vi', NOW)).toBe('Hôm qua');
  expect(formatRelativeTime(ago(3 * 24 * 60 * 60 * 1000), 'vi', NOW)).toBe('3 ngày trước');
  expect(formatRelativeTime(ago(10 * 24 * 60 * 60 * 1000), 'vi', NOW)).toBe('30/10/2026');
});

test('en thresholds match the web relative-time helper', () => {
  expect(formatRelativeTime(ago(30 * 1000), 'en', NOW)).toBe('Just now');
  expect(formatRelativeTime(ago(5 * 60 * 1000), 'en', NOW)).toBe('5m ago');
  expect(formatRelativeTime(ago(3 * 60 * 60 * 1000), 'en', NOW)).toBe('3h ago');
  expect(formatRelativeTime(ago(25 * 60 * 60 * 1000), 'en', NOW)).toBe('Yesterday');
  expect(formatRelativeTime(ago(3 * 24 * 60 * 60 * 1000), 'en', NOW)).toBe('3d ago');
  expect(formatRelativeTime(ago(10 * 24 * 60 * 60 * 1000), 'en', NOW)).toBe('10/30/2026');
});

test('missing and unparseable values return an empty string', () => {
  expect(formatRelativeTime(null, 'vi', NOW)).toBe('');
  expect(formatRelativeTime(undefined, 'en', NOW)).toBe('');
  expect(formatRelativeTime('not-a-date', 'vi', NOW)).toBe('');
});
