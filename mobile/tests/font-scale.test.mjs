import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTs } from './helpers/load-ts.mjs';

const {
  chromeFontScaleCap,
  compactFontScaleCap,
  effectiveFontSizeMultiplier,
} = await loadTs('src/design/font-scale.ts');

test('the effective text multiplier is min(requested, global cap)', () => {
  assert.equal(effectiveFontSizeMultiplier(undefined, 2), 2);
  assert.equal(effectiveFontSizeMultiplier(1.3, 2), 1.3);
  assert.equal(effectiveFontSizeMultiplier(2, 2), 2);
  assert.equal(effectiveFontSizeMultiplier(3, 2), 2);
});

test('fixed-size chrome caps stay below the 2.0 global cap', () => {
  assert.ok(chromeFontScaleCap < 2);
  assert.ok(compactFontScaleCap < 2);
  assert.ok(chromeFontScaleCap < compactFontScaleCap);
});
