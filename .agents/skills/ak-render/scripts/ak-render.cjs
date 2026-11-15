#!/usr/bin/env node
'use strict';

/**
 * AgentKit wrapper around the AK Render CLI (@bestagentkits/render).
 *
 * It resolves a runner without a shell, detects what the installed CLI
 * version supports, and runs the whole validate -> repair -> compile -> audit
 * -> open-once loop as one call that prints one JSON summary. The compiled
 * HTML is never printed, so it never enters the agent's context.
 *
 * Usage:
 *   node ak-render.cjs doctor [--json]
 *   node ak-render.cjs paths <topic> [--plan-dir <dir>]
 *   node ak-render.cjs init <template|recipe:name> <topic> [--plan-dir <dir>] [--force]
 *   node ak-render.cjs check <spec...>
 *   node ak-render.cjs build <spec> [--out <file.html>] [--theme <preset>] [--no-open] [--no-repair] [--no-audit]
 *   node ak-render.cjs selftest
 *   node ak-render.cjs exec -- <ak-render args...>
 *
 * Environment:
 *   AK_RENDER_VERSION  npm version to pin (default below)
 *   AK_RENDER_BIN      path to a local ak-render cli.js or executable
 *   AK_RENDER_NO_OPEN  set to 1 to never open a browser (CI sets this implicitly)
 *
 * Exit codes: 0 ok, 1 spec or compile error, 2 usage error, 3 runner blocked.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const PACKAGE = '@bestagentkits/render';
const DEFAULT_VERSION = '0.3.0';
const MIN_NODE = [20, 11];
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const SPEC_EXT = new Set(['.yaml', '.yml', '.json']);
const HTML_EXT = new Set(['.html', '.htm']);
const TIMEOUT_MS = 240000;
const SKILL_DIR = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(SKILL_DIR, 'templates');

// ---------------------------------------------------------------- pure helpers

function slugify(topic) {
  let slug = String(topic || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug.length > 80) {
    const cut = slug.slice(0, 80);
    const lastDash = cut.lastIndexOf('-');
    slug = (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-$/, '');
  }
  return slug;
}

function parseHelp(text) {
  const commands = [];
  const lines = String(text || '').split(/\r?\n/);
  let inCommands = false;
  for (const line of lines) {
    if (/^Commands:\s*$/.test(line)) {
      inCommands = true;
      continue;
    }
    if (inCommands) {
      if (!line.trim()) {
        if (commands.length) inCommands = false;
        continue;
      }
      const match = /^\s{2,}([a-z][\w-]*)(?:\s+\S|\s*$)/.exec(line);
      if (match) commands.push(match[1]);
    }
  }
  const flags = {
    suggest: /--suggest\b/.test(text),
    compact: /--compact\b/.test(text),
    stdin: /\s-\s|<spec[^>]*\|->/.test(text),
  };
  return { commands, flags };
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function nodeVersionOk(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

function defaultOutFor(specPath) {
  const dir = path.dirname(specPath);
  const base = path.basename(specPath).replace(/(\.page)?\.(ya?ml|json)$/i, '');
  return path.join(dir, `${base}.html`);
}

function visualPaths(topic, { planDir, root = process.cwd() } = {}) {
  const slug = slugify(topic);
  if (!slug) throw usage('topic is empty after slugifying; give a topic with letters or digits');
  const dir = planDir ? path.resolve(root, planDir, 'visuals') : path.resolve(root, 'plans', 'visuals');
  return {
    slug,
    dir,
    spec: path.join(dir, `${slug}.page.yaml`),
    html: path.join(dir, `${slug}.html`),
  };
}

function shouldOpen({ existedBefore, noOpen, env = process.env }) {
  if (noOpen) return false;
  if (env.AK_RENDER_NO_OPEN === '1' || env.CI) return false;
  return !existedBefore;
}

function display(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : p;
}

function pinnedVersion(env = process.env) {
  const v = env.AK_RENDER_VERSION || DEFAULT_VERSION;
  if (!VERSION_RE.test(v)) throw usage(`AK_RENDER_VERSION "${v}" is not an exact version such as ${DEFAULT_VERSION}`);
  return v;
}

function usage(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function blocked(message) {
  const err = new Error(message);
  err.exitCode = 3;
  return err;
}

// ------------------------------------------------------------- runner resolution

function npmBinJs(name) {
  const dir = path.dirname(process.execPath);
  const candidates = process.platform === 'win32'
    ? [path.join(dir, 'node_modules', 'npm', 'bin', `${name}-cli.js`)]
    : [
      path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', `${name}-cli.js`),
      path.join(dir, 'node_modules', 'npm', 'bin', `${name}-cli.js`),
    ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function winQuote(arg) {
  if (/["%!^&|<>\r\n]/.test(arg)) throw usage(`argument contains a character the Windows shell fallback refuses: ${arg}`);
  return /[\s]/.test(arg) ? `"${arg}"` : arg;
}

/** Run a tool by name (npm/npx) without a shell when npm's JS entry is found. */
function npmTool(name, args, opts = {}) {
  const js = npmBinJs(name);
  if (js) return spawnSync(process.execPath, [js, ...args], { encoding: 'utf8', timeout: TIMEOUT_MS, ...opts });
  if (process.platform !== 'win32') return spawnSync(name, args, { encoding: 'utf8', timeout: TIMEOUT_MS, ...opts });
  const line = [name, ...args.map(winQuote)].join(' ');
  return spawnSync(line, { encoding: 'utf8', timeout: TIMEOUT_MS, shell: true, ...opts });
}

