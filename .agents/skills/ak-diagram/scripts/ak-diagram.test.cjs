'use strict';

// Run: node --test engineer/skills/ak-diagram/scripts/ak-diagram.test.cjs
// Offline helper and process-boundary checks; no network, renderer download or Archify install.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  slugify,
  compareVersions,
  route,
  diagramPaths,
  extractMermaidBlocks,
  headerOf,
  lintMermaid,
  parseArgs,
  mmdcVersion,
  resolveMmdc,
  archifyCandidates,
  archifyVersion,
  resolveArchify,
  scanTree,
  outputNames,
  svgActiveContent,
  svgAllowlist,
  DEFAULT_MMDC_VERSION,
} = require('./ak-diagram.cjs');

const SCRIPT = path.join(__dirname, 'ak-diagram.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ak-diagram-test-'));
}

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = null;
  }
  return { status: res.status, json, stdout: res.stdout, stderr: res.stderr };
}

test('slugify folds Vietnamese and caps length', () => {
  assert.equal(slugify('Kiến trúc Hệ thống Đặt hàng'), 'kien-truc-he-thong-dat-hang');
  assert.equal(slugify('***'), '');
  assert.ok(slugify('word '.repeat(40)).length <= 80);
});

test('compareVersions orders semantic versions', () => {
  assert.ok(compareVersions('3.2.0', '3.1.9') > 0);
  assert.equal(compareVersions('3.2.0', '3.2.0'), 0);
  assert.ok(compareVersions('2.10.0', '3.2.0') < 0);
});

test('route defaults to inline Mermaid for docs requests', () => {
  const r = route('checkout API sequence for the README');
  assert.equal(r.engine, 'mermaid');
  assert.equal(r.type, 'sequenceDiagram');
  assert.equal(r.target, 'inline');
  assert.equal(r.via, '/ak:mermaidjs-v11');
});

test('route does not read "market share" as a request to share a page', () => {
  const r = route('market percentage share pie chart');
  assert.equal(r.target, 'inline');
  assert.equal(r.type, 'pie');
  assert.equal(route('a shareable interactive page of the login flow').target, 'interactive');
});

test('route sends repository-backed requests to Archify, in Vietnamese too', () => {
  const r = route('vẽ kiến trúc hệ thống của repo này');
  assert.equal(r.engine, 'archify');
  assert.equal(r.type, 'architecture');
  assert.equal(r.target, 'repo');
});

test('route never sends a kind to an engine that cannot draw it', () => {
  const waterfall = route('latency waterfall for the README');
  assert.equal(waterfall.engine, 'archify');
  assert.equal(waterfall.type, 'waterfall');
  assert.equal(waterfall.target, 'interactive');
  const gantt = route('release roadmap gantt', { target: 'interactive' });
  assert.equal(gantt.engine, 'mermaid');
  const mind = route('mind map of the auth module', { target: 'image' });
  assert.equal(mind.engine, 'mermaid');
  assert.ok(mind.reasons.some((x) => /--format png/.test(x)));
  const spans = route('request waterfall', { target: 'image' });
  assert.equal(spans.engine, 'archify');
  assert.ok(spans.reasons.some((x) => /Export menu/.test(x)));
});

test('route picks tech-graph only for a styled static image', () => {
  assert.equal(route('architecture poster in blueprint style').engine, 'tech-graph');
  assert.equal(route('architecture overview').engine, 'mermaid');
});

test('route escalates large inline diagrams to Archify', () => {
  const r = route('service architecture for the docs', { nodes: 30 });
  assert.equal(r.engine, 'archify');
  assert.ok(r.reasons.some((x) => /30 nodes/.test(x)));
});

test('route rejects bad input', () => {
  assert.throws(() => route('  '), /intent/);
  assert.throws(() => route('x', { target: 'poster' }), /--target/);
  assert.throws(() => route('x', { nodes: '-1' }), /--nodes/);
});

test('diagramPaths keeps each engine under docs/diagrams by default', () => {
  const root = path.resolve('/repo');
  const m = diagramPaths('Order Flow', { engine: 'mermaid', root });
  assert.equal(m.source, path.join(root, 'docs', 'diagrams', 'order-flow.mmd'));
  const a = diagramPaths('Order Flow', { engine: 'archify', type: 'workflow', root });
  assert.equal(a.source, path.join(root, 'docs', 'diagrams', 'order-flow', 'order-flow.workflow.json'));
  assert.equal(a.html, path.join(root, 'docs', 'diagrams', 'order-flow', 'order-flow.html'));
  const t = diagramPaths('Order Flow', { engine: 'tech-graph', dir: 'site/img', root });
  assert.equal(t.png, path.join(root, 'site', 'img', 'order-flow.png'));
  assert.throws(() => diagramPaths('x', { engine: 'plantuml', root }), /--engine/);
  assert.throws(() => diagramPaths('x', { engine: 'archify', type: 'gantt', root }), /--type/);
});

test('extractMermaidBlocks finds backtick and tilde fences with line numbers', () => {
  const md = [
    '# t', '```mermaid', 'flowchart LR', '  A --> B', '```', 'text',
    '~~~~ mermaid', 'pie', '  "a": 1', '~~~~', '```js', 'not mermaid', '```', '```mermaid', 'graph TD',
  ].join('\n');
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.line), [2, 7, 14]);
  assert.equal(blocks[2].unclosed, true);
});

test('headerOf skips frontmatter, init directives and comments', () => {
  const code = ['---', 'title: X', '---', '%%{init: {"theme":"dark"}}%%', '%% note', '', 'sequenceDiagram', 'A->>B: hi'].join('\n');
  assert.equal(headerOf(code).token, 'sequenceDiagram');
  assert.equal(headerOf('\n\n'), null);
});

