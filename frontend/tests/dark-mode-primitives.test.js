const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// The shared primitive layer keeps to the semantic token system.
//
// `DESIGN.md` forbids raw Tailwind palettes on shared primitives, because a
// primitive sits under every screen: one fixed-light value there renders an
// unreadable patch in the opposite theme on pages nobody thought to check.
//
// Scope is deliberately narrow, and the guard is deliberately partial:
//   * only `src/components/ui/` — the shared primitives, where a defect
//     propagates furthest. Page-level composition and the editorial reader are
//     out of scope.
//   * only OPAQUE raw light surfaces. A translucent value (`bg-white/10`,
//     `bg-black/55`) is an overlay on whatever is behind it and is legitimate in
//     both themes, so it is not flagged.
//   * a value that already carries a `dark:` counterpart, or is scoped to
//     `print:`, is satisfiable and is not flagged.
//
// What this cannot detect, and therefore does not claim: a fixed-light *hairline*
// over a theme-flipping surface (`border-white/10` on `--surface-alt` was exactly
// that defect — translucent, so this guard passes it). Catching that class needs
// rendered contrast measurement, not source inspection.
// ---------------------------------------------------------------------------

const RAW_LIGHT_TOKEN = /\b(bg-white|bg-black|text-slate-9\d0|text-gray-9\d0|text-slate-800|text-gray-800)\b/;

/** Reads every `.tsx` in the shared primitive layer. */
function primitiveFiles() {
  const dir = path.join(root, 'src', 'components', 'ui');
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => ({ name, relative: `src/components/ui/${name}`, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

/** Returns the offending occurrences across every primitive file. */
function opaqueRawLightSurfaces() {
  const offences = [];
  for (const file of primitiveFiles()) {
    file.text.split(/\r?\n/).forEach((line, index) => {
      // Comments document the rule and name the forbidden values; they are not code.
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (!RAW_LIGHT_TOKEN.test(code)) return;
      if (code.includes('dark:')) return;
      if (code.includes('print:')) return;

      // A translucent value is an overlay, not a light surface.
      const opaqueHit = [...code.matchAll(new RegExp(`${RAW_LIGHT_TOKEN.source}(?!/\\d)`, 'g'))];
      if (opaqueHit.length === 0) return;

      offences.push(`${file.relative}:${index + 1} -> ${opaqueHit.map((m) => m[1]).join(', ')}`);
    });
  }
  return offences;
}

test('shared primitives introduce no opaque raw light surface without a dark counterpart', () => {
  const offences = opaqueRawLightSurfaces();
  assert.deepEqual(
    offences,
    [],
    `Opaque raw light values found in src/components/ui without a dark: counterpart.\n` +
      `Use a semantic token (bg-card, text-foreground, border-border) or pair the value with dark:.\n` +
      `Offences:\n  ${offences.join('\n  ')}`,
  );
});

test('the guard actually recognises an opaque raw light value', () => {
  // A guard that cannot fail is not a guard: prove the matcher against the exact
  // shape it exists to catch, and prove it tolerates the legitimate shapes.
  const opaque = '<div className="rounded-lg bg-white text-slate-900" />';
  const opaqueHits = [...opaque.matchAll(new RegExp(`${RAW_LIGHT_TOKEN.source}(?!/\\d)`, 'g'))];
  assert.equal(opaqueHits.length, 2, 'an opaque bg-white + text-slate-900 must be detected');
  assert.ok(!opaque.includes('dark:'), 'and the fixture must genuinely lack a dark counterpart');

  const guarded = '<div className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" />';
  assert.ok(guarded.includes('dark:'), 'a paired value is satisfiable and must be excused');

  const overlay = '<div className="bg-white/10 bg-black/55" />';
  assert.equal(
    [...overlay.matchAll(new RegExp(`${RAW_LIGHT_TOKEN.source}(?!/\\d)`, 'g'))].length,
    0,
    'translucent overlays are legitimate in both themes and must not be flagged',
  );
});

test('the primitive layer stays on the token system for its primary surfaces', () => {
  const sources = primitiveFiles().map((file) => file.text).join('\n');
  // Spot-check that the layer really is token-driven rather than merely
  // free of the flagged literals.
  for (const token of ['bg-card', 'text-card-foreground', 'border-border']) {
    assert.ok(sources.includes(token), `expected the primitive layer to use ${token}`);
  }
});

test('portal table headers use the semantic foreground, not a sidebar-tinted mix', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'app', 'globals.css'), 'utf8');
  const headerRule = css.match(/\.portal-shell\s+th\s*\{([^}]*)\}/);
  assert.ok(headerRule, 'expected a .portal-shell th rule in globals.css');
  assert.match(
    headerRule[1],
    /color:\s*hsl\(var\(--foreground\)\)/,
    'portal table headers must paint with the semantic foreground token',
  );
  assert.doesNotMatch(
    headerRule[1].match(/color:[^;]+/)?.[0] ?? '',
    /--portal-sidebar/,
    'the header text colour must not mix in the dark sidebar surface token',
  );
});

