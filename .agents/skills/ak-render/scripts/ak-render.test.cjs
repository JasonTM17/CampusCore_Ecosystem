'use strict';

// Run: node --test engineer/skills/ak-render/scripts/ak-render.test.cjs
// Offline helper and process-boundary checks; no network or ak-render download.

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  slugify,
  parseHelp,
  compareVersions,
  nodeVersionOk,
  defaultOutFor,
  visualPaths,
  shouldOpen,
  pinnedVersion,
  placeholderHits,
  vietnameseAccentCheck,
  parseArgs,
  parseJson,
  DEFAULT_VERSION,
} = require('./ak-render.cjs');

test('slugify keeps ak-preview rules and folds Vietnamese', () => {
  assert.equal(slugify('Kế hoạch Di chuyển API!'), 'ke-hoach-di-chuyen-api');
  assert.equal(slugify('Đánh giá  diff -- main'), 'danh-gia-diff-main');
  assert.equal(slugify('***'), '');
  const long = slugify('word '.repeat(40));
  assert.ok(long.length <= 80, long);
  assert.ok(!long.endsWith('-'));
});

test('parseHelp reads the Commands section of 0.3.0 help', () => {
  const help = [
    'Usage:',
    '  ak-render <spec.yaml|spec.json|-> [--out <file.html>]',
    '  ak-render describe <type...> [--compact] [--json]',
    '',
    'Commands:',
    '  compile        Compile a Page Spec.',
    '  validate       Validate a Page Spec.',
    '  search-catalog Find block types.',
    '  mcp            Serve tools.',
    '',
    'The first positional argument may be a spec path.',
  ].join('\n');
  const parsed = parseHelp(help);
  // A long name fills its column and leaves one space before the summary.
  assert.deepEqual(parsed.commands, ['compile', 'validate', 'search-catalog', 'mcp']);
  assert.equal(parsed.flags.compact, true);
  assert.equal(parsed.flags.suggest, false);
});

test('parseHelp tolerates CRLF and single-space command columns', () => {
  const parsed = parseHelp('Commands:\r\n  repair   Apply safe fixes.\r\n  audit-ui  Check UI.\r\n');
  assert.deepEqual(parsed.commands, ['repair', 'audit-ui']);
});

test('compareVersions orders semver triples', () => {
  assert.ok(compareVersions('0.3.0', '0.2.9') > 0);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.ok(compareVersions('0.3.0', '0.10.0') < 0);
});

test('nodeVersionOk enforces 20.11', () => {
  assert.equal(nodeVersionOk('20.10.0'), false);
  assert.equal(nodeVersionOk('20.11.0'), true);
  assert.equal(nodeVersionOk('24.1.0'), true);
});

test('defaultOutFor strips .page.yaml and plain extensions', () => {
  assert.equal(defaultOutFor(path.join('a', 'x.page.yaml')), path.join('a', 'x.html'));
  assert.equal(defaultOutFor(path.join('a', 'x.json')), path.join('a', 'x.html'));
});

test('visualPaths is plan-aware and rejects empty topics', () => {
  const root = path.resolve('repo');
  const noPlan = visualPaths('Recap tuần', { root });
  assert.equal(noPlan.spec, path.join(root, 'plans', 'visuals', 'recap-tuan.page.yaml'));
  const withPlan = visualPaths('Recap', { root, planDir: path.join('plans', '261022-x') });
  assert.equal(withPlan.html, path.join(root, 'plans', '261022-x', 'visuals', 'recap.html'));
  assert.throws(() => visualPaths('!!!', { root }), /empty/);
});

test('shouldOpen opens only a new page outside CI', () => {
  assert.equal(shouldOpen({ existedBefore: false, noOpen: false, env: {} }), true);
  assert.equal(shouldOpen({ existedBefore: true, noOpen: false, env: {} }), false);
  assert.equal(shouldOpen({ existedBefore: false, noOpen: true, env: {} }), false);
  assert.equal(shouldOpen({ existedBefore: false, noOpen: false, env: { CI: 'true' } }), false);
  assert.equal(shouldOpen({ existedBefore: false, noOpen: false, env: { AK_RENDER_NO_OPEN: '1' } }), false);
});