test('lintMermaid flags unknown types, unsafe content and GitHub-recent types', () => {
  assert.equal(lintMermaid('flowchart TD\n  A --> B').errors.length, 0);
  assert.equal(lintMermaid('flowchrt TD\n A --> B').errors[0].rule, 'diagram/unknown-type');
  assert.equal(lintMermaid('').errors[0].rule, 'diagram/empty');
  assert.ok(lintMermaid('flowchart TD\n A[<script>x</script>]').errors.some((e) => e.rule === 'security/script'));
  assert.ok(lintMermaid('flowchart TD\n A --> B\n click A call cb()').errors.some((e) => e.rule === 'security/click-callback'));
  assert.ok(lintMermaid('architecture-beta\n service a(server)[A]').warnings.some((w) => w.rule === 'github/recent-type'));
  assert.ok(lintMermaid('flowchart TD\n start --> end').warnings.some((w) => w.rule === 'flowchart/end-node'));
  assert.equal(lintMermaid('flowchart TD\n subgraph S\n A --> B\n end').warnings.length, 0);
  assert.equal(lintMermaid('flowchart TD\n A --> B', { unclosed: true }).errors[0].rule, 'fence/unclosed');
});

test('parseArgs separates options, booleans and the passthrough tail', () => {
  const p = parseArgs(['a', '--target', 'repo', '--deep', '--', 'finalize', '--json'], ['target'], ['deep'], { keepRest: true });
  assert.deepEqual(p.positional, ['a']);
  assert.equal(p.opts.target, 'repo');
  assert.equal(p.opts.deep, true);
  assert.deepEqual(p.rest, ['finalize', '--json']);
  assert.throws(() => parseArgs(['--target'], ['target']), /needs a value/);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
});

test('parseArgs keeps files after -- as positional for ordinary commands', () => {
  const p = parseArgs(['a.md', '--', 'b.md', '--odd.md']);
  assert.deepEqual(p.positional, ['a.md', 'b.md', '--odd.md']);
  assert.equal(p.rest, null);
});

test('compareVersions sorts a prerelease before its release', () => {
  assert.ok(compareVersions('3.2.0-rc.1', '3.2.0') < 0);
  assert.ok(compareVersions('3.2.0', '3.2.0-rc.1') > 0);
  assert.ok(compareVersions('v3.3.0-beta', '3.2.0') > 0);
});

test('slugify never yields a Windows device name', () => {
  assert.equal(slugify('CON'), 'con-diagram');
  assert.equal(slugify('com1'), 'com1-diagram');
  assert.equal(slugify('console'), 'console');
});

test('extractMermaidBlocks handles blockquotes, lists and examples inside other fences', () => {
  const md = [
    '> ```mermaid', '> flowchart LR', '>   A --> B', '> ```',
    '- item', '  ```mermaid', '  pie', '  ```',
    '````text', '```mermaid', 'flowchart TD', '```', '````',
  ].join('\n');
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(headerOf(blocks[0].code).token, 'flowchart');
  assert.equal(blocks[0].line, 1);
  assert.equal(headerOf(blocks[1].code).token, 'pie');
});

test('extractMermaidBlocks follows CommonMark container and indentation rules', () => {
  // A list marker directly before the fence.
  const listed = extractMermaidBlocks(['- ```mermaid', '  flowchart LR', '    A --> B', '  ```'].join('\n'));
  assert.equal(listed.length, 1);
  assert.equal(headerOf(listed[0].code).token, 'flowchart');
  assert.equal(listed[0].unclosed, undefined);
  // Four spaces outside a list is an indented code block: a literal example.
  assert.equal(extractMermaidBlocks(['Example:', '', '    ```mermaid', '    pie', '    ```'].join('\n')).length, 0);
  // An unclosed fence inside a quote ends with the quote and cannot hide later diagrams.
  const afterQuote = extractMermaidBlocks(['> ```text', '> still text', '', '```mermaid', 'sequenceDiagram', '  A->>B: hi', '```'].join('\n'));
  assert.equal(afterQuote.length, 1);
  assert.equal(headerOf(afterQuote[0].code).token, 'sequenceDiagram');
  // An unclosed Mermaid fence in a quote is reported as unclosed, not swallowed.
  const unclosed = extractMermaidBlocks(['> ```mermaid', '> pie', '', 'after'].join('\n'));
  assert.equal(unclosed.length, 1);
  assert.equal(unclosed[0].unclosed, true);
});

test('extractMermaidBlocks keeps quote and list containers apart', () => {
  // A list inside a quote does not make a later top-level indented fence a list fence.
  assert.equal(extractMermaidBlocks(['> - item', '', '    ```mermaid', '    pie', '    ```'].join('\n')).length, 0);
  // An unquoted blank line ends the quote, so an unclosed quoted fence cannot swallow the next quote's diagram.
  const md = ['> ```text', '> inside', '', '> ```mermaid', '> flowchart TD', '> A-->B', '> ```'].join('\n');
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(headerOf(blocks[0].code).token, 'flowchart');
});

test('extractMermaidBlocks: deep-indented closer is content; lazy lines keep the list', () => {
  // "    ```" is four spaces deep, so it does not close the fence; the real closer follows.
  const deep = extractMermaidBlocks(['```mermaid', 'flowchart LR', '    ```', '  A-->B', '```'].join('\n'));
  assert.equal(deep.length, 1);
  assert.match(deep[0].code, /A-->B/);
  // An unindented paragraph line right after a list item is a lazy continuation.
  const lazy = extractMermaidBlocks(['- item', 'more text', '   ```mermaid', '   pie', '   ```'].join('\n'));
  assert.equal(lazy.length, 1);
  assert.equal(headerOf(lazy[0].code).token, 'pie');
});

