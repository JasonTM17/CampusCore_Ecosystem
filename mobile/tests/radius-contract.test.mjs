import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const numericRadiusPattern = /\bborder(?:TopLeft|TopRight|BottomLeft|BottomRight)?Radius\s*(?::\s*|=\s*(?:\{\s*)?)(-?\d+(?:\.\d+)?)(?=\s*(?:,|}|$))/g;
const pillPattern = /(?:tokens\.)?radii\.pill\b/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function relativeSourcePath(path) {
  return relative(sourceRoot, path).replaceAll('\\', '/');
}

function numericRadiusIsAllowed(path, value, line) {
  if (path === 'components/ui/avatar.tsx' || path === 'components/AssistantFab.tsx') return true;
  if (path === 'components/perf/group-card.tsx') return value === 0;
  if (path === 'components/ui/chart-summary.tsx') {
    return (value === 4 && /height:\s*8\b/.test(line)) || (value === 2 && /height:\s*Math\.max/.test(line));
  }
  if (path === 'components/ui/file-row.tsx') {
    return value === 2 && /height:\s*4\b/.test(line);
  }
  return false;
}

function pillIsAllowed(path, lines, index) {
  const context = lines.slice(Math.max(0, index - 6), index + 1).join('\n');
  const componentByPath = {
    'components/AssistantFab.tsx': /\bbutton\s*:\s*\{/,
    'components/PreviewPill.tsx': /\bpill\s*:\s*\{/,
    'components/Ui.tsx': /\b(?:badge|unreadLabel)\s*:\s*\{/,
    'components/ui/avatar.tsx': /\bchip\s*:\s*\{/,
    'components/ui/institutional.tsx': /\bpill\s*:\s*\{/,
    'screens/thesis/ThesisProgressScreen.tsx': /\bmilestoneNode\s*:\s*\{/,
    'screens/thesis/thesis-ui.tsx': /\bstepNode\s*:\s*\{/,
  };
  return Boolean(componentByPath[path]?.test(context));
}

test('numeric radius scanner recognizes JSX literal props', () => {
  const fixture = '<Skeleton borderRadius={999} />';
  const match = fixture.match(new RegExp(numericRadiusPattern.source));
  assert.equal(Number(match?.[1]), 999);
  assert.equal(numericRadiusIsAllowed('components/ui/primitives.tsx', 999, fixture), false);
});

test('numeric border radii stay tokenized outside explicit small-track and circular exceptions', () => {
  const violations = [];
  for (const file of sourceFiles(sourceRoot)) {
    const path = relativeSourcePath(file);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(numericRadiusPattern)) {
        const value = Number(match[1]);
        if (!numericRadiusIsAllowed(path, value, line)) {
          violations.push(`${path}:${index + 1}: borderRadius ${value}`);
        }
      }
    });
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('pill radii stay limited to status, preview, avatar, and step indicators', () => {
  const violations = [];
  for (const file of sourceFiles(sourceRoot)) {
    const path = relativeSourcePath(file);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pillPattern.test(line) && !pillIsAllowed(path, lines, index)) {
        violations.push(`${path}:${index + 1}: radii.pill`);
      }
    });
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});