test('pinnedVersion accepts exact versions only', () => {
  assert.equal(pinnedVersion({}), DEFAULT_VERSION);
  assert.equal(pinnedVersion({ AK_RENDER_VERSION: '0.4.0-next.1' }), '0.4.0-next.1');
  assert.throws(() => pinnedVersion({ AK_RENDER_VERSION: 'latest' }), /exact version/);
  assert.throws(() => pinnedVersion({ AK_RENDER_VERSION: '0.3.0 && calc' }), /exact version/);
});

test('placeholderHits flags template markers but ignores comments', () => {
  const spec = [
    '# <<comment placeholder is fine>>',
    'title: <<Plan title>>',
    'text: real text',
    'note: TODO later',
  ].join('\n');
  const hits = placeholderHits(spec).map((h) => h.line);
  assert.deepEqual(hits, [2, 4]);
  assert.deepEqual(placeholderHits('text: a `<div>` and `<<x>>` in code'), []);
  assert.deepEqual(placeholderHits('text: a <b> tag-like word'), []);
  // Lower-case words are real content (a kanban column, a Vietnamese word), not markers.
  assert.deepEqual(placeholderHits('title: todo list for tbd items'), []);
  assert.equal(placeholderHits('text: Lorem Ipsum filler').length, 1);
});

test('parseArgs rejects unknown and valueless options', () => {
  const parsed = parseArgs(['page.yaml', '--out', 'p.html', '--no-open'], ['out'], ['no-open']);
  assert.deepEqual(parsed, { positional: ['page.yaml'], opts: { out: 'p.html', 'no-open': true } });
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['--out'], ['out']), /needs a value/);
  assert.throws(() => parseArgs(['--out', '--no-open'], ['out'], ['no-open']), /needs a value/);
  assert.throws(() => parseArgs(['--plan-dir', '--force'], ['plan-dir'], ['force']), /needs a value/);
  assert.throws(() => parseArgs(['--out', ''], ['out']), /needs a value/);
});

test('parseJson recovers JSON wrapped in noise', () => {
  assert.deepEqual(parseJson('{"ok":true}'), { ok: true });
  assert.deepEqual(parseJson('npm warn x\n{"ok":false}\n'), { ok: false });
  assert.equal(parseJson(''), null);
  assert.equal(parseJson('not json'), null);
});

function cliFixture(t, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-render boundary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(dir, 'test-cli.js');
  const spec = path.join(dir, 'page.yaml');
  const html = path.join(dir, 'page.html');
  fs.writeFileSync(spec, 'meta:\n  title: Verified evidence\n');
  fs.writeFileSync(cli, `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const command = args[0];
    const scenario = process.env.AK_RENDER_TEST_SCENARIO;
    function reply(value, code = 0) {
      process.stdout.write(JSON.stringify(value));
      process.exit(code);
    }
    if (command === '--version') { process.stdout.write('0.4.0'); process.exit(0); }
    if (command === '--help') {
      process.stdout.write('Commands:\\n  compile Compile.\\n  validate Validate.\\n  audit-ui Audit.\\n  themes Themes.\\n  catalog Catalog.\\n');
      process.exit(scenario === 'help-failure' ? 1 : 0);
    }
    if (command === 'themes') {
      if (scenario === 'themes-failure') reply({ ok: false }, 1);
      if (scenario === 'themes-malformed') reply({ themes: 'invalid' });
      reply([{ name: 'blueprint' }]);
    }
    if (command === 'catalog') {
      if (scenario === 'catalog-failure') reply({ ok: false }, 1);
      if (scenario === 'catalog-malformed') reply({ blocks: 'invalid' });
      reply({ blockCount: 1, blocks: [{ type: 'hero' }] });
    }
    if (command === 'validate') reply({ ok: true, diagnostics: [] }, scenario === 'validate-failure' ? 1 : 0);
    if (command === 'audit-ui') {
      if (scenario === 'audit-failure') reply({ ok: false, findings: [{ code: 'UI_ERROR' }] }, 1);
      if (scenario === 'audit-malformed') { process.stdout.write('invalid JSON'); process.exit(0); }
      reply({ ok: true, findings: [] });
    }
    if (scenario === 'compile-failure') reply({ ok: false });
    fs.writeFileSync(args[args.indexOf('--out') + 1], '<!doctype html><title>Fixture</title>');
    reply({ hash: 'fixture-hash', theme: 'blueprint' });
  `);
  return {
    spec,
    html,
    run(...args) {
      const result = spawnSync(process.execPath, [path.join(__dirname, 'ak-render.cjs'), ...args], {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, AK_RENDER_BIN: cli, AK_RENDER_NO_OPEN: '1', AK_RENDER_TEST_SCENARIO: scenario },
      });
      assert.ifError(result.error);
      return { status: result.status, summary: JSON.parse(result.stdout) };
    },
  };
}