test('extractMermaidBlocks ends a list after a fence and reads ">" alone as a blank quote line', () => {
  // No lazy continuation after a fence: "a" ends the list, so the four-space
  // fence that follows is an indented code block, not a diagram.
  assert.equal(extractMermaidBlocks(['- ```', 'a', '    ```mermaid'].join('\n')).length, 0);
  assert.equal(extractMermaidBlocks(['1. ', '   ```', 't', '    ```mermaid'].join('\n')).length, 0);
  // After the list ends, a top-level mermaid fence is found once, not doubled.
  assert.equal(extractMermaidBlocks(['1.', '   ```', '```', '```mermaid', '```', '```mermaid'].join('\n')).length, 1);
  // ">" alone is blank inside the quote, so a list-indented ```mermaid line
  // after it cannot close the plain fence or start a diagram.
  assert.equal(extractMermaidBlocks(['>- ', '>   ```', '>', '>   ```mermaid'].join('\n')).length, 0);
  // An indented continuation after a fence keeps the list.
  const kept = extractMermaidBlocks(['- step', '  ```text', '  x', '  ```', '  more', '  ```mermaid', '  pie', '  ```'].join('\n'));
  assert.equal(kept.length, 1);
  assert.equal(headerOf(kept[0].code).token, 'pie');
});

test('lintMermaid catches a callback after a semicolon but ignores comments', () => {
  const errs = lintMermaid('flowchart TD\nA-->B;click A callback "Tip"').errors.map((e) => e.rule);
  assert.ok(errs.includes('security/click-callback'));
  assert.deepEqual(lintMermaid('flowchart TD\n%% safe comment;click A callback\nA-->B').errors, []);
});

test('lintMermaid rejects every click callback form and keeps plain links', () => {
  const rule = (code) => lintMermaid(code).errors.map((e) => e.rule);
  assert.ok(rule('flowchart TD\n A-->B\n click A callback "Tip"').includes('security/click-callback'));
  assert.ok(rule('flowchart TD\n A-->B\n click A myFn').includes('security/click-callback'));
  assert.ok(rule('flowchart TD\n A-->B\n click A call cb()').includes('security/click-callback'));
  assert.deepEqual(rule('flowchart TD\n A-->B\n click A href "https://example.com"'), []);
  assert.deepEqual(rule('flowchart TD\n A-->B\n click A "https://example.com" "Tip"'), []);
});

test('route maps each chart request to its own Mermaid chart type', () => {
  assert.equal(route('pie chart of traffic share').type, 'pie');
  assert.equal(route('effort impact quadrant for the roadmap').type, 'quadrantChart');
  assert.equal(route('bar chart of build times').type, 'xychart-beta');
  const cmp = route('feature comparison matrix of three vendors');
  assert.equal(cmp.engine, 'tech-graph');
  assert.equal(cmp.type, 'comparison-matrix');
});

test('outputNames never lets two inputs write the same file', () => {
  const root = path.resolve('/repo');
  const names = outputNames([
    { abs: path.join(root, 'docs', 'a', 'README.md'), blocks: [{}] },
    { abs: path.join(root, 'docs', 'b', 'README.md'), blocks: [{}, {}] },
    { abs: path.join(root, 'flow.mmd'), blocks: [{}] },
  ], 'svg', root);
  const flat = names.flat();
  assert.equal(new Set(flat).size, flat.length);
  assert.deepEqual(flat, ['docs-a-readme-1.svg', 'docs-b-readme-1.svg', 'docs-b-readme-2.svg', 'flow.svg']);
  assert.deepEqual(outputNames([{ abs: path.join(root, 'flow.mmd'), blocks: [{}] }], 'png', root), [['flow.png']]);
  // Generated suffixes are reserved too.
  const tricky = outputNames(['a-b.mmd', 'a_b.mmd', 'a-b-2.mmd'].map((f) => ({ abs: path.join(root, f), blocks: [{}] })), 'svg', root).flat();
  assert.equal(new Set(tricky).size, 3, tricky.join(', '));
});

test('svgActiveContent flags markup that runs or loads something', () => {
  assert.deepEqual(svgActiveContent('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>'), []);
  assert.ok(svgActiveContent('<svg><rect fill="white"/><script>alert(1)</script></svg>').includes('<script>'));
  assert.ok(svgActiveContent('<svg><rect onload="x()"/></svg>').includes('event handler attribute'));
  assert.ok(svgActiveContent('<svg><a href="javascript:alert(1)"/></svg>').includes('non-local link'));
  assert.ok(svgActiveContent('<svg><image href="https://x.test/a.png"/></svg>').includes('non-local link'));
  // Entity-encoded and whitespace-split script URLs are still caught.
  assert.ok(svgActiveContent('<svg><a href="jav&#x61;script:alert(1)"><rect/></a></svg>').includes('non-local link'));
  assert.ok(svgActiveContent('<svg><a xlink:href="&#106;ava&#9;script&colon;x"/></svg>').includes('non-local link'));
  assert.ok(svgActiveContent('<svg><rect style="fill:url(&#106;avascript:x)"/></svg>').includes('script URL'));
  // Internal references stay allowed.
  assert.deepEqual(svgActiveContent('<svg><use href="#node"/><path marker-end="url(#arrow)"/></svg>'), []);
  assert.ok(svgActiveContent('<svg><foreignObject/></svg>').includes('<foreignObject>'));
  assert.ok(svgActiveContent('<svg><s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script></svg>').includes('<script>'));
  assert.ok(svgActiveContent('<svg><rect ev:onclick="x()"/></svg>').includes('event handler attribute'));
  assert.ok(svgActiveContent('<svg><a><set attributeName="href" to="javascript:x"/></a></svg>').length > 0);
  assert.ok(svgActiveContent('<svg><é:script xmlns:é="http://www.w3.org/2000/svg">alert(1)</é:script></svg>').includes('<script>'));
  assert.ok(svgActiveContent('<svg><rect ü:onload="x()"/></svg>').includes('event handler attribute'));
});

