const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function cssBlock(css, selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing ${selector} in globals.css`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  assert.ok(open >= 0 && close > open, `unterminated ${selector} block`);
  return css.slice(open + 1, close);
}

function cssVars(block) {
  const vars = {};
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[`--${match[1]}`] = match[2].trim();
  }
  return vars;
}

function hslToRgb(value, vars) {
  let triplet = value;
  const reference = triplet.match(/^var\(--([\w-]+)\)$/);
  if (reference) triplet = vars[reference[1]];
  const match = String(triplet).match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  assert.ok(match, `not an HSL triplet: ${value}`);
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const channel = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

function hexToRgb(value) {
  const hex = value.replace('#', '');
  assert.equal(hex.length, 6, `expected a six-digit hex colour, got ${value}`);
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
}

function luminance(rgb) {
  const linear = rgb.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

function composite(foreground, alpha, background) {
  return foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha));
}

function classLiterals(sourceText) {
  return [...sourceText.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

function classTokens(literals) {
  return literals.flatMap((literal) => literal.split(/\s+/).filter(Boolean));
}

function baseToken(token) {
  const parts = token.split(':');
  return { variants: parts.slice(0, -1), base: parts[parts.length - 1] };
}

function persistentToken(token, base) {
  const { variants } = baseToken(token);
  const stateful = variants.some((variant) =>
    /^(hover|focus|focus-visible|focus-within|active|group-hover|peer-hover)$/.test(variant),
  );
  return !stateful && baseToken(token).base === base;
}

function tsxFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...tsxFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(absolute);
  }
  return files;
}

/** Every text-destructive element that sits on a persistent destructive tint. */
function tintedDangerTextOffenders() {
  const offenders = [];
  for (const file of tsxFiles(path.join(root, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const relative = path.relative(root, file).split(path.sep).join('/');

    const classText = (node) => {
      const attribute = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === 'className',
      );
      return attribute ? attribute.getText(sourceFile) : '';
    };
    const hasTint = (node) =>
      classTokens(classLiterals(classText(node))).some((token) => persistentToken(token, 'bg-destructive/5') || persistentToken(token, 'bg-destructive/10') || persistentToken(token, 'bg-destructive/15'));
    const hasDangerText = (node) =>
      classTokens(classLiterals(classText(node))).some((token) => persistentToken(token, 'text-destructive'));

    function visitLiterals(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const tokens = node.text.split(/\s+/).filter(Boolean);
        const tinted = tokens.some(
          (token) => persistentToken(token, 'bg-destructive/5') || persistentToken(token, 'bg-destructive/10') || persistentToken(token, 'bg-destructive/15'),
        );
        const dangerText = tokens.some((token) => persistentToken(token, 'text-destructive'));
        if (tinted && dangerText) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          offenders.push(`${relative}:${line}`);
        }
      }
      ts.forEachChild(node, visitLiterals);
    }
    visitLiterals(sourceFile);

    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (hasDangerText(node)) {
          let tinted = hasTint(node);
          for (let parent = node.parent; !tinted && parent; parent = parent.parent) {
            const opening = ts.isJsxElement(parent)
              ? parent.openingElement
              : ts.isJsxSelfClosingElement(parent)
                ? parent
                : null;
            if (opening && hasTint(opening)) {
              tinted = true;
            }
          }
          if (tinted) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            offenders.push(`${relative}:${line}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return [...new Set(offenders)];
}

test('dark error copy on a destructive tint clears 4.5:1 only with the status foreground token', () => {
  const css = read('src/app/globals.css');
  const dark = cssVars(cssBlock(css, '.dark {'));
  const card = hslToRgb(dark['--card'], dark);
  const danger = hslToRgb(dark['--destructive'], dark);
  const dangerForeground = hslToRgb(dark['--status-danger-foreground'], dark);

  for (const alpha of [0.05, 0.1, 0.15]) {
    const tint = composite(danger, alpha, card);
    assert.ok(
      contrast(danger, tint) < 4.5,
      `the fill token must still be the defect at /${alpha * 100} (measured ${contrast(danger, tint).toFixed(2)}:1)`,
    );
    assert.ok(
      contrast(dangerForeground, tint) >= 4.5,
      `status-danger-foreground on a /${alpha * 100} tint measured ${contrast(dangerForeground, tint).toFixed(2)}:1`,
    );
  }
});

