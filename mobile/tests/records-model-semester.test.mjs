import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './helpers/load-ts.mjs';

const { conductSemesterName } = await loadTs('src/screens/content/records-model.ts');

test('conduct semester names are rewritten for English like the web', () => {
  assert.equal(conductSemesterName('Học kỳ 1 năm học 2024-2025', 'en'), 'Semester 1, 2024-2025');
  assert.equal(conductSemesterName('Học kỳ 2 năm học 2025-2026', 'en'), 'Semester 2, 2025-2026');
});

test('conduct semester names stay in Vietnamese for the Vietnamese locale', () => {
  assert.equal(conductSemesterName('Học kỳ 1 năm học 2024-2025', 'vi'), 'Học kỳ 1 năm học 2024-2025');
});

test('unmatched names pass through and a missing name is the web dash', () => {
  assert.equal(conductSemesterName('Fall 2026', 'en'), 'Fall 2026');
  assert.equal(conductSemesterName(null, 'en'), '—');
});