test('mermaid-cli pin accepts exact versions only', () => {
  assert.equal(mmdcVersion({}), DEFAULT_MMDC_VERSION);
  assert.equal(mmdcVersion({ AK_DIAGRAM_MMDC_VERSION: '12.0.0' }), '12.0.0');
  assert.throws(() => mmdcVersion({ AK_DIAGRAM_MMDC_VERSION: 'latest' }), /exact version/);
  assert.throws(() => mmdcVersion({ AK_DIAGRAM_MMDC_VERSION: '^11' }), /exact version/);
});

test('resolveMmdc honors an explicit binary and blocks a missing one', () => {
  const dir = tmpDir();
  const cli = path.join(dir, 'cli.js');
  fs.writeFileSync(cli, '');
  assert.equal(resolveMmdc({ AK_DIAGRAM_MMDC_BIN: cli, PATH: '' }).kind, 'env');
  assert.throws(() => resolveMmdc({ AK_DIAGRAM_MMDC_BIN: path.join(dir, 'missing.js'), PATH: '' }), (err) => err.exitCode === 3);
  assert.equal(resolveMmdc({ PATH: '', npm_config_cache: dir }).kind, 'npx');
});

test('resolveMmdc reports the version an explicit binary really runs and refuses shell shims', () => {
  const dir = tmpDir();
  const pkg = path.join(dir, 'node_modules', '@mermaid-js', 'mermaid-cli');
  fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'src', 'cli.js'), '');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '10.9.0' }));
  const viaJs = resolveMmdc({ AK_DIAGRAM_MMDC_BIN: path.join(pkg, 'src', 'cli.js'), PATH: '' });
  assert.equal(viaJs.installed, '10.9.0');
  // A .cmd shim next to node_modules resolves to the JS entry instead of needing a shell.
  fs.writeFileSync(path.join(dir, 'mmdc.cmd'), '@echo off');
  const viaShim = resolveMmdc({ AK_DIAGRAM_MMDC_BIN: path.join(dir, 'mmdc.cmd'), PATH: '' });
  assert.equal(viaShim.kind, 'env');
  assert.equal(viaShim.cli, path.join(pkg, 'src', 'cli.js'));
  const lone = tmpDir();
  fs.writeFileSync(path.join(lone, 'mmdc.cmd'), '@echo off');
  assert.throws(() => resolveMmdc({ AK_DIAGRAM_MMDC_BIN: path.join(lone, 'mmdc.cmd'), PATH: '' }), /shell shim/);
});