// ---------------------------------------------------------------------------
// UX-W2-01 — the admissions "simulated service" notice painted text-amber-200
// over a fixed amber wash: ~1.15:1 on the light canvas. The notice now uses the
// shared semantic warning pair; these tests pin the classes and prove the token
// pair itself clears WCAG AA 4.5:1 in both themes.
// ---------------------------------------------------------------------------

const ADMISSIONS_PAGES = [
  'src/components/admissions/AdmissionsApplyPage.tsx',
  'src/components/admissions/AdmissionsReviewPage.tsx',
];

test('admissions simulated-service notice uses the semantic warning pair', () => {
  for (const relative of ADMISSIONS_PAGES) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const notice = source.slice(
      source.indexOf('data-testid="admissions-simulated-banner"') - 400,
      source.indexOf('data-testid="admissions-simulated-banner"'),
    );
    assert.match(notice, /bg-status-warning\/10/, `${relative} must use the warning surface token`);
    assert.match(notice, /text-status-warning-foreground/, `${relative} must use the warning foreground token`);
    assert.match(notice, /border-status-warning\/40/, `${relative} must use the warning border token`);
    assert.doesNotMatch(source, /text-amber-200/, `${relative} still paints the unreadable amber-200 text`);
    assert.doesNotMatch(notice, /bg-amber-/, `${relative} still uses the raw amber surface`);
  }
});

/** Resolves `--name: h s% l%` triplets (incl. `var(--x)` aliases) inside a CSS block. */
function themeTriplets(block) {
  const raw = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    raw[name] = value.trim();
  }
  const resolve = (name) => {
    let value = raw[name];
    const alias = /^var\(--([\w-]+)\)$/.exec(value);
    if (alias) value = raw[alias[1]];
    const parts = value.split(/\s+/).map((part) => parseFloat(part));
    return { h: parts[0], s: parts[1] / 100, l: parts[2] / 100 };
  };
  return resolve;
}

function hslToRgb({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

function relativeLuminance([r, g, b]) {
  const channel = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

test('the warning foreground clears WCAG AA 4.5:1 on the warning surface in both themes', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'app', 'globals.css'), 'utf8');
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/)[1];
  const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\s*\}/)[1];

  for (const [theme, block] of [['light', rootBlock], ['dark', darkBlock]]) {
    const token = themeTriplets(block);
    // bg-status-warning/10 composites the warning colour at 10% over --card.
    const surface = hslToRgb(token('status-warning'));
    const card = hslToRgb(token('card'));
    const blended = surface.map((v, i) => v * 0.1 + card[i] * 0.9);
    const text = hslToRgb(token('status-warning-foreground'));
    const [hi, lo] = [relativeLuminance(text), relativeLuminance(blended)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    assert.ok(
      ratio >= 4.5,
      `${theme} warning notice contrast ${ratio.toFixed(2)}:1 is below WCAG AA 4.5:1`,
    );
  }
});