function npmCacheDir() {
  if (process.env.npm_config_cache) return process.env.npm_config_cache;
  const res = npmTool('npm', ['config', 'get', 'cache'], { timeout: 30000 });
  const out = (res.stdout || '').trim();
  if (res.status === 0 && out && fs.existsSync(out)) return out;
  return process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'npm-cache')
    : path.join(os.homedir(), '.npm');
}

function readPkgVersion(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

function cliJsIn(pkgDir) {
  const cli = path.join(pkgDir, 'dist', 'cli.js');
  return fs.existsSync(cli) ? cli : null;
}

function findOnPath() {
  const names = process.platform === 'win32' ? ['ak-render.cmd', 'ak-render'] : ['ak-render'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      if (process.platform === 'win32') {
        const pkgDir = path.join(dir, 'node_modules', ...PACKAGE.split('/'));
        const cli = cliJsIn(pkgDir);
        if (cli) return { cli, version: readPkgVersion(pkgDir) };
      } else {
        try {
          const real = fs.realpathSync(file);
          if (real.endsWith('.js')) {
            return { cli: real, version: readPkgVersion(path.resolve(path.dirname(real), '..')) };
          }
        } catch {
          // fall through to the next candidate
        }
      }
    }
  }
  return null;
}

function findInNpxCache(version) {
  const root = path.join(npmCacheDir(), '_npx');
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const pkgDir = path.join(root, entry, 'node_modules', ...PACKAGE.split('/'));
    if (readPkgVersion(pkgDir) === version) {
      const cli = cliJsIn(pkgDir);
      if (cli) return { cli, version };
    }
  }
  return null;
}

/**
 * Resolve how to run the CLI. Every runner is spawned without a shell except
 * the last-resort Windows npx fallback, which quotes and filters its args.
 */
function resolveRunner(env = process.env) {
  const pin = pinnedVersion(env);
  if (env.AK_RENDER_BIN) {
    const bin = path.resolve(env.AK_RENDER_BIN);
    if (!fs.existsSync(bin)) throw blocked(`AK_RENDER_BIN does not exist: ${env.AK_RENDER_BIN}`);
    return bin.endsWith('.js')
      ? { kind: 'env', cli: bin, pin }
      : { kind: 'env-exe', exe: bin, pin };
  }
  // A global install is used only at the pinned version, so pages stay reproducible.
  const onPath = findOnPath();
  if (onPath && onPath.version === pin) return { kind: 'global', cli: onPath.cli, installed: onPath.version, pin };
  const cached = findInNpxCache(pin);
  if (cached) return { kind: 'npx-cache', cli: cached.cli, installed: pin, pin };
  return { kind: 'npx', pin };
}

