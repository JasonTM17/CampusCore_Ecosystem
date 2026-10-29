#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = path.join(repoRoot, 'docs', 'ecosystem', 'README.md');
const readme = readFileSync(readmePath, 'utf8');

test('ecosystem documentation index contains the task-based sections', () => {
  const requiredSections = [
    'Onboarding and local setup',
    'Product and domain contracts',
    'Identity',
    'Verification',
    'Operations and runbooks',
    'Observability',
    'Demo data',
    'Release',
    'Mobile policy',
  ];
  for (const section of requiredSections) {
    assert.match(readme, new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `${section} section is required`);
  }
  assert.match(readme, /^### Policy docs$/m, 'policy documents should be distinguished');
  assert.match(readme, /^### Runbooks$/m, 'runbooks should be distinguished');
});

test('every relative documentation link resolves to an existing target', () => {
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1].trim());
  assert.ok(links.length > 0, 'the index should contain links');

  for (const href of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
    const relativeTarget = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    assert.ok(relativeTarget.length > 0, `link target must not be empty: ${href}`);
    const target = path.resolve(path.dirname(readmePath), relativeTarget);
    assert.ok(existsSync(target), `relative link does not exist: ${href}`);
    assert.ok(statSync(target).isFile(), `relative link must target a file: ${href}`);
  }
});

test('index stays link-only and contains no machine-specific absolute paths', () => {
  assert.doesNotMatch(readme, /(?:^|\s)[A-Za-z]:[\\/]|(?:^|\s)\\\\|(?:^|\s)\/(?:Users|home|tmp|mnt)\//m);
  const contentLines = readme.split(/\r?\n/).filter((line) => line.trim() !== '');
  for (const line of contentLines) {
    assert.ok(
      /^#{1,3} .+$/.test(line) || /^- \[[^\]]+\]\([^)]+\)$/.test(line),
      `index content should be headings or links: ${line}`,
    );
  }
});