for (const scenario of ['help-failure', 'themes-failure', 'themes-malformed', 'catalog-failure', 'catalog-malformed']) {
  test(`doctor rejects ${scenario}`, (t) => {
    const fixture = cliFixture(t, scenario);
    const result = fixture.run('doctor');
    assert.equal(result.status, 3);
    assert.equal(result.summary.ok, false);
    assert.equal(result.summary.status, 'BLOCKED');
  });
}

test('check and build reject validator process failure despite affirmative JSON', (t) => {
  const fixture = cliFixture(t, 'validate-failure');
  for (const command of ['check', 'build']) {
    const result = fixture.run(command, fixture.spec);
    assert.equal(result.status, 1);
    assert.equal(result.summary.ok, false);
  }
  assert.equal(fs.existsSync(fixture.html), false);
});

for (const scenario of ['audit-failure', 'audit-malformed']) {
  test(`build rejects ${scenario} before opening`, (t) => {
    const fixture = cliFixture(t, scenario);
    const result = fixture.run('build', fixture.spec);
    assert.equal(result.status, 1);
    assert.equal(result.summary.ok, false);
    assert.equal(result.summary.stage, 'audit-ui');
    assert.notEqual(result.summary.opened, true);
  });
}

test('build rejects explicit compiler failure despite an existing HTML file', (t) => {
  const fixture = cliFixture(t, 'compile-failure');
  fs.writeFileSync(fixture.html, 'previous output');
  const result = fixture.run('build', fixture.spec);
  assert.equal(result.status, 1);
  assert.equal(result.summary.stage, 'compile');
});

test('doctor and build retain the successful runner path', (t) => {
  const fixture = cliFixture(t, 'success');
  assert.equal(fixture.run('doctor').status, 0);
  const result = fixture.run('build', fixture.spec);
  assert.equal(result.status, 0);
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.opened, false);
  assert.equal(result.summary.steps.find((step) => step.step === 'audit-ui').status, 'PASS');
  assert.ok(fs.existsSync(fixture.html));
});

test('vietnameseAccentCheck fails an unaccented vi page and passes real Vietnamese', () => {
  const unaccented = [
    'meta:',
    '  title: AgentKit recap',
    '  description: 2 tuan gan nhat tinh den 2026-10-22',
    '  locale: vi',
    'blocks:',
    '  - type: hero',
    '    description: "8 commit trong 2 tuan gan nhat, worktree hien dang o detached HEAD"',
  ].join('\n');
  const bad = vietnameseAccentCheck(unaccented);
  assert.equal(bad.applies, true);
  assert.equal(bad.ok, false);
  assert.ok(bad.samples.length > 0);

  // English commit subjects are fine when the authored prose is accented.
  const accented = unaccented.replace(/2 tuan gan nhat/g, '2 tuần gần nhất')
    + '\n      title: "feat(skills): add ak-render page spec renderer"';
  assert.equal(vietnameseAccentCheck(accented).ok, true);

  // Diacritics inside comments or backtick code do not count.
  const fake = unaccented + '\n# ghi chú tiếng Việt\n    text: chay `lệnh` nay';
  assert.equal(vietnameseAccentCheck(fake).ok, false);
});

test('vietnameseAccentCheck ignores other locales and tiny pages', () => {
  assert.equal(vietnameseAccentCheck('meta:\n  locale: en\n  title: Plain English page').applies, false);
  assert.equal(vietnameseAccentCheck('meta:\n  locale: vi\n  title: Recap').ok, true);
  assert.equal(vietnameseAccentCheck('  locale: "vi-VN" # tag\n  title: x').applies, true);
});