function runCli(runner, args, { input } = {}) {
  const opts = { encoding: 'utf8', timeout: TIMEOUT_MS, input, maxBuffer: 64 * 1024 * 1024 };
  let res;
  if (runner.cli) res = spawnSync(process.execPath, [runner.cli, ...args], opts);
  else if (runner.exe) res = spawnSync(runner.exe, args, opts);
  else res = npmTool('npx', ['-y', `${PACKAGE}@${runner.pin}`, ...args], opts);
  if (res.error) {
    throw blocked(`could not run ak-render (${runner.kind}): ${res.error.code || res.error.message}`);
  }
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function parseJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function capabilities(runner) {
  const version = runCli(runner, ['--version']);
  const versionText = (version.stdout || '').trim().split(/\s+/).pop();
  if (version.status !== 0 || !VERSION_RE.test(versionText || '')) {
    throw blocked(`ak-render --version failed (${runner.kind}): ${(version.stderr || version.stdout).trim().slice(0, 300)}`);
  }
  const help = runCli(runner, ['--help']);
  const parsed = parseHelp(`${help.stdout}\n${help.stderr}`);
  if (help.status !== 0 || !parsed.commands.length) {
    throw blocked('ak-render --help failed or returned no command inventory');
  }
  const has = (cmd) => parsed.commands.includes(cmd);
  return {
    version: versionText,
    commands: parsed.commands,
    validateSuggest: parsed.flags.suggest,
    describeCompact: parsed.flags.compact,
    compose: has('compose'),
    repair: has('repair'),
    patch: has('patch'),
    auditUi: has('audit-ui'),
    icons: has('icons'),
    motions: has('motions'),
    searchCatalog: has('search-catalog'),
    recipes: has('recipes'),
    mcp: has('mcp'),
  };
}

// ------------------------------------------------------------------- commands

function out(result, json = true) {
  process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${result}\n`);
}

function cmdDoctor() {
  const checks = [];
  const nodeOk = nodeVersionOk();
  checks.push({ check: 'node>=20.11', status: nodeOk ? 'PASS' : 'FAIL', value: process.versions.node });
  if (!nodeOk) {
    out({ ok: false, status: 'BLOCKED', checks, hint: 'Install Node.js 20.11+ or use /ak:preview --html as the fallback.' });
    return 3;
  }
  const started = Date.now();
  const runner = resolveRunner();
  const caps = capabilities(runner);
  checks.push({ check: 'runner', status: 'PASS', value: runner.kind });
  checks.push({ check: 'cli-version', status: 'PASS', value: caps.version });
  const themes = runCli(runner, ['themes', '--json']);
  const themeList = parseJson(themes.stdout);
  const themeItems = Array.isArray(themeList) ? themeList : themeList?.themes;
  if (themes.status !== 0 || themeList?.ok === false || !Array.isArray(themeItems) || !themeItems.length
    || !themeItems.every((item) => typeof (item?.name || item?.id || item) === 'string')) {
    throw blocked('ak-render themes failed or returned no usable theme inventory');
  }
  const catalogResult = runCli(runner, ['catalog', '--json']);
  const catalog = parseJson(catalogResult.stdout);
  if (catalogResult.status !== 0 || catalog?.ok === false || !Array.isArray(catalog?.blocks) || !catalog.blocks.length
    || !catalog.blocks.every((block) => typeof block?.type === 'string')) {
    throw blocked('ak-render catalog failed or returned no usable block inventory');
  }
  const result = {
    ok: true,
    status: 'PASS',
    runner: runner.kind,
    pin: runner.pin,
    version: caps.version,
    pinMismatch: runner.kind !== 'npx' && compareVersions(caps.version, runner.pin) !== 0,
    capabilities: caps,
    themes: themeItems.map((t) => t.name || t.id || t),
    blockCount: catalog.blockCount ?? catalog.blocks.length,
    blocks: catalog.blocks.map((b) => b.type),
    elapsedMs: Date.now() - started,
    checks,
  };
  if (runner.kind === 'npx') {
    result.hint = 'Each npx call re-resolves the package. Run doctor again: the npx cache is used once it is populated.';
  }
  out(result);
  return 0;
}

function cmdPaths(args) {
  const { positional, opts } = parseArgs(args, ['plan-dir']);
  if (!positional.length) throw usage('paths <topic> [--plan-dir <dir>]');
  const p = visualPaths(positional.join(' '), { planDir: opts['plan-dir'] });
  out({
    slug: p.slug,
    dir: display(p.dir),
    spec: display(p.spec),
    html: display(p.html),
    specExists: fs.existsSync(p.spec),
    htmlExists: fs.existsSync(p.html),
  });
  return 0;
}

function listTemplates() {
  try {
    return fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.page.yaml')).map((f) => f.replace(/\.page\.yaml$/, ''));
  } catch {
    return [];
  }
}

function cmdInit(args) {
  const { positional, opts } = parseArgs(args, ['plan-dir'], ['force']);
  if (positional.length < 2) throw usage(`init <template|recipe:name> <topic> [--plan-dir <dir>] [--force]; templates: ${listTemplates().join(', ')}`);
  const [source, ...topicParts] = positional;
  const p = visualPaths(topicParts.join(' '), { planDir: opts['plan-dir'] });
  if (fs.existsSync(p.spec) && !opts.force) {
    out({ ok: false, code: 'SPEC_EXISTS', spec: display(p.spec), hint: 'Edit the existing spec by block id, or pass --force to replace it.' });
    return 1;
  }
  let text;
  if (source.startsWith('recipe:')) {
    const name = source.slice('recipe:'.length);
    if (!/^[a-z0-9-]+$/.test(name)) throw usage(`invalid recipe name: ${name}`);
    const runner = resolveRunner();
    const res = runCli(runner, ['recipe', name]);
    if (res.status !== 0) {
      out({ ok: false, code: 'RECIPE_NOT_FOUND', recipe: name, detail: (res.stderr || res.stdout).trim().slice(0, 400) });
      return 1;
    }
    text = res.stdout;
  } else {
    if (!/^[a-z0-9-]+$/.test(source)) throw usage(`invalid template name: ${source}`);
    const file = path.join(TEMPLATE_DIR, `${source}.page.yaml`);
    if (!fs.existsSync(file)) throw usage(`unknown template "${source}"; templates: ${listTemplates().join(', ')}`);
    text = fs.readFileSync(file, 'utf8');
  }
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.spec, text, 'utf8');
  out({ ok: true, source, spec: display(p.spec), html: display(p.html), next: 'Replace every placeholder (<<...>>) with real evidence, delete blocks you cannot fill, then run build.' });
  return 0;
}

function validateSpec(runner, spec) {
  const res = runCli(runner, ['validate', spec, '--json']);
  const parsed = parseJson(res.stdout);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, diagnostics: [{ code: 'WRAPPER_UNPARSED_OUTPUT', message: (res.stderr || res.stdout).trim().slice(0, 600) }] };
  }
  const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
  if (res.status !== 0) {
    return { ...parsed, ok: false, diagnostics: [...diagnostics, { code: 'WRAPPER_VALIDATOR_FAILED', severity: 'error', message: `Validator exited with status ${res.status}` }] };
  }
  return { ...parsed, ok: parsed.ok === true, diagnostics };
}

function placeholderHits(specText) {
  const hits = [];
  specText.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const text = line.replace(/`[^`]*`/g, '');
    if (/<<[^<>\n]{1,80}>>|\bTODO\b|\bTBD\b/.test(text) || /lorem ipsum/i.test(text)) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

const VI_LOCALE_RE = /^\s*locale:\s*["']?vi(?:-[A-Za-z]+)?["']?\s*(?:#.*)?$/m;
const VI_DIACRITIC_RE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const PROSE_LINE_RE = /^\s*-?\s*(?:title|description|text|label|eyebrow|caption):\s*(.+)$/;

/**
 * A `locale: vi` page whose authored prose carries no Vietnamese diacritic at
 * all was written without accents ("2 tuan gan nhat"). English source text
 * such as commit subjects is fine as long as some prose is real Vietnamese.
 */
function vietnameseAccentCheck(specText) {
  if (!VI_LOCALE_RE.test(specText)) return { applies: false };
  const samples = [];
  let letters = 0;
  let accented = false;
  for (const line of specText.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = PROSE_LINE_RE.exec(line);
    if (!match) continue;
    const value = match[1].replace(/\s+#.*$/, '').replace(/`[^`]*`/g, '').replace(/^["']|["']$/g, '');
    letters += (value.match(/\p{L}/gu) || []).length;
    if (VI_DIACRITIC_RE.test(value)) accented = true;
    else if (samples.length < 5 && /\p{L}{2,}/u.test(value)) samples.push(value.slice(0, 80));
  }
  return { applies: true, ok: accented || letters < 40, letters, samples };
}

function requireSpec(spec) {
  const abs = path.resolve(spec);
  if (!SPEC_EXT.has(path.extname(abs).toLowerCase())) throw usage(`spec must be .yaml, .yml or .json: ${spec}`);
  if (!fs.existsSync(abs)) throw usage(`spec not found: ${spec}`);
  return abs;
}

function cmdCheck(args) {
  const { positional } = parseArgs(args);
  if (!positional.length) throw usage('check <spec...>');
  const runner = resolveRunner();
  const results = positional.map((s) => {
    const abs = requireSpec(s);
    const v = validateSpec(runner, abs);
    return { spec: display(abs), ok: Boolean(v.ok), diagnostics: v.diagnostics || [] };
  });
  const ok = results.every((r) => r.ok);
  out({ ok, results });
  return ok ? 0 : 1;
}

function cmdBuild(args) {
  const { positional, opts } = parseArgs(args, ['out', 'theme'], ['no-open', 'no-repair', 'no-audit', 'allow-placeholders']);
  if (positional.length !== 1) throw usage('build <spec> [--out <file.html>] [--theme <preset>] [--no-open] [--no-repair] [--no-audit]');
  const spec = requireSpec(positional[0]);
  const html = path.resolve(opts.out || defaultOutFor(spec));
  if (!HTML_EXT.has(path.extname(html).toLowerCase())) throw usage(`--out must end in .html or .htm: ${opts.out}`);
  if (opts.theme && !/^[a-z0-9-]+$/.test(opts.theme)) throw usage(`invalid theme name: ${opts.theme}`);

  const steps = [];
  const summary = { ok: false, spec: display(spec), out: display(html), steps };

  if (!opts['allow-placeholders']) {
    const hits = placeholderHits(fs.readFileSync(spec, 'utf8'));
    if (hits.length) {
      steps.push({ step: 'placeholders', status: 'FAIL', hits: hits.slice(0, 20) });
      summary.stage = 'placeholders';
      summary.hint = 'Replace template placeholders with real evidence or delete the block. Never guess values.';
      out(summary);
      return 1;
    }
    steps.push({ step: 'placeholders', status: 'PASS' });
  }

  const accents = vietnameseAccentCheck(fs.readFileSync(spec, 'utf8'));
  if (accents.applies && !accents.ok) {
    steps.push({ step: 'vietnamese-accents', status: 'FAIL', samples: accents.samples });
    summary.stage = 'vietnamese-accents';
    summary.hint = 'meta.locale is vi but no prose has Vietnamese diacritics. Rewrite the text you authored with full accents (2 tuần gần nhất), translate English labels, and keep quoted source text as written.';
    out(summary);
    return 1;
  }
  if (accents.applies) steps.push({ step: 'vietnamese-accents', status: 'PASS' });

  const runner = resolveRunner();
  const caps = capabilities(runner);
  summary.cli = { version: caps.version, runner: runner.kind };

  let validation = validateSpec(runner, spec);
  steps.push({ step: 'validate', status: validation.ok ? 'PASS' : 'FAIL', errors: (validation.diagnostics || []).filter((d) => d.severity !== 'warning').length });

  if (!validation.ok && caps.repair && !opts['no-repair']) {
    const rep = runCli(runner, ['repair', spec, '--out', spec, '--json']);
    const repParsed = parseJson(rep.stdout);
    steps.push({ step: 'repair-safe', status: rep.status === 0 ? 'PASS' : 'PARTIAL', changes: repParsed?.changes?.length ?? repParsed?.applied?.length ?? null });
    validation = validateSpec(runner, spec);
    steps.push({ step: 'revalidate', status: validation.ok ? 'PASS' : 'FAIL' });
  } else if (!validation.ok) {
    steps.push({ step: 'repair-safe', status: 'NOT_RUN', reason: caps.repair ? 'disabled by --no-repair' : `not supported by ak-render ${caps.version}` });
  }

  if (!validation.ok) {
    summary.stage = 'validate';
    summary.diagnostics = (validation.diagnostics || []).slice(0, 40);
    summary.hint = 'Fix each diagnostic at its JSON path (details.allowed lists valid props), then build again.';
    out(summary);
    return 1;
  }
  const warnings = (validation.diagnostics || []).filter((d) => d.severity === 'warning');

  const existedBefore = fs.existsSync(html);
  fs.mkdirSync(path.dirname(html), { recursive: true });
  const compileArgs = [spec, '--out', html, '--json'];
  if (opts.theme) compileArgs.push('--theme', opts.theme);
  const compiled = runCli(runner, compileArgs);
  const result = parseJson(compiled.stdout);
  if (compiled.status !== 0 || !result || result.ok === false || !fs.existsSync(html)) {
    steps.push({ step: 'compile', status: 'FAIL' });
    summary.stage = 'compile';
    summary.detail = result || (compiled.stderr || compiled.stdout).trim().slice(0, 800);
    out(summary);
    return 1;
  }
  const bytesOnDisk = fs.statSync(html).size;
  steps.push({ step: 'compile', status: 'PASS' });
  Object.assign(summary, {
    bytes: bytesOnDisk,
    hash: result.hash,
    theme: result.theme,
    features: result.features,
    warnings: [...warnings, ...(result.warnings || [])],
  });

  if (caps.auditUi && !opts['no-audit']) {
    const audit = runCli(runner, ['audit-ui', spec, '--json']);
    const parsed = parseJson(audit.stdout);
    const findings = parsed?.findings || parsed?.issues || [];
    const auditOk = audit.status === 0 && parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.ok !== false;
    steps.push({ step: 'audit-ui', status: auditOk ? 'PASS' : 'FAIL', findings: findings.length });
    if (findings.length) summary.auditFindings = findings.slice(0, 20);
    if (!auditOk) {
      summary.stage = 'audit-ui';
      summary.detail = parsed || (audit.stderr || audit.stdout).trim().slice(0, 800);
      out(summary);
      return 1;
    }
  } else {
    steps.push({ step: 'audit-ui', status: 'NOT_RUN', reason: opts['no-audit'] ? 'disabled by --no-audit' : `not supported by ak-render ${caps.version}` });
  }

  const open = shouldOpen({ existedBefore, noOpen: opts['no-open'] });
  if (open) openFile(html);
  summary.opened = open;
  summary.refreshHint = existedBefore ? 'Page already existed: tell the user to refresh the open tab.' : undefined;
  summary.ok = true;
  out(summary);
  return 0;
}

function openFile(file) {
  const [cmd, args] = process.platform === 'win32'
    ? ['explorer.exe', [file]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Opening is a convenience; the summary still reports the path.
  }
}

function cmdSelftest() {
  const runner = resolveRunner();
  const caps = capabilities(runner);
  const files = listTemplates().map((t) => path.join(TEMPLATE_DIR, `${t}.page.yaml`));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-render-selftest-'));
  const results = [];
  try {
    for (const file of files) {
      // Templates carry <<placeholders>> in strings; they still must validate and compile.
      const v = validateSpec(runner, file);
      let compiled = false;
      if (v.ok) {
        const htmlOut = path.join(tmp, `${path.basename(file, '.page.yaml')}.html`);
        const res = runCli(runner, [file, '--out', htmlOut, '--json']);
        compiled = res.status === 0 && fs.existsSync(htmlOut);
      }
      results.push({ template: path.basename(file), validate: v.ok ? 'PASS' : 'FAIL', compile: compiled ? 'PASS' : 'FAIL', diagnostics: v.ok ? undefined : v.diagnostics });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const ok = results.length > 0 && results.every((r) => r.validate === 'PASS' && r.compile === 'PASS');
  out({ ok, cli: caps.version, runner: runner.kind, results });
  return ok ? 0 : 1;
}

function cmdExec(args) {
  const idx = args.indexOf('--');
  const pass = idx >= 0 ? args.slice(idx + 1) : args;
  if (!pass.length) throw usage('exec -- <ak-render args...>');
  const runner = resolveRunner();
  const res = runCli(runner, pass);
  process.stdout.write(res.stdout);
  process.stderr.write(res.stderr);
  return res.status ?? 1;
}

function parseArgs(args, valued = [], booleans = []) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (valued.includes(name)) {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw usage(`--${name} needs a value`);
        opts[name] = args[++i];
      } else if (booleans.includes(name) || name === 'json') {
        opts[name] = true;
      } else {
        throw usage(`unknown option --${name}`);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

const COMMANDS = {
  doctor: cmdDoctor,
  paths: cmdPaths,
  init: cmdInit,
  check: cmdCheck,
  build: cmdBuild,
  selftest: cmdSelftest,
  exec: cmdExec,
};

function main(argv) {
  const [command, ...rest] = argv;
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`usage: node ak-render.cjs <${Object.keys(COMMANDS).join('|')}> ...\n`);
    return 2;
  }
  try {
    return fn(rest);
  } catch (err) {
    const code = err.exitCode || 1;
    out({ ok: false, status: code === 3 ? 'BLOCKED' : 'ERROR', error: err.message });
    return code;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
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
};