test('Archify resolution prefers ARCHIFY_HOME, then project, and reads its version', () => {
  const root = tmpDir();
  const projectSkill = path.join(root, '.claude', 'skills', 'archify');
  fs.mkdirSync(path.join(projectSkill, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(projectSkill, 'bin', 'archify.mjs'), '');
  fs.writeFileSync(path.join(projectSkill, 'skill-release.json'), JSON.stringify({ version: '3.2.0' }));
  const found = resolveArchify(root, {});
  assert.equal(found.found, true);
  assert.equal(found.scope, 'project');
  assert.equal(found.version, '3.2.0');
  assert.equal(found.supported, true);

  const envHome = tmpDir();
  fs.mkdirSync(path.join(envHome, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(envHome, 'bin', 'archify.mjs'), '');
  fs.writeFileSync(path.join(envHome, 'SKILL.md'), '---\nmetadata:\n  version: "2.4"\n---\n');
  const viaEnv = resolveArchify(root, { ARCHIFY_HOME: envHome });
  assert.equal(viaEnv.scope, 'env');
  assert.equal(viaEnv.version, '2.4');
  assert.equal(viaEnv.supported, false);

  assert.equal(archifyCandidates(root, {})[0].scope, 'project');
  assert.equal(archifyVersion(tmpDir()), null);

  const noVersion = tmpDir();
  fs.mkdirSync(path.join(noVersion, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(noVersion, 'bin', 'archify.mjs'), '');
  assert.equal(resolveArchify(root, { ARCHIFY_HOME: noVersion }).supported, false);

  const rc = tmpDir();
  fs.mkdirSync(path.join(rc, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(rc, 'bin', 'archify.mjs'), '');
  fs.writeFileSync(path.join(rc, 'skill-release.json'), JSON.stringify({ version: '3.2.0-rc.1' }));
  assert.equal(resolveArchify(root, { ARCHIFY_HOME: rc }).supported, false);

  // A prerelease read from SKILL.md keeps its suffix; a malformed version fails closed.
  const rcSkill = tmpDir();
  fs.mkdirSync(path.join(rcSkill, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(rcSkill, 'bin', 'archify.mjs'), '');
  fs.writeFileSync(path.join(rcSkill, 'SKILL.md'), '---\nmetadata:\n  version: "3.2.0-rc.1"\n---\n');
  const viaSkill = resolveArchify(root, { ARCHIFY_HOME: rcSkill });
  assert.equal(viaSkill.version, '3.2.0-rc.1');
  assert.equal(viaSkill.supported, false);
  fs.writeFileSync(path.join(rcSkill, 'SKILL.md'), '---\nmetadata:\n  version: "3.2.0_rc.1"\n---\n');
  assert.equal(resolveArchify(root, { ARCHIFY_HOME: rcSkill }).supported, false);
  for (const bad of ['9.x', '9.0.0-.', '9.0.0-', '9..0']) {
    fs.writeFileSync(path.join(rcSkill, 'skill-release.json'), JSON.stringify({ version: bad }));
    assert.equal(resolveArchify(root, { ARCHIFY_HOME: rcSkill }).supported, false, bad);
  }
});

test('CLI: archify names a malformed version as malformed, not older', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'archify.mjs'), '');
  fs.writeFileSync(path.join(home, 'skill-release.json'), JSON.stringify({ version: 'abc' }));
  const bad = run(['archify', '--', 'guide', 'x'], { env: { ...process.env, ARCHIFY_HOME: home } });
  assert.equal(bad.status, 3, bad.stdout);
  assert.match(bad.json.error, /malformed version "abc"/);
  fs.writeFileSync(path.join(home, 'skill-release.json'), JSON.stringify({ version: '3.1.9' }));
  const old = run(['archify', '--', 'guide', 'x'], { env: { ...process.env, ARCHIFY_HOME: home } });
  assert.equal(old.status, 3, old.stdout);
  assert.match(old.json.error, /3\.1\.9 is older than/);
});

test('route sends full-column ERDs and architecture deltas to Archify', () => {
  assert.deepEqual([route('ERD with all columns').engine, route('ERD with all columns').type], ['archify', 'erd']);
  assert.equal(route('PR architecture delta').engine, 'archify');
  assert.equal(route('so sánh kiến trúc PR').engine, 'archify');
  assert.equal(route('orders ERD for the README').engine, 'mermaid');
  assert.equal(route('ERD with all columns', { target: 'inline' }).engine, 'mermaid');
});

test('scanTree inventories Mermaid, Archify and tech-graph sources', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'docs', 'diagrams', 'orders'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '```mermaid\nflowchart LR\n A-->B\n```\n```mermaid\nerDiagram\n```\n');
  fs.writeFileSync(path.join(root, 'docs', 'plain.md'), 'no diagrams');
  fs.writeFileSync(path.join(root, 'docs', 'diagrams', 'flow.mmd'), 'flowchart LR');
  fs.writeFileSync(path.join(root, 'docs', 'diagrams', 'orders', 'orders.erd.json'), '{}');
  fs.writeFileSync(path.join(root, 'docs', 'diagrams', 'hero.tech-graph.json'), '{}');
  fs.writeFileSync(path.join(root, 'docs', 'diagrams', 'hero.svg'), '<svg/>');
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'README.md'), '```mermaid\nflowchart LR\n```');
  const report = scanTree(root);
  assert.equal(report.markdown.length, 1);
  assert.equal(report.markdown[0].mermaidBlocks, 2);
  assert.deepEqual(report.markdown[0].types, ['flowchart', 'erDiagram']);
  assert.equal(report.mermaidFiles.length, 1);
  assert.equal(report.archify.length, 1);
  assert.equal(report.techGraph.length, 1);
  assert.equal(report.images.length, 1);
});

test('CLI: unknown command is a usage error', () => {
  const r = run(['nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test('CLI: route prints one JSON decision', () => {
  const r = run(['route', 'order', 'state', 'machine', '--target', 'inline']);
  assert.equal(r.status, 0);
  assert.equal(r.json.engine, 'mermaid');
  assert.equal(r.json.type, 'stateDiagram-v2');
});

test('CLI: lint exits 1 on a broken block and 0 on a clean file', () => {
  const dir = tmpDir();
  const bad = path.join(dir, 'bad.md');
  const good = path.join(dir, 'good.mmd');
  fs.writeFileSync(bad, '```mermaid\nflowchrt TD\n A-->B\n```\n');
  fs.writeFileSync(good, 'sequenceDiagram\n A->>B: hi\n');
  const r1 = run(['lint', bad]);
  assert.equal(r1.status, 1);
  assert.equal(r1.json.failed, 1);
  const r2 = run(['lint', good]);
  assert.equal(r2.status, 0);
  assert.equal(r2.json.blocks, 1);
  assert.equal(run(['lint', path.join(dir, 'x.txt')]).status, 2);
});

test('CLI: archify passthrough reports BLOCKED with install guidance when absent', () => {
  const root = tmpDir();
  const r = run(['archify', '--', 'doctor'], { cwd: root, env: { ...process.env, ARCHIFY_HOME: '', HOME: root, USERPROFILE: root } });
  assert.equal(r.status, 3);
  assert.equal(r.json.status, 'BLOCKED');
  assert.match(r.json.install, /confirm scope/);
});

test('CLI: archify passthrough forwards args and exit code to the resolved bin', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ version: '3.2.0' }));
  fs.writeFileSync(path.join(home, 'bin', 'archify.mjs'), 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(4);');
  const r = run(['archify', '--', 'validate', 'workflow', 'a b.json'], { env: { ...process.env, ARCHIFY_HOME: home } });
  assert.equal(r.status, 4);
  assert.deepEqual(JSON.parse(r.stdout.trim()), ['validate', 'workflow', 'a b.json']);
});

test('CLI: lint reads files given after --', () => {
  const dir = tmpDir();
  const a = path.join(dir, 'a.md');
  const b = path.join(dir, 'b.md');
  fs.writeFileSync(a, 'no diagram');
  fs.writeFileSync(b, '```mermaid\nflowchart LR\n A-->B\n```\n');
  const r = run(['lint', a, '--', b]);
  assert.equal(r.status, 0);
  assert.equal(r.json.blocks, 1);
});

