import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(mobileRoot, rel), 'utf8');

const { formatNumber } = await loadTs('src/i18n/locale.ts');

// The options the three sites pass to the shared formatter.
const GRADE = { maximumFractionDigits: 2 };
const GPA = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

test('grades use the locale decimal separator without changing digits', () => {
  assert.equal(formatNumber(8.5, 'vi', GRADE), '8,5');
  assert.equal(formatNumber(8.5, 'en', GRADE), '8.5');
  assert.equal(formatNumber(8.25, 'vi', GRADE), '8,25');
  assert.equal(formatNumber(8.25, 'en', GRADE), '8.25');
  assert.equal(formatNumber(9, 'vi', GRADE), '9');
});

test('GPA keeps two fraction digits with the locale separator', () => {
  assert.equal(formatNumber(3.5, 'vi', GPA), '3,50');
  assert.equal(formatNumber(3.5, 'en', GPA), '3.50');
  assert.equal(formatNumber(3.52, 'vi', GPA), '3,52');
  assert.equal(formatNumber(3.52, 'en', GPA), '3.52');
});

test('the enrollment, thesis and admin screens format through the locale formatter', () => {
  const enrollment = read('src/screens/academic/EnrollmentDetail.tsx');
  const thesis = read('src/screens/thesis/ThesisProgressScreen.tsx');
  const admin = read('src/screens/operations/AdminScreens.tsx');

  assert.match(enrollment, /formatNumber\(enrollment\.finalGrade, \{ maximumFractionDigits: 2 \}\)/);
  assert.doesNotMatch(enrollment, /\$\{enrollment\.finalGrade\}/);

  assert.match(thesis, /formatNumber\(progress\.finalScore, \{ maximumFractionDigits: 2 \}\)/);
  assert.doesNotMatch(thesis, /\$\{progress\.finalScore\}/);

  assert.match(admin, /formatNumber\(selectedStudent\.gpa, \{ minimumFractionDigits: 2, maximumFractionDigits: 2 \}\)/);
  assert.doesNotMatch(admin, /selectedStudent\.gpa\.toFixed\(2\)/);
});