test('error text on destructive tints uses the status foreground token', () => {
  const offenders = tintedDangerTextOffenders();
  assert.deepEqual(
    offenders,
    [],
    `error text on a destructive tint must use text-status-danger-foreground: ${offenders.join(', ')}`,
  );
});

test('the tint guard recognises the legacy class pair', () => {
  const literals = classLiterals(`<div className="rounded-lg bg-destructive/10 text-sm text-destructive" />`);
  const tokens = classTokens(literals);
  assert.ok(tokens.some((token) => persistentToken(token, 'bg-destructive/10')));
  assert.ok(tokens.some((token) => persistentToken(token, 'text-destructive')));
  assert.equal(
    classTokens(classLiterals(`<button className="text-destructive hover:bg-destructive/10" />`)).some(
      (token) => persistentToken(token, 'bg-destructive/10'),
    ),
    false,
    'a hover tint is not a persistent surface',
  );
});

test('white text on every solid role token clears 4.5:1', () => {
  const tokens = JSON.parse(read('../contracts/ecosystem/tokens.json'));
  const white = hexToRgb('#FFFFFF');
  for (const [role, colors] of Object.entries(tokens.roleColors)) {
    const measured = contrast(white, hexToRgb(colors.solid));
    assert.ok(measured >= 4.5, `${role}.solid ${colors.solid} measured ${measured.toFixed(2)}:1 with white`);
  }
});

test('the lecturer solid keeps white text readable on its hover state', () => {
  const css = read('src/app/globals.css');
  const vars = cssVars(cssBlock(css, ':root {'));
  const solid = hslToRgb(vars['--role-lecturer-solid'], vars);
  const card = hslToRgb(vars['--card'], vars);
  const hover = composite(solid, 0.9, card);
  assert.ok(
    contrast(hexToRgb('#FFFFFF'), hover) >= 4.5,
    `white on the lecturer hover composite measured ${contrast(hexToRgb('#FFFFFF'), hover).toFixed(2)}:1`,
  );
});

test('the web lecturer solid matches the shared role token', () => {
  const css = read('src/app/globals.css');
  const vars = cssVars(cssBlock(css, ':root {'));
  const tokens = JSON.parse(read('../contracts/ecosystem/tokens.json'));
  const web = hslToRgb(vars['--role-lecturer-solid'], vars).map((channel) => Math.round(channel * 255));
  const contract = hexToRgb(tokens.roleColors.lecturer.solid).map((channel) => Math.round(channel * 255));
  assert.deepEqual(web, contract, 'globals.css and tokens.json must not drift');
});

test('the logged-out page paints with theme tokens readable in both schemes', () => {
  const css = read('src/app/globals.css');
  for (const selector of [':root {', '.dark {']) {
    const vars = cssVars(cssBlock(css, selector));
    const background = hslToRgb(vars['--background'], vars);
    for (const token of ['--muted-foreground', '--primary']) {
      const measured = contrast(hslToRgb(vars[token], vars), background);
      assert.ok(measured >= 4.5, `${selector} ${token} on background measured ${measured.toFixed(2)}:1`);
    }
  }

  const page = read('src/app/session/logged-out/page.tsx');
  assert.match(page, /text-muted-foreground/, 'the body copy must use the muted foreground token');
  assert.match(page, /text-primary/, 'the return link must use the primary token');
  assert.doesNotMatch(page, /#[0-9a-fA-F]{3,8}\b/, 'inline hex colours do not follow the dark theme');
});