test('CLI: scan refuses a file and reports an incomplete inventory as not ok', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'x.md');
  fs.writeFileSync(file, '```mermaid\npie\n```');
  assert.equal(run(['scan', file]).status, 2);
  const r = run(['scan', dir]);
  assert.equal(r.status, 0);
  assert.equal(r.json.complete, true);
  assert.equal(r.json.counts.mermaidBlocks, 1);
});

test('CLI: render will not download mermaid-cli without --allow-download', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'x.mmd');
  fs.writeFileSync(file, 'flowchart LR\n A-->B');
  const env = { ...process.env, PATH: '', npm_config_cache: tmpDir() };
  delete env.AK_DIAGRAM_MMDC_BIN;
  const r = run(['render', file, '--check'], { env });
  assert.equal(r.status, 3);
  assert.match(r.json.error, /--allow-download/);
});

test('CLI: render reports the version actually run and replaces stale output', () => {
  const dir = tmpDir();
  const pkg = path.join(dir, 'node_modules', '@mermaid-js', 'mermaid-cli');
  fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '10.9.0' }));
  // A fake renderer that always fails without writing output.
  fs.writeFileSync(path.join(pkg, 'src', 'cli.js'), 'process.stderr.write("Parse error on line 1"); process.exit(1);');
  const src = path.join(dir, 'flow.mmd');
  fs.writeFileSync(src, 'flowchart LR\n A-->B');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'flow.svg'), '<svg/>');
  const r = run(['render', src, '--out-dir', outDir], { env: { ...process.env, AK_DIAGRAM_MMDC_BIN: path.join(pkg, 'src', 'cli.js') } });
  assert.equal(r.status, 1);
  assert.equal(r.json.results[0].status, 'FAIL');
  assert.equal(r.json.version, '10.9.0');
  assert.equal(r.json.pinMatched, false);
  assert.equal(fs.existsSync(path.join(outDir, 'flow.svg')), false);
});

test('CLI: doctor --deep fails when Archify health check fails', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'skill-release.json'), JSON.stringify({ version: '3.2.0' }));
  fs.writeFileSync(path.join(home, 'bin', 'archify.mjs'), 'console.error("broken install"); process.exit(1);');
  const r = run(['doctor', '--deep'], { env: { ...process.env, ARCHIFY_HOME: home } });
  assert.equal(r.status, 1);
  assert.equal(r.json.status, 'FAIL');
  assert.deepEqual(r.json.failedChecks, ['archify doctor']);
});

test('CLI: archify passthrough refuses an install without a readable version', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'archify.mjs'), 'process.exit(0);');
  const r = run(['archify', '--', 'doctor'], { env: { ...process.env, ARCHIFY_HOME: home } });
  assert.equal(r.status, 3);
  assert.match(r.json.error, /no readable version/);
});

test('CLI: tech-graph rejects data that injects active SVG content', (t) => {
  const dir = tmpDir();
  const data = path.join(dir, 'evil.json');
  fs.writeFileSync(data, JSON.stringify({
    title: 'x',
    nodes: [{ id: 'a', x: 40, y: 40, width: 120, height: 50, label: 'A' }],
    arrows: [],
    style_overrides: { background: 'white"/><script>alert(1)</script><rect fill="white' },
  }));
  const svg = path.join(dir, 'evil.svg');
  const r = run(['tech-graph', 'architecture', svg, data]);
  if (r.status === 3) return t.skip(`engine blocked: ${r.json && r.json.error}`);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.json.steps.some((s) => s.step === 'svg-safety' && s.status === 'FAIL'), r.stdout);
  assert.equal(fs.existsSync(svg), false);
});

test('svgActiveContent sees attributes after a quoted ">" and blocks external url()', () => {
  assert.ok(svgActiveContent('<svg><rect data-x=">" onload="alert(1)"/></svg>').includes('event handler attribute'));
  assert.ok(svgActiveContent("<svg><rect data-x='>' ev:onclick='x()'/></svg>").includes('event handler attribute'));
  assert.ok(svgActiveContent('<svg><set data-x=">" attributeName="href" to="https://x.test/a.svg"/></svg>').includes('set/animate of an href'));
  assert.ok(svgActiveContent('<svg><animate attributeName="xlink:href" values="https://x.test"/></svg>').includes('set/animate of an href'));
  assert.ok(svgActiveContent('<svg><rect fill="url(http://x.test/p.svg#a)"/></svg>').includes('external url()'));
  assert.ok(svgActiveContent('<svg><rect style="fill: url( \'//x.test/p\' )"/></svg>').includes('external url()'));
  assert.ok(svgActiveContent('<svg><style>rect{fill:url(https://x.test/a)}</style></svg>').includes('external url()'));
  assert.deepEqual(svgActiveContent('<svg><path marker-end="url(#arrow)" fill="url(\'#g\')"/><text>a &gt; b, turn on=1</text></svg>'), []);
});

