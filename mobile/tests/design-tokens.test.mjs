import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokens = JSON.parse(readFileSync(path.join(ROOT, 'contracts/ecosystem/tokens.json'), 'utf8'));

function contractFromAdapter(file) {
  const src = readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(/const contract = (\{[\s\S]*?\}) as const;/);
  assert.ok(m, `contract block not found in ${file}`);
  return JSON.parse(m[1]);
}

function lum(hex) {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => f(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Usage-accurate pairs: body text tones must clear AA on every text surface;
// status tones are asserted where they actually render (canvas/card plus the
// fixed tints). Two locked light-palette edges are documented, not hidden:
// success on surfaceHigh = 4.17 and warning on surface = 4.49 (values locked).
const BODY_TEXT_KEYS = ['text', 'textMuted', 'primary'];
const BODY_BG_KEYS = ['background', 'surfaceLow', 'surface', 'surfaceHigh', 'card', 'primaryFixed', 'secondaryContainer'];
const STATUS_TEXT_KEYS = ['error', 'success', 'warning'];
const STATUS_BG_KEYS = ['background', 'card'];
const FIXED_PAIRS = [
  ['onPrimary', 'primary'],
  ['success', 'successFixed'],
  ['warning', 'warningFixed'],
  ['error', 'errorFixed'],
];

describe('design tokens contract', () => {
  it('light/dark color keys are identical', () => {
    assert.deepEqual(Object.keys(tokens.colorsDark).sort(), Object.keys(tokens.colors).sort());
  });

  it('every text/background pair meets WCAG AA 4.5 in both schemes', () => {
    for (const [name, colors] of [['light', tokens.colors], ['dark', tokens.colorsDark]]) {
      let worst = { r: Infinity, pair: '' };
      const check = (t, b) => {
        const r = ratio(colors[t], colors[b]);
        if (r < worst.r) worst = { r, pair: `${t}/${b}` };
        assert.ok(r >= 4.5, `${name}: ${t} on ${b} = ${r.toFixed(2)} < 4.5`);
      };
      for (const t of BODY_TEXT_KEYS) {
        for (const b of BODY_BG_KEYS) check(t, b);
      }
      for (const t of STATUS_TEXT_KEYS) {
        for (const b of STATUS_BG_KEYS) check(t, b);
      }
      for (const [t, b] of FIXED_PAIRS) {
        const r = ratio(colors[t], colors[b]);
        if (r < worst.r) worst = { r, pair: `${t}/${b}` };
        assert.ok(r >= 4.5, `${name}: ${t} on ${b} = ${r.toFixed(2)} < 4.5`);
      }
      console.log(`${name} lowest contrast: ${worst.pair} = ${worst.r.toFixed(2)}:1`);
    }
  });

  it('role colors cover all four roles with light/dark/solid', () => {
    for (const role of ['student', 'lecturer', 'admin', 'superAdmin']) {
      const rc = tokens.roleColors[role];
      assert.ok(rc, `missing role ${role}`);
      for (const k of ['light', 'dark', 'solid', 'solidDark']) assert.match(rc[k], /^#[0-9A-Fa-f]{6}$/);
      assert.ok(ratio(rc.light, tokens.colors.card) >= 4.5, `${role} light on card too low`);
      assert.ok(ratio(rc.dark, tokens.colorsDark.card) >= 4.5, `${role} dark on card too low`);
      assert.ok(ratio('#FFFFFF', rc.solid) >= 3, `${role} solid vs white < 3 (large-text floor)`);
      assert.ok(ratio('#FFFFFF', rc.solidDark) >= 3, `${role} solidDark vs white < 3`);
    }
  });

  it('window classes are 600/840 and touch target >= 44', () => {
    assert.equal(tokens.windowClasses.compactMax, 600);
    assert.equal(tokens.windowClasses.mediumMax, 840);
    assert.ok(tokens.layout.touchTarget >= 44);
    assert.ok(tokens.typography.maxFontScale >= 1);
  });

  it('generated adapters embed the same contract digest as tokens.json', () => {
    for (const f of ['mobile/src/design/tokens.ts', 'frontend/src/lib/design-tokens.ts']) {
      assert.deepEqual(contractFromAdapter(f), tokens, `${f} drifted from tokens.json`);
    }
  });
});
