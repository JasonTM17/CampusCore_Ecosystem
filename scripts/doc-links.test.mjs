#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Markdown-aware link extractor that accurately skips fenced code blocks,
 * inline code, and non-link brackets/regexes.
 *
 * @param {string} content Markdown document content
 * @returns {Array<{label: string, target: string, raw: string}>}
 */
export function extractMarkdownLinks(content) {
  // Strip fenced code blocks (``` ... ``` or ~~~ ... ~~~)
  const text = content.replace(/(?:```|~~~)[^`~]*?(?:```|~~~)/gs, '');
  const links = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (ch === '`') {
      // Inline code outside link label: skip until closing backtick
      let j = i + 1;
      while (j < n && text[j] !== '`') {
        if (text[j] === '\n' && text.slice(j, j + 2) === '\n\n') break;
        j++;
      }
      i = j < n && text[j] === '`' ? j + 1 : j;
      continue;
    }

    if (ch === '[') {
      let j = i + 1;
      let inCode = false;
      let labelEnd = -1;

      while (j < n) {
        if (text[j] === '`') {
          inCode = !inCode;
        } else if (text[j] === ']' && !inCode) {
          labelEnd = j;
          break;
        } else if (text[j] === '\n' && text.slice(j, j + 2) === '\n\n') {
          break;
        }
        j++;
      }

      if (labelEnd !== -1 && labelEnd + 1 < n && text[labelEnd + 1] === '(') {
        let k = labelEnd + 2;
        let parenDepth = 1;
        let targetEnd = -1;

        while (k < n) {
          if (text[k] === '(') parenDepth++;
          else if (text[k] === ')') {
            parenDepth--;
            if (parenDepth === 0) {
              targetEnd = k;
              break;
            }
          } else if (text[k] === '\n') {
            break;
          }
          k++;
        }

        if (targetEnd !== -1) {
          const label = text.slice(i + 1, labelEnd);
          const rawTarget = text.slice(labelEnd + 2, targetEnd).trim();
          links.push({ label, target: rawTarget, raw: text.slice(i, targetEnd + 1) });
          i = targetEnd + 1;
          continue;
        }
      }
    }

    i++;
  }

  return links;
}

/**
 * Classifies a markdown link target into categories:
 * - host-specific (file:///, Windows drive letter, UNC, user home)
 * - external (http://, https://, mailto:, etc.)
 * - anchor (#...)
 * - regex-or-code (non-capturing groups, regex expressions)
 * - relative (valid relative or repo-relative link)
 *
 * @param {string} target
 * @returns {'host-specific' | 'external' | 'anchor' | 'regex-or-code' | 'relative'}
 */
export function classifyTarget(target) {
  if (
    /^file:\/\//i.test(target) ||
    /^[A-Za-z]:[\\/]/.test(target) ||
    /^\\\\/.test(target) ||
    /^\/(?:Users|home|tmp|mnt)\//.test(target)
  ) {
    return 'host-specific';
  }

  if (/^(?:https?:\/\/|mailto:|ftp:\/\/|\/\/)/i.test(target)) {
    return 'external';
  }

  if (target.startsWith('#')) {
    return 'anchor';
  }

  if (/^\?(?::|!|=|<)/.test(target) || /[\^|\\{}]/.test(target)) {
    return 'regex-or-code';
  }

  return 'relative';
}

describe('Markdown-aware link parser fixtures', () => {
  test('extracts standard and code-labeled relative markdown links', () => {
    const md = 'See [Guide](docs/guide.md) and [`Config`](../config.json#L10).';
    const links = extractMarkdownLinks(md);
    assert.equal(links.length, 2);
    assert.equal(links[0].label, 'Guide');
    assert.equal(links[0].target, 'docs/guide.md');
    assert.equal(links[1].label, '`Config`');
    assert.equal(links[1].target, '../config.json#L10');
  });

  test('skips fenced code blocks completely', () => {
    const md = [
      '# Title',
      '```markdown',
      '[fenced link](broken-inside-code.md)',
      '```',
      'Normal [link](real.md).',
    ].join('\n');
    const links = extractMarkdownLinks(md);
    assert.equal(links.length, 1);
    assert.equal(links[0].target, 'real.md');
  });

  test('skips standalone inline code and does not treat backticked brackets as links', () => {
    const md = 'Regex `([?&]` + `(?:token=)[^&]+` and `[not a link](also-not.md)` inside code.';
    const links = extractMarkdownLinks(md);
    assert.equal(links.length, 0);
  });

  test('classifies link targets correctly', () => {
    assert.equal(classifyTarget('file:///D:/workspace/repo/docs/guide.md'), 'host-specific');
    assert.equal(classifyTarget('D:/workspace/repo/foo.md'), 'host-specific');
    assert.equal(classifyTarget('C:\\Users\\example\\doc.md'), 'host-specific');
    assert.equal(classifyTarget('/Users/user/doc.md'), 'host-specific');

    assert.equal(classifyTarget('https://example.com'), 'external');
    assert.equal(classifyTarget('http://localhost:4010'), 'external');
    assert.equal(classifyTarget('mailto:test@example.com'), 'external');

    assert.equal(classifyTarget('#render-cold-start-mitigation'), 'anchor');

    assert.equal(classifyTarget('?:access_token|refresh_token'), 'regex-or-code');

    assert.equal(classifyTarget('attendance-geofence-spec.md'), 'relative');
    assert.equal(classifyTarget('../../contracts/ecosystem/domain-contracts.md#L5-L15'), 'relative');
  });
});