test('svgActiveContent is not fooled by comment, CDATA, PI or CSS-escape decoys', () => {
  assert.ok(svgActiveContent('<svg><!-- <x a=" --><svg data-x=">" onload="alert(1)"/></svg>').includes('event handler attribute'));
  assert.ok(svgActiveContent('<svg><text><![CDATA[<x a="]]></text><svg data-x=">" onload="alert(1)"/></svg>').includes('event handler attribute'));
  assert.ok(svgActiveContent('<?xml-stylesheet type="text/css" href="https://x.test/s.css"?><svg/>').some((f) => f.startsWith('processing instruction')));
  assert.ok(svgActiveContent('<svg><rect style="fill:u\\72l(https://x.test/p.svg#p)"/></svg>').includes('external url()'));
  assert.ok(svgActiveContent('<svg><style>rect{fill:\\75 rl(//x.test/a)}</style></svg>').includes('external url()'));
  assert.ok(svgActiveContent('<svg><style>@im\\70ort "https://x.test/a.css";</style></svg>').includes('@import'));
  assert.ok(svgActiveContent('<svg><style>&#64;import "https://x.test/a.css";</style></svg>').includes('@import'));
  assert.ok(svgActiveContent('<svg><rect style="mask-image:image-set(\'https://x.test/a.png\' 1x)"/></svg>').includes('external CSS load'));
  assert.ok(svgActiveContent('<svg><rect style="mask-image:\\69mage-set(&quot;//x.test/a.png&quot; 1x)"/></svg>').includes('external CSS load'));
  assert.ok(svgActiveContent('<svg><style>@font-face{font-family:x;src:local(a),url(x.woff)}</style></svg>').includes('external CSS load'));
  assert.deepEqual(svgActiveContent('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><text font-family="\'Segoe UI\', sans-serif">see https://example.com</text></svg>'), []);
  assert.deepEqual(svgActiveContent('<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE svg><svg><!-- note --><text><![CDATA[a < b]]></text></svg>'), []);
});

test('svgAllowlist parses the SVG as XML and rejects anything outside plain drawing markup', (t) => {
  const ns = 'xmlns="http://www.w3.org/2000/svg"';
  const check = (body) => svgAllowlist(`<svg ${ns}>${body}</svg>`);
  if (!check('').ran) return t.skip('Python 3 not found');
  assert.deepEqual(check('<defs><marker id="m"><path d="M0 0L5 5"/></marker></defs><rect fill="rgba(0,0,0,.5)" marker-end="url(#m)"/><text>see https://example.com &lt;b&gt;</text><style>.a{fill:url(\'#g\')}</style>').problems, []);
  const rejects = {
    prefixedStyle: '<s:style xmlns:s="http://www.w3.org/2000/svg">svg{background:image-set(\'https://example.invalid/a\')}</s:style>',
    cdataSplit: '<style>svg{background:u<![CDATA[rl(https://example.invalid/a)]]>}</style>',
    laterImageSetOption: '<rect style="mask-image:image-set(\'#a\' .01x,\'ht\\&#10;tps://example.invalid/a\' 1x)"/>',
    xmlBase: '<image xml:base="https://example.invalid/a" href="#x"/>',
    xmlBaseOnAllowed: '<use xml:base="https://example.invalid/a" href="#x"/>',
    foreignSrc: '<img xmlns="http://www.w3.org/1999/xhtml" src="https://example.invalid/a"/>',
    animate: '<set attributeName="href" to="https://example.invalid"/>',
    unknownFunction: '<rect fill="paint(x)"/>',
    atRule: '<style>@font-face{font-family:x}</style>',
    atRuleBehindCommentQuotes: '<style>/*"*/@im<![CDATA[port]]> "/a.css";/*"*/</style>',
    externalUse: '<use href="https://example.invalid/a.svg#x"/>',
  };
  for (const [name, body] of Object.entries(rejects)) {
    assert.notDeepEqual(check(body).problems, [], name);
  }
  assert.ok(svgAllowlist('<?xml-stylesheet href="https://example.invalid/s.css"?><svg ' + ns + '/>').problems.length);
  assert.ok(svgAllowlist('<!DOCTYPE svg [<!ENTITY e "x">]><svg ' + ns + '>&e;</svg>').problems.length);
  assert.ok(svgAllowlist('<svg ' + ns + '><rect').problems.length);
});

test('CLI: tech-graph rejects an event handler hidden behind a quoted ">" in data', (t) => {
  const dir = tmpDir();
  const data = path.join(dir, 'gt.json');
  fs.writeFileSync(data, JSON.stringify({
    title: 'x',
    nodes: [{ id: 'a', x: 40, y: 40, width: 120, height: 50, label: 'A', fill: 'white" data-x=">" onload="alert(1)' }],
    arrows: [],
  }));
  const svg = path.join(dir, 'gt.svg');
  const r = run(['tech-graph', 'architecture', svg, data]);
  if (r.status === 3) return t.skip(`engine blocked: ${r.json && r.json.error}`);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.json.steps.some((s) => s.step === 'svg-safety' && s.status === 'FAIL'), r.stdout);
  assert.equal(fs.existsSync(svg), false);
});

test('CLI: tech-graph rejects an entity-encoded javascript link injected through data', (t) => {
  const dir = tmpDir();
  const data = path.join(dir, 'encoded.json');
  fs.writeFileSync(data, JSON.stringify({
    title: 'x',
    nodes: [{ id: 'a', x: 40, y: 40, width: 120, height: 50, label: 'A' }],
    arrows: [],
    style_overrides: { background: 'white"/><a href="jav&#x61;script:alert(1)"><rect width="100" height="100"/></a><rect fill="white' },
  }));
  const svg = path.join(dir, 'encoded.svg');
  const r = run(['tech-graph', 'architecture', svg, data]);
  if (r.status === 3) return t.skip(`engine blocked: ${r.json && r.json.error}`);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.json.steps.some((s) => s.step === 'svg-safety' && s.status === 'FAIL'), r.stdout);
  assert.equal(fs.existsSync(svg), false);
});

