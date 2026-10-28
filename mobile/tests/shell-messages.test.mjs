import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(mobileRoot, file), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-shell-'));
const { outputText } = ts.transpileModule(read('src/i18n/shell-messages.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
fs.writeFileSync(path.join(tmp, 'shell-messages.mjs'), outputText);
const { shellMessages, localizedNavLabel, fillShellCopy } = await import(
  pathToFileURL(path.join(tmp, 'shell-messages.mjs')).href
);

const routes = read('src/navigation/routes.ts');
const screenNames = [...routes.matchAll(/^\s*\{ name: '([^']+)', title:/gm)].map((m) => m[1]);
const laneIds = [...routes.matchAll(/^\s*\{ id: '([a-z]+\.[A-Za-z]+)', title:/gm)].map((m) => m[1]);
const navLabels = [...routes.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);

test('every registry screen and lane has a title in both locales', () => {
  assert.ok(screenNames.length >= 34 && laneIds.length >= 11);
  for (const locale of ['vi', 'en']) {
    for (const name of screenNames) {
      assert.ok(shellMessages[locale].screens[name], `${locale} screen ${name}`);
    }
    for (const id of laneIds) {
      assert.ok(shellMessages[locale].lanes[id], `${locale} lane ${id}`);
    }
  }
});

test('every bottom navigation label localizes and both locales share the same keys', () => {
  for (const label of navLabels) {
    assert.notEqual(localizedNavLabel('vi', label), label, `vi nav ${label}`);
    assert.equal(localizedNavLabel('en', label), label, `en nav ${label}`);
  }
  const keys = (value) => Object.keys(value).sort();
  assert.deepEqual(keys(shellMessages.vi), keys(shellMessages.en));
  assert.deepEqual(keys(shellMessages.vi.dashboard), keys(shellMessages.en.dashboard));
});

test('placeholders fill and unknown ones collapse to empty', () => {
  assert.equal(fillShellCopy(shellMessages.vi.dashboard.activeSections, { n: 3 }), '3 lớp đang học');
  assert.equal(fillShellCopy('{x}-{y}', { x: 1 }), '1-');
});