describe('Tracked-file host path hygiene', () => {
  // Generic placeholders (example/user) document the shape, not a real host.
  const genericNames = new Set(['example', 'user', 'username', 'name']);
  const windowsProfile = /[A-Za-z]:[\\/]+Users[\\/]+([A-Za-z0-9_.-]+)/g;
  const macProfile = /\/Users\/([A-Za-z0-9_.-]+)/g;

  test('no tracked file embeds a checkout path or a concrete user-profile directory', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    const rootPosix = repoRoot.replace(/\\/g, '/');
    const rootWindows = repoRoot.replace(/\//g, '\\');
    const offenders = [];
    for (const file of tracked) {
      const absolute = path.join(repoRoot, file);
      if (!statSync(absolute).isFile()) continue;
      const content = readFileSync(absolute, 'utf8');
      if (content.includes(rootPosix) || content.includes(rootWindows)
          || /[A-Za-z]:[\\/]+CampusUTE/.test(content)) {
        offenders.push(`${file}: embeds a checkout-specific absolute path`);
        continue;
      }
      const profiles = [...content.matchAll(windowsProfile), ...content.matchAll(macProfile)]
        .map((match) => match[1]);
      if (profiles.some((name) => !genericNames.has(name.toLowerCase()))) {
        offenders.push(`${file}: embeds a host user-profile path`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe('Owned documentation portability and relative link resolution', () => {
  const ownedDocs = [
    'docs/ecosystem/attendance-operations-runbook.md',
    'docs/ecosystem/observability.md',
    'ops/monitoring/README.md',
    'java-services/restful-api/README.md',
    'docs/ecosystem/README.md',
  ];

  for (const relFile of ownedDocs) {
    const absFile = path.join(repoRoot, relFile);

    test(`${relFile} exists and has zero host-specific links`, () => {
      assert.ok(existsSync(absFile), `${relFile} must exist`);
      const content = readFileSync(absFile, 'utf8');

      // Assert no host-specific links or drive letter patterns
      assert.doesNotMatch(
        content,
        /file:\/\/\//i,
        `${relFile} must not contain file:/// URLs`,
      );
      assert.doesNotMatch(
        content,
        /(?:^|[\s"'`(<])[A-Za-z]:[\\/]/,
        `${relFile} must not contain Windows drive paths`,
      );
      assert.doesNotMatch(
        content,
        /(?:^|[\s"'`(<])\/(?:Users|home|tmp|mnt)\//,
        `${relFile} must not contain host user home directory paths`,
      );
    });

    test(`${relFile} all relative links resolve to existing targets on disk`, () => {
      const content = readFileSync(absFile, 'utf8');
      const docDir = path.dirname(absFile);
      const links = extractMarkdownLinks(content);

      for (const link of links) {
        const kind = classifyTarget(link.target);
        if (kind === 'relative') {
          const cleanTarget = decodeURIComponent(link.target.split(/[?#]/, 1)[0]);
          assert.ok(cleanTarget.length > 0, `Link target in ${relFile} must not be empty`);
          const targetPath = path.resolve(docDir, cleanTarget);
          assert.ok(
            existsSync(targetPath),
            `Broken relative link in ${relFile}: [${link.label}](${link.target}) -> resolved to ${targetPath}`,
          );
          assert.ok(
            statSync(targetPath).isFile() || statSync(targetPath).isDirectory(),
            `Target must be file or directory: ${targetPath}`,
          );
        } else if (kind === 'host-specific') {
          assert.fail(`Host-specific link found in ${relFile}: ${link.target}`);
        }
      }
    });
  }
});

describe('Residual version and onboarding contract invariants', () => {
  test('java-services/restful-api/README.md references Spring Boot 4.1 matching POM, with no stale Boot 3.5', () => {
    const readmePath = path.join(repoRoot, 'java-services', 'restful-api', 'README.md');
    const pomPath = path.join(repoRoot, 'java-services', 'restful-api', 'pom.xml');

    const readme = readFileSync(readmePath, 'utf8');
    const pom = readFileSync(pomPath, 'utf8');

    // Extract Spring Boot parent version from pom.xml
    const pomMatch = pom.match(/<artifactId>spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)<\/version>/);
    assert.ok(pomMatch, 'pom.xml must specify spring-boot-starter-parent version');
    const expectedMajorMinor = pomMatch[1].split('.').slice(0, 2).join('.');

    // Verify README does not contain stale Spring Boot 3.5
    assert.doesNotMatch(readme, /Spring Boot 3\.5/i, 'README must not contain stale Spring Boot 3.5');

    // Verify README states Spring Boot 4.1
    assert.match(
      readme,
      new RegExp(`Spring Boot\\s+${expectedMajorMinor.replace('.', '\\.')}`, 'i'),
      `README must state Spring Boot ${expectedMajorMinor}`,
    );
  });

  test('docs/ecosystem/README.md marks historical demo acceptance criteria as historical', () => {
    const readmePath = path.join(repoRoot, 'docs', 'ecosystem', 'README.md');
    const readme = readFileSync(readmePath, 'utf8');

    assert.match(
      readme,
      /^- \[Demo acceptance criteria \(historical\)\]\(demo-acceptance\.md\)$/m,
      'docs/ecosystem/README.md must mark demo acceptance criteria as historical',
    );
  });
});

describe('Ecosystem policy documentation contract invariants', () => {
  function readPolicy(relativePath) {
    return readFileSync(path.join(repoRoot, relativePath), 'utf8');
  }

  test('mobile policy states the boot-refresh deadline and terminal outcome consistently', () => {
    const doc = readPolicy('docs/ecosystem/mobile-policy.md');
    const start = doc.indexOf('**Boot sequence & timeout (KM-17)**');
    assert.ok(start !== -1, 'boot-sequence policy is required');
    const boot = doc.slice(start, doc.indexOf('## 4.', start)).replace(/\s+/g, ' ');

    assert.match(boot, /20 giây/, 'boot refresh must use the 20-second session-store deadline');
    assert.match(boot, /reauthRequired/, 'a boot-refresh timeout must end the session');
    assert.match(boot, /OIDC authorization code/, 'the 10-second deadline belongs to the code exchange');
    assert.match(boot, /10 giây/, 'the code exchange must document its 10-second deadline');
    assert.doesNotMatch(
      boot,
      /Cả boot refresh và trao đổi OIDC code/,
      'boot refresh and the OIDC code exchange must not share one deadline',
    );
  });

  test('host policy separates BFF-generated errors from proxied upstream errors', () => {
    const doc = readPolicy('docs/ecosystem/host-policy.md');
    const bullet = doc.split(/\r?\n/).find((line) => line.startsWith('- `ANY /bff/api/**`'));
    assert.ok(bullet, 'business-proxy error contract is required');

    assert.match(bullet, /BFF/, 'BFF-generated errors must be named as the error+code envelope owner');
    assert.match(bullet, /ErrorResponse/, 'proxied upstream errors must name ErrorResponse');
    assert.match(bullet, /không có trường `error`/, 'proxied upstream errors must state the code-only shape');
  });

  test('identity contract separates a missing refresh token from a replay', () => {
    const doc = readPolicy('docs/ecosystem/identity-contract.md');
    const rows = doc.split(/\r?\n/);
    const missing = rows.find((line) => line.startsWith('| C2 |'));
    const replay = rows.find((line) => line.startsWith('| C2a |'));

    assert.ok(missing, 'C2 must cover the missing/blank refresh token');
    assert.match(missing, /thiếu\/rỗng/);
    assert.match(missing, /401/);
    assert.match(missing, /không revoke/);
    assert.match(missing, /không warn/);
    assert.doesNotMatch(missing, /deleteAllRefreshSessions/, 'a missing credential has no family to revoke');

    assert.ok(replay, 'C2a must cover refresh replay');
    assert.match(replay, /revokeAllLanes/);
    assert.match(replay, /REFRESH_TOKEN_REUSE/);
    assert.match(replay, /401/);
  });
});