test('CLI: tech-graph passes large Unicode data through stdin', (t) => {
  const fixture = path.resolve(__dirname, '..', '..', 'ak-tech-graph', 'fixtures', 'microservices-style3.json');
  if (!fs.existsSync(fixture)) return t.skip('ak-tech-graph is not installed next to ak-diagram');
  const data = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  // The payload must exceed the Windows command-line limit (32767 chars), but
  // the bulk sits in a key the generator does not draw: rasterizing 40k glyphs
  // in rsvg-convert would test font layout speed, not stdin transport.
  data.subtitle = 'Kiến trúc hệ thống';
  data.notes = 'đ'.repeat(40000);
  const file = path.join(tmpDir(), 'big.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const svg = path.join(tmpDir(), 'big.svg');
  const r = run(['tech-graph', 'architecture', svg, file]);
  if (r.status === 3) return t.skip(`engine blocked: ${r.json && r.json.error}`);
  assert.equal(r.status, 0, r.stdout);
  assert.match(fs.readFileSync(svg, 'utf8'), /Kiến trúc/);
});

test('CLI: tech-graph accepts every shipped fixture and its template name', (t) => {
  const dir = path.resolve(__dirname, '..', '..', 'ak-tech-graph', 'fixtures');
  if (!fs.existsSync(dir)) return t.skip('ak-tech-graph is not installed next to ak-diagram');
  const out = tmpDir();
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const fixture = path.join(dir, name);
    const template = JSON.parse(fs.readFileSync(fixture, 'utf8')).template_type || 'architecture';
    const r = run(['tech-graph', template, path.join(out, name.replace(/\.json$/, '.svg')), fixture]);
    if (r.status === 3) return t.skip(`engine blocked: ${r.json && r.json.error}`);
    assert.equal(r.status, 0, `${name} (${template}): ${r.stdout}`);
  }
});

test('CLI: tech-graph runs the sibling generator on a real fixture', (t) => {
  const fixture = path.resolve(__dirname, '..', '..', 'ak-tech-graph', 'fixtures', 'microservices-style3.json');
  if (!fs.existsSync(fixture)) return t.skip('ak-tech-graph is not installed next to ak-diagram');
  const svg = path.join(tmpDir(), 'micro.svg');
  // Force a legacy console code page: the generator prints non-ASCII marks.
  const r = run(['tech-graph', 'architecture', svg, fixture], { env: { ...process.env, PYTHONIOENCODING: 'cp1252' } });
  if (r.status === 3) return t.skip(`engine blocked: ${r.json && r.json.error}`);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.json.steps[0].status, 'PASS');
  assert.match(fs.readFileSync(svg, 'utf8'), /<svg\b/);
});

test('CLI: tech-graph --png reports the png step and writes the image', (t) => {
  const fixture = path.resolve(__dirname, '..', '..', 'ak-tech-graph', 'fixtures', 'microservices-style3.json');
  if (!fs.existsSync(fixture)) return t.skip('ak-tech-graph is not installed next to ak-diagram');
  const svg = path.join(tmpDir(), 'micro.svg');
  const r = run(['tech-graph', 'architecture', svg, fixture, '--png']);
  if (r.status === 3) return t.skip(`engine blocked: ${r.json && r.json.error}`);
  assert.equal(r.status, 0, r.stdout);
  const png = r.json.steps.find((s) => s.step === 'png');
  assert.ok(png, 'png step missing');
  if (png.status === 'NOT_RUN') return t.skip('rsvg-convert not on PATH');
  assert.equal(png.status, 'PASS');
  const bytes = fs.readFileSync(svg.replace(/\.svg$/, '.png'));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG');
});

test('CLI: tech-graph validates template and data before running Python', () => {
  const dir = tmpDir();
  assert.equal(run(['tech-graph', 'nope', path.join(dir, 'a.svg'), path.join(dir, 'd.json')]).status, 2);
  assert.equal(run(['tech-graph', 'architecture', path.join(dir, 'a.png'), path.join(dir, 'd.json')]).status, 2);
  assert.equal(run(['tech-graph', 'architecture', path.join(dir, 'a.svg'), path.join(dir, 'missing.json')]).status, 2);
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{nope');
  const r = run(['tech-graph', 'architecture', path.join(dir, 'a.svg'), broken]);
  assert.equal(r.status, 1);
  assert.equal(r.json.stage, 'data');
});

test('extractMermaidBlocks follows empty list items, setext underlines and paragraph interruption', () => {
  // An empty item cannot interrupt a paragraph, so the indented line stays paragraph text.
  assert.equal(extractMermaidBlocks(['pie', '1.', '    ```mermaid'].join('\n')).length, 0);
  assert.equal(extractMermaidBlocks(['pie', '2)', '    ```mermaid'].join('\n')).length, 0);
  // An empty item followed by a blank or under-indented line ends the list.
  assert.equal(extractMermaidBlocks(['1.', '', '    ```mermaid'].join('\n')).length, 0);
  assert.equal(extractMermaidBlocks(['-', 'para text', '    ```mermaid'].join('\n')).length, 0);
  // A paragraph inside a quote does not swallow a list marker after the quote.
  assert.equal(extractMermaidBlocks(['> pie', '-', '    ```mermaid'].join('\n')).length, 1);
  // A new blockquote ends the paragraph before it.
  assert.equal(extractMermaidBlocks(['1. step', '> 1.', '  A-->B', '+', '    ```mermaid'].join('\n')).length, 0);
  // "- " under paragraph text is a setext underline, so the next "- " starts a list.
  assert.equal(extractMermaidBlocks(['para text', '- ', '- ', '   ```mermaid', '>   ```mermaid'].join('\n')).length, 2);
  // A marker left of the item content column starts an outer list even when empty.
  assert.equal(extractMermaidBlocks(['- item', '1.', '  ```', '~~~mermaid'].join('\n')).length, 0);
});
