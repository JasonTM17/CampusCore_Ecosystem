#!/usr/bin/env node
'use strict';

/**
 * AgentKit diagram router and gatekeeper.
 *
 * Picks the engine (Mermaid, Archify or ak:tech-graph) for a diagram request,
 * resolves each engine without a shell, lints and renders Mermaid blocks in
 * Markdown, inventories the diagrams in a docs tree, and passes typed calls
 * through to Archify and the tech-graph template generator. Every command
 * prints one JSON object and never prompts.
 *
 * Usage:
 *   node ak-diagram.cjs doctor [--deep]
 *   node ak-diagram.cjs route <intent...> [--target inline|interactive|image|repo] [--nodes <n>]
 *   node ak-diagram.cjs paths <topic> --engine mermaid|archify|tech-graph [--dir <dir>] [--type <type>]
 *   node ak-diagram.cjs lint <file.md|file.mmd...>
 *   node ak-diagram.cjs render <file.md|file.mmd...> [--out-dir <dir>] [--format svg|png] [--check]
 *   node ak-diagram.cjs scan [dir]
 *   node ak-diagram.cjs archify -- <archify args...>
 *   node ak-diagram.cjs tech-graph <template> <out.svg> <data.json> [--png]
 *
 * Environment:
 *   AK_DIAGRAM_MMDC_VERSION   exact @mermaid-js/mermaid-cli version (default below)
 *   AK_DIAGRAM_MMDC_BIN       path to a local mmdc cli.js or executable
 *   AK_DIAGRAM_BROWSER        Chrome/Chromium/Edge executable for Mermaid rendering
 *   ARCHIFY_HOME              directory that contains bin/archify.mjs
 *
 * Exit codes: 0 ok, 1 diagram error, 2 usage error, 3 engine blocked.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MMDC_PACKAGE = '@mermaid-js/mermaid-cli';
const DEFAULT_MMDC_VERSION = '11.17.1';
const ARCHIFY_MIN_VERSION = '3.2.0';
const MIN_NODE = [20, 11];
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const TIMEOUT_MS = 240000;
const SKILL_DIR = path.resolve(__dirname, '..');
const DEFAULT_DOCS_DIR = path.join('docs', 'diagrams');

const MERMAID_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram', 'gitGraph',
  'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment', 'mindmap', 'timeline',
  'zenuml', 'sankey', 'sankey-beta', 'xychart', 'xychart-beta', 'block', 'block-beta', 'packet',
  'packet-beta', 'kanban', 'architecture', 'architecture-beta', 'radar', 'radar-beta', 'treemap',
  'treemap-beta',
];
// Types GitHub's bundled Mermaid may not render yet; the docs site may still work.
const MERMAID_RECENT = new Set([
  'architecture', 'architecture-beta', 'radar', 'radar-beta', 'treemap', 'treemap-beta', 'packet',
  'packet-beta', 'kanban', 'block', 'block-beta', 'xychart', 'sankey', 'zenuml',
]);

const ARCHIFY_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall'];
// Names generate-from-template.py understands: its SVG templates plus the
// diagram types it has a default canvas for (DEFAULT_VIEWBOX).
const TECH_GRAPH_TEMPLATES = [
  'agent', 'agent-architecture', 'architecture', 'class', 'comparison', 'comparison-matrix', 'data-flow',
  'er-diagram', 'flowchart', 'memory', 'mind-map', 'network-topology', 'sequence', 'state-machine',
  'timeline', 'use-case',
];
const TARGETS = ['inline', 'interactive', 'image', 'repo'];
const ENGINES = ['mermaid', 'archify', 'tech-graph'];

// ---------------------------------------------------------------- pure helpers

function fold(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function slugify(topic) {
  let slug = fold(topic)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug.length > 80) {
    const cut = slug.slice(0, 80);
    const lastDash = cut.lastIndexOf('-');
    slug = (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-$/, '');
  }
  // CON, NUL, COM1 ... are device names on Windows and cannot be file names.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug)) slug = `${slug}-diagram`;
  return slug;
}

/** Compare x.y.z versions; a prerelease (3.2.0-rc.1) sorts before its release. */
function compareVersions(a, b) {
  const [coreA, preA] = String(a).replace(/^v/, '').split('-', 2);
  const [coreB, preB] = String(b).replace(/^v/, '').split('-', 2);
  const pa = coreA.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = coreB.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  return 0;
}

function nodeVersionOk(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

function usage(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function blocked(message, extra = {}) {
  const err = new Error(message);
  err.exitCode = 3;
  err.extra = extra;
  return err;
}

function display(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : p;
}

function mmdcVersion(env = process.env) {
  const v = env.AK_DIAGRAM_MMDC_VERSION || DEFAULT_MMDC_VERSION;
  if (!VERSION_RE.test(v)) throw usage(`AK_DIAGRAM_MMDC_VERSION "${v}" is not an exact version such as ${DEFAULT_MMDC_VERSION}`);
  return v;
}

// ---------------------------------------------------------------- routing

/**
 * Each rule maps intent words (diacritics folded, so Vietnamese works) to a
 * diagram kind and the type name every engine uses for it. A null engine type
 * means that engine has no faithful equivalent.
 */
const KIND_RULES = [
  { kind: 'waterfall', words: ['waterfall', 'latency breakdown', 'span', 'trace timing', 'where the time went', 'thoi gian xu ly'], mermaid: null, archify: 'waterfall', techGraph: null },
  { kind: 'erd', words: ['erd', 'entity relationship', 'database schema', 'db schema', 'schema', 'tables', 'foreign key', 'co so du lieu', 'luoc do du lieu', 'bang du lieu'], mermaid: 'erDiagram', archify: 'erd', techGraph: 'er-diagram' },
  { kind: 'sequence', words: ['sequence', 'request flow', 'api call', 'handshake', 'oauth', 'login flow', 'auth flow', 'callback', 'tuan tu', 'goi api'], mermaid: 'sequenceDiagram', archify: 'sequence', techGraph: 'sequence' },
  { kind: 'lifecycle', words: ['state machine', 'lifecycle', 'status', 'transition', 'retry', 'trang thai', 'vong doi'], mermaid: 'stateDiagram-v2', archify: 'lifecycle', techGraph: 'state-machine' },
  { kind: 'class', words: ['class diagram', 'classes', 'interface', 'inheritance', 'uml', 'so do lop', 'ke thua'], mermaid: 'classDiagram', archify: 'class', techGraph: null },
  { kind: 'gantt', words: ['gantt', 'schedule', 'roadmap', 'milestone', 'sprint', 'lich trinh', 'lo trinh'], mermaid: 'gantt', archify: null, techGraph: 'timeline' },
  { kind: 'timeline', words: ['timeline', 'incident', 'postmortem', 'release history', 'changelog history', 'dong thoi gian', 'su co'], mermaid: 'timeline', archify: 'timeline', techGraph: 'timeline' },
  { kind: 'dataflow', words: ['data flow', 'dataflow', 'pipeline', 'etl', 'elt', 'lineage', 'luong du lieu'], mermaid: 'flowchart LR', archify: 'dataflow', techGraph: 'data-flow' },
  { kind: 'tree', words: ['tree', 'hierarchy', 'folder structure', 'directory', 'module map', 'breakdown', 'cay thu muc', 'phan cap'], mermaid: 'mindmap', archify: 'tree', techGraph: null },
  { kind: 'mindmap', words: ['mind map', 'mindmap', 'concept map', 'brainstorm', 'so do tu duy'], mermaid: 'mindmap', archify: null, techGraph: null },
  { kind: 'pie', words: ['pie', 'pie chart', 'share of', 'percentage split', 'bieu do tron'], mermaid: 'pie', archify: null, techGraph: null },
  { kind: 'quadrant', words: ['quadrant', '2x2', 'priority matrix', 'effort impact'], mermaid: 'quadrantChart', archify: null, techGraph: null },
  { kind: 'xychart', words: ['xy chart', 'bar chart', 'line chart', 'bieu do cot', 'bieu do duong'], mermaid: 'xychart-beta', archify: null, techGraph: null },
  { kind: 'comparison', words: ['comparison matrix', 'feature matrix', 'compare features', 'bang so sanh'], mermaid: null, archify: null, techGraph: 'comparison-matrix' },
  { kind: 'agent', words: ['agent', 'tool call', 'rag', 'memory layer', 'multi-agent', 'llm'], mermaid: 'flowchart TD', archify: 'workflow', techGraph: 'agent-architecture' },
  { kind: 'workflow', words: ['workflow', 'process', 'ci/cd', 'cicd', 'pipeline stage', 'approval', 'runbook', 'onboarding', 'decision', 'flowchart', 'quy trinh', 'luong xu ly', 'cac buoc'], mermaid: 'flowchart TD', archify: 'workflow', techGraph: 'flowchart' },
  { kind: 'architecture', words: ['architecture', 'system', 'component', 'service', 'microservice', 'c4', 'deployment', 'infrastructure', 'topology', 'kien truc', 'he thong', 'thanh phan'], mermaid: 'flowchart LR', archify: 'architecture', techGraph: 'architecture' },
];

const TARGET_RULES = [
  { target: 'repo', words: ['this repo', 'this repository', 'codebase', 'our code', 'from code', 'source code', 'repo nay', 'ma nguon'] },
  { target: 'image', words: ['png', 'slide', 'deck', 'blog', 'poster', 'cover image', 'hero image', 'tweet', 'style 1', 'style 2', 'style 3', 'style 4', 'style 5', 'style 6', 'style 7', 'glassmorphism', 'blueprint', 'dark terminal', 'tech-graph', 'tech graph', 'anh tinh'] },
  { target: 'interactive', words: ['interactive', 'explore', 'html', 'shareable', 'share link', 'to share', 'explainer', 'one page', 'presentation', 'animate', 'archify', 'tuong tac', 'trinh chieu'] },
  { target: 'inline', words: ['readme', 'markdown', 'docs', 'documentation', 'pull request', 'pr description', 'github', 'adr', 'wiki', 'mermaid', 'tai lieu'] },
];

// Requests whose detail inline Mermaid cannot carry: every ERD column, or a
// base/head architecture comparison (Archify's PR delta).
const ARCHIFY_DETAIL_WORDS = ['all columns', 'every column', 'all fields', 'every field', 'full schema', 'architecture delta', 'architecture diff', 'pr delta', 'tat ca cot', 'day du cot', 'so sanh kien truc'];

function hasWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

function detectKind(text) {
  let best = null;
  for (const rule of KIND_RULES) {
    const hits = rule.words.filter((w) => hasWord(text, w));
    if (hits.length && (!best || hits.length > best.hits.length)) best = { rule, hits };
  }
  return best || { rule: KIND_RULES.find((r) => r.kind === 'architecture'), hits: [] };
}

function detectTarget(text) {
  for (const rule of TARGET_RULES) {
    const hits = rule.words.filter((w) => hasWord(text, w));
    if (hits.length) return { target: rule.target, hits };
  }
  return null;
}

/**
 * Decide engine and type. Inline Mermaid is the default because it renders
 * natively on GitHub, diffs as text and needs no build step. Archify wins for
 * repository-backed, interactive or large diagrams and for kinds Mermaid cannot
 * express faithfully. tech-graph is chosen only for a styled static image.
 */
function route(intent, { target, nodes } = {}) {
  const text = fold(intent);
  if (!text.trim()) throw usage('route needs an intent, for example: route "checkout API sequence for the README"');
  if (target && !TARGETS.includes(target)) throw usage(`--target must be one of ${TARGETS.join(', ')}`);
  const nodeCount = nodes === undefined ? null : Number(nodes);
  if (nodeCount !== null && (!Number.isInteger(nodeCount) || nodeCount < 0)) throw usage('--nodes must be a whole number');

  const { rule, hits } = detectKind(text);
  const detected = detectTarget(text);
  const reasons = [];
  let chosenTarget = target || (detected && detected.target) || 'inline';
  reasons.push(target ? `target "${target}" given explicitly` : detected
    ? `target "${detected.target}" from intent words: ${detected.hits.join(', ')}`
    : 'no target words; default to inline Markdown');
  reasons.push(hits.length ? `kind "${rule.kind}" from intent words: ${hits.join(', ')}` : 'no kind words; default to architecture');

  const types = { mermaid: rule.mermaid, archify: rule.archify, 'tech-graph': rule.techGraph };
  // Preference per target. For an image, Mermaid comes before Archify because
  // mermaid-cli exports SVG/PNG unattended; Archify exports only from its viewer.
  const preference = {
    inline: ['mermaid', 'archify', 'tech-graph'],
    repo: ['archify', 'mermaid', 'tech-graph'],
    interactive: ['archify', 'mermaid', 'tech-graph'],
    image: ['tech-graph', 'mermaid', 'archify'],
  }[chosenTarget];
  let engine = preference[0];
  if (engine === 'mermaid' && types.mermaid && nodeCount !== null && nodeCount > 20 && types.archify) {
    engine = 'archify';
    reasons.push(`${nodeCount} nodes exceeds the ~20-node readability limit for inline Mermaid; use Archify and link it`);
  }
  const detail = ARCHIFY_DETAIL_WORDS.filter((w) => hasWord(text, w));
  if (!target && engine === 'mermaid' && types.archify && detail.length) {
    engine = 'archify';
    reasons.push(`"${detail[0]}" needs Archify (full column detail or a base/head architecture delta); link it from a small Mermaid overview`);
  }
  if (!types[engine]) {
    const missing = engine;
    engine = preference.find((e) => types[e]);
    const how = chosenTarget === 'image' && engine === 'mermaid'
      ? '; export it with render --out-dir <dir> --format png'
      : chosenTarget === 'image' && engine === 'archify' ? '; export from the Archify viewer (Export menu)' : '';
    reasons.push(`${missing} has no faithful "${rule.kind}" diagram; using ${engine}${how}`);
  }
  if (chosenTarget === 'inline' && engine === 'archify') chosenTarget = 'interactive';
  if (chosenTarget === 'inline' && engine === 'tech-graph') chosenTarget = 'image';

  const sibling = { mermaid: '/ak:mermaidjs-v11', archify: 'archify (third-party skill)', 'tech-graph': '/ak:tech-graph' };
  const alternatives = ENGINES.filter((e) => e !== engine && types[e]).map((e) => ({ engine: e, type: types[e], via: sibling[e] }));
  return {
    ok: true,
    kind: rule.kind,
    target: chosenTarget,
    engine,
    type: types[engine],
    via: sibling[engine],
    reasons,
    alternatives,
  };
}

function diagramPaths(topic, { engine, dir, type, root = process.cwd() } = {}) {
  if (!ENGINES.includes(engine)) throw usage(`--engine must be one of ${ENGINES.join(', ')}`);
  const slug = slugify(topic);
  if (!slug) throw usage('topic is empty after slugifying; give a topic with letters or digits');
  const base = path.resolve(root, dir || DEFAULT_DOCS_DIR);
  if (engine === 'mermaid') {
    return { slug, engine, dir: base, source: path.join(base, `${slug}.mmd`), svg: path.join(base, `${slug}.svg`) };
  }
  if (engine === 'archify') {
    if (type && !ARCHIFY_TYPES.includes(type)) throw usage(`--type must be one of ${ARCHIFY_TYPES.join(', ')}`);
    const folder = path.join(base, slug);
    return {
      slug,
      engine,
      dir: folder,
      source: path.join(folder, `${slug}${type ? `.${type}` : ''}.json`),
      html: path.join(folder, `${slug}.html`),
    };
  }
  return {
    slug,
    engine,
    dir: base,
    source: path.join(base, `${slug}.tech-graph.json`),
    svg: path.join(base, `${slug}.svg`),
    png: path.join(base, `${slug}.png`),
  };
}

// ---------------------------------------------------------------- Mermaid lint

/**
 * Extract fenced ```mermaid / ~~~mermaid blocks with their 1-based start line.
 * Every fence is tracked, so a Mermaid example shown inside another fence
 * (```` ```text ````) is not mistaken for a diagram. Blockquote markers and
 * list indentation in front of a fence are allowed.
 */
// A marker alone on its line ("1.", "-") starts an empty list item too.
const LIST_MARKER = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/;

function quoteDepth(line) {
  const m = /^((?:\s{0,3}>\s?)*)/.exec(line);
  return (m[1].match(/>/g) || []).length;
}

function stripQuotes(line, depth) {
  let out = line;
  for (let q = 0; q < depth; q += 1) out = out.replace(/^\s{0,3}>\s?/, '');
  return out;
}

function expandTabs(text) {
  return text.replace(/\t/g, '    ');
}

/**
 * Extract fenced ```mermaid / ~~~mermaid blocks with their 1-based start line.
 * Every fence is tracked, so a Mermaid example shown inside another fence
 * (```` ```text ````) is not mistaken for a diagram. Fences inside
 * blockquotes and list items are found; a fence ends when its container ends,
 * as in CommonMark, so an unclosed fence in a quote or list cannot hide the
 * diagrams after it. A fence indented four or more spaces outside a list is
 * an indented code block (a literal example), not a diagram.
 */
function extractMermaidBlocks(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const blocks = [];
  let open = null;
  let listContent = -1; // content column of the most recent list item, -1 outside lists
  let listDepth = 0; // blockquote depth that list item lives in
  let prevBlank = true;
  // A fenced block is not a paragraph, so the line right after a fence that
  // closed inside a list item gets no lazy continuation: under-indented, it
  // ends the list (CommonMark 5.2).
  let afterListFence = false;
  // An item that starts empty holds no paragraph, so an under-indented line or
  // a blank line right after it ends the list (CommonMark 5.2).
  let emptyItem = false;
  // An open paragraph absorbs an empty item marker and a four-space line.
  let inPara = false;
  let paraDepth = 0;
  const finish = (unclosed) => {
    if (open.mermaid) blocks.push({ line: open.line, code: open.body.join('\n'), ...(unclosed ? { unclosed: true } : {}) });
    open = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (open) {
      const depth = quoteDepth(raw);
      // A line holding only quote markers is blank inside the quote (CommonMark 5.1).
      const blank = !stripQuotes(raw, open.quote).trim();
      // A line without the quote marker, blank or not, ends the blockquote and its fence.
      const leaving = (open.quote > 0 && depth < open.quote)
        || (open.container > 0 && !blank && expandTabs(stripQuotes(raw, open.quote)).search(/\S/) < open.container);
      if (!leaving) {
        const line = stripQuotes(raw, open.quote);
        // A closing fence sits at most three spaces past its container; deeper is content.
        const close = new RegExp(`^( *)${open.fence[0] === '`' ? '`' : '~'}{${open.fence.length},}\\s*$`);
        const closing = close.exec(expandTabs(line));
        if (closing && closing[1].length - open.container <= 3) {
          afterListFence = open.container > 0;
          inPara = false;
          finish(false);
        } else if (open.mermaid) open.body.push(expandTabs(line).replace(new RegExp(`^ {0,${open.indent}}`), ''));
        continue;
      }
      // The quote or list item ended before the fence closed; reprocess this line.
      afterListFence = open.container > 0;
      inPara = false;
      finish(true);
    }
    const depth = quoteDepth(raw);
    // A list belongs to the quote level it started in.
    if (depth !== listDepth) listContent = -1;
    let line = expandTabs(stripQuotes(raw, depth));
    let container = 0;
    let marker = LIST_MARKER.exec(line);
    // A paragraph belongs to its quote level too. A line with fewer quote
    // markers lazily continues it, unless it starts a list outside the quote.
    const outsidePara = inPara && depth < paraDepth;
    if (!outsidePara || marker || !line.trim()) {
      // A deeper quote marker opens a new blockquote, which ends the paragraph too.
      if (outsidePara || depth > paraDepth) inPara = false;
      paraDepth = depth;
    }
    const empty = Boolean(marker) && !line.slice(marker[0].length).trim();
    // Inside a paragraph an empty item, or an ordered item not starting at 1,
    // is paragraph text rather than a new list (CommonMark 5.2). A marker left
    // of the current item's content column starts an outer list instead.
    const sameContainer = inPara && !(listContent >= 0 && marker && marker[1].length < listContent);
    if (sameContainer && /^ {0,3}(-+|=+)\s*$/.test(line)) {
      // A "-" or "=" line under paragraph text is a setext heading underline.
      inPara = false;
      prevBlank = false;
      afterListFence = false;
      emptyItem = false;
      continue;
    }
    if (marker && sameContainer && (empty || (/^\d/.test(marker[2]) && !/^0*1[.)]$/.test(marker[2])))) marker = null;
    if (marker) {
      // An item that starts empty has its content one column past the marker (CommonMark 5.2).
      container = empty ? marker[1].length + marker[2].length + 1 : marker[0].length;
      listContent = container;
      listDepth = depth;
      line = ' '.repeat(container) + line.slice(Math.min(container, line.length));
    } else if (!line.trim()) {
      if (emptyItem) listContent = -1;
      prevBlank = true;
      emptyItem = false;
      inPara = false;
      continue;
    } else if (listContent >= 0 && line.search(/\S/) >= listContent) {
      container = listContent;
    } else if (prevBlank || afterListFence || emptyItem) {
      // After a blank line, a closed fence or an empty item, an under-indented
      // line ends the list. After paragraph text it is a lazy continuation and
      // the item goes on.
      listContent = -1;
    }
    prevBlank = false;
    afterListFence = false;
    emptyItem = Boolean(marker) && empty;
    const wasPara = inPara;
    // Four or more spaces past the container column is an indented code block,
    // unless a paragraph is open: then the line is paragraph text.
    inPara = !emptyItem && (wasPara || line.search(/\S/) - container < 4);
    const m = /^(\s*)(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    if (indent - container >= 4) continue;
    inPara = false;
    // A fence is never a lazy continuation: under-indented, it ends the list.
    if (container === 0) listContent = -1;
    open = {
      quote: depth,
      container,
      indent,
      fence: m[2],
      mermaid: m[3].toLowerCase() === 'mermaid',
      line: i + 1,
      body: [],
    };
  }
  if (open) finish(true);
  return blocks;
}

function headerOf(code) {
  const lines = String(code).split(/\r?\n/);
  let i = 0;
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i += 1;
    i += 1;
  }
  for (; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t || t.startsWith('%%')) continue;
    return { token: t.split(/\s+/)[0].replace(/:$/, ''), lineOffset: i };
  }
  return null;
}

/** Static checks that need no renderer. The renderer stays the authority. */
function lintMermaid(code, { unclosed = false } = {}) {
  const errors = [];
  const warnings = [];
  if (unclosed) errors.push({ rule: 'fence/unclosed', message: 'the mermaid fence is never closed' });
  const header = headerOf(code);
  if (!header) {
    errors.push({ rule: 'diagram/empty', message: 'block has no diagram content' });
    return { type: null, errors, warnings };
  }
  const type = header.token;
  if (!MERMAID_TYPES.includes(type)) {
    errors.push({ rule: 'diagram/unknown-type', message: `"${type}" is not a Mermaid diagram type`, hint: `start with one of: ${MERMAID_TYPES.slice(0, 12).join(', ')}, ...` });
  }
  if (MERMAID_RECENT.has(type)) {
    warnings.push({ rule: 'github/recent-type', message: `GitHub may not render "${type}" yet; check the rendered page or use a long-supported type` });
  }
  if (/<\s*script\b/i.test(code) || /javascript\s*:/i.test(code)) {
    errors.push({ rule: 'security/script', message: 'scripts and javascript: links are not allowed in documentation diagrams' });
  }
  // Allowed: click A href "https://..." and click A "https://...". Anything else names a page callback.
  // Mermaid separates statements with newlines or semicolons; %% comment lines are not statements.
  const statements = code.split(/\r?\n/).filter((l) => !l.trim().startsWith('%%')).join('\n').split(/[\n;]/);
  for (const statement of statements) {
    const m = /^\s*click\s+\S+\s+(\S+)/.exec(statement);
    if (m && m[1] !== 'href' && !/^["']/.test(m[1])) {
      errors.push({ rule: 'security/click-callback', message: `"${statement.trim()}" runs a page callback; GitHub strips it and it is unsafe in shared docs` });
    }
  }
  if ((type === 'flowchart' || type === 'graph')) {
    const lines = code.split(/\r?\n/);
    lines.forEach((l, idx) => {
      if (/(^|[\s>-])end\s*(-->|---|-\.|==>|\[|\(|\{)/.test(l) || /(-->|---|==>)\s*end\b(?!\w)/.test(l)) {
        warnings.push({ rule: 'flowchart/end-node', line: idx + 1, message: 'a node named "end" breaks flowcharts; use End or finish' });
      }
    });
    const nodeIds = new Set();
    for (const m of code.matchAll(/(?:^|\s|-->|---|==>)([A-Za-z_][\w-]*)\s*[[({>]/gm)) nodeIds.add(m[1]);
    if (nodeIds.size > 25) {
      warnings.push({ rule: 'readability/too-many-nodes', message: `${nodeIds.size} nodes; split the diagram or move it to Archify and link it` });
    }
  }
  if (/\t/.test(code)) warnings.push({ rule: 'style/tabs', message: 'tabs found; indent with spaces so diffs stay stable' });
  return { type, errors, warnings };
}

function readSource(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw usage(`file not found: ${file}`);
  const text = fs.readFileSync(abs, 'utf8');
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.mmd' || ext === '.mermaid') return { abs, blocks: [{ line: 1, code: text }] };
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return { abs, blocks: extractMermaidBlocks(text) };
  throw usage(`unsupported file type ${ext || '(none)'}; give .md, .mdx, .markdown, .mmd or .mermaid`);
}

function lintFiles(files) {
  const results = [];
  for (const file of files) {
    const { abs, blocks } = readSource(file);
    blocks.forEach((block, index) => {
      const r = lintMermaid(block.code, { unclosed: block.unclosed });
      results.push({ file: display(abs), block: index + 1, line: block.line, type: r.type, status: r.errors.length ? 'FAIL' : 'PASS', errors: r.errors, warnings: r.warnings });
    });
  }
  return results;
}

// ---------------------------------------------------------------- runners

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

function readPkgVersion(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

function npmCacheDir(env = process.env) {
  if (env.npm_config_cache) return env.npm_config_cache;
  const npm = npmBinJs('npm');
  if (npm) {
    // A relocated cache (npm config set cache ...) is common; ask npm instead of guessing.
    const res = spawnSync(process.execPath, [npm, 'config', 'get', 'cache'], { encoding: 'utf8', timeout: 30000, env });
    const dir = (res.stdout || '').trim();
    if (res.status === 0 && dir && fs.existsSync(dir)) return dir;
  }
  return process.platform === 'win32'
    ? path.join(env.LOCALAPPDATA || os.homedir(), 'npm-cache')
    : path.join(os.homedir(), '.npm');
}

function mmdcInPkg(pkgDir) {
  const cli = path.join(pkgDir, 'src', 'cli.js');
  return fs.existsSync(cli) ? cli : null;
}

function findGlobalMmdc(env = process.env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const pkgDir = process.platform === 'win32'
      ? path.join(dir, 'node_modules', ...MMDC_PACKAGE.split('/'))
      : path.join(dir, '..', 'lib', 'node_modules', ...MMDC_PACKAGE.split('/'));
    const cli = mmdcInPkg(pkgDir);
    if (cli) return { cli, version: readPkgVersion(pkgDir) };
  }
  return null;
}

function findNpxMmdc(version, env = process.env) {
  const root = path.join(npmCacheDir(env), '_npx');
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const pkgDir = path.join(root, entry, 'node_modules', ...MMDC_PACKAGE.split('/'));
    if (readPkgVersion(pkgDir) === version) {
      const cli = mmdcInPkg(pkgDir);
      if (cli) return { cli, version };
    }
  }
  return null;
}

function resolveMmdc(env = process.env) {
  const pin = mmdcVersion(env);
  if (env.AK_DIAGRAM_MMDC_BIN) {
    let bin = path.resolve(env.AK_DIAGRAM_MMDC_BIN);
    if (!fs.existsSync(bin)) throw blocked(`AK_DIAGRAM_MMDC_BIN does not exist: ${env.AK_DIAGRAM_MMDC_BIN}`);
    if (/\.(cmd|bat|ps1)$/i.test(bin)) {
      // npm shims need a shell; run the JavaScript entry point they wrap instead.
      const cli = mmdcInPkg(path.join(path.dirname(bin), 'node_modules', ...MMDC_PACKAGE.split('/')));
      if (!cli) throw usage(`AK_DIAGRAM_MMDC_BIN points at a shell shim (${path.basename(bin)}); point it at mermaid-cli's src/cli.js instead`);
      bin = cli;
    }
    if (!bin.endsWith('.js')) return { kind: 'env-exe', exe: bin, pin, installed: null };
    // A JS entry lives in <pkg>/src/cli.js; report the version that will actually run.
    const installed = readPkgVersion(path.resolve(path.dirname(bin), '..'));
    return { kind: 'env', cli: bin, pin, installed };
  }
  const global = findGlobalMmdc(env);
  if (global && global.version === pin) return { kind: 'global', cli: global.cli, installed: pin, pin };
  const cached = findNpxMmdc(pin, env);
  if (cached) return { kind: 'npx-cache', cli: cached.cli, installed: pin, pin };
  return { kind: 'npx', pin, note: global ? `global mmdc ${global.version} ignored; pin is ${pin}` : undefined };
}

function browserCandidates(env = process.env, platform = process.platform) {
  const list = [];
  if (env.AK_DIAGRAM_BROWSER) list.push(env.AK_DIAGRAM_BROWSER);
  if (env.PUPPETEER_EXECUTABLE_PATH) list.push(env.PUPPETEER_EXECUTABLE_PATH);
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) {
      list.push(path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      list.push(path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      list.push(path.join(r, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    list.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    list.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium');
  }
  return list;
}

function findBrowser(env = process.env) {
  return browserCandidates(env).find((p) => p && fs.existsSync(p)) || null;
}

function onPath(names, env = process.env) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      for (const ext of exts) {
        const file = path.join(dir, name + ext);
        if (fs.existsSync(file)) return file;
      }
    }
  }
  return null;
}

function findPython(env = process.env) {
  const candidates = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const name of candidates) {
    const bin = onPath([name], env);
    if (!bin || /WindowsApps/i.test(bin)) continue;
    const args = name === 'py' ? ['-3', '--version'] : ['--version'];
    const res = spawnSync(bin, args, { encoding: 'utf8', timeout: 20000 });
    const v = `${res.stdout || ''}${res.stderr || ''}`.trim();
    if (res.status === 0 && /Python 3\./.test(v)) return { bin, prefix: name === 'py' ? ['-3'] : [], version: v.replace(/^Python\s+/, '') };
  }
  return null;
}

// ---------------------------------------------------------------- Archify resolution

function archifyCandidates(root = process.cwd(), env = process.env) {
  const home = os.homedir();
  const list = [];
  if (env.ARCHIFY_HOME) list.push({ scope: 'env', dir: path.resolve(env.ARCHIFY_HOME) });
  for (const rel of ['.claude/skills/archify', '.agents/skills/archify', '.codex/skills/archify', '.cursor/skills/archify', '.opencode/skills/archify']) {
    list.push({ scope: 'project', dir: path.resolve(root, rel) });
  }
  for (const rel of ['.claude/skills/archify', '.agents/skills/archify', '.codex/skills/archify', '.cursor/skills/archify', '.config/opencode/skills/archify']) {
    list.push({ scope: 'user', dir: path.join(home, rel) });
  }
  return list;
}

function archifyVersion(dir) {
  try {
    const rel = JSON.parse(fs.readFileSync(path.join(dir, 'skill-release.json'), 'utf8'));
    const v = rel.version || rel.release?.version || rel.skillVersion;
    if (v) return String(v).replace(/^v/, '');
  } catch {
    // fall through to package.json and SKILL.md
  }
  const pkg = readPkgVersion(dir);
  if (pkg) return pkg;
  try {
    const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    // Take the whole token; strict validation in resolveArchify rejects anything odd.
    const m = /^\s*version:\s*["']?([^\s"']+)/m.exec(skill);
    if (m) return m[1];
  } catch {
    // no version source
  }
  return null;
}

function resolveArchify(root = process.cwd(), env = process.env) {
  const searched = [];
  for (const cand of archifyCandidates(root, env)) {
    const bin = path.join(cand.dir, 'bin', 'archify.mjs');
    searched.push(display(cand.dir));
    if (fs.existsSync(bin)) {
      const version = archifyVersion(cand.dir);
      // Fail closed: an unreadable or malformed version is not a supported version.
      const wellFormed = /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(version || '');
      return { found: true, scope: cand.scope, dir: cand.dir, bin, version, wellFormed, supported: wellFormed && compareVersions(version, ARCHIFY_MIN_VERSION) >= 0, searched };
    }
  }
  return { found: false, searched };
}

const ARCHIFY_INSTALL_HINT = 'Ask the user to confirm scope (global or this project) and agent first, then: '
  + 'npx -y skills@latest add https://archify.si --list --full-depth  (must list exactly one skill named archify), then '
  + 'npx -y skills@latest add https://archify.si --skill archify --agent claude-code --copy --yes  (add --global for user scope). '
  + 'Never install or update Archify without that confirmation.';

// ---------------------------------------------------------------- commands

function out(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

/**
 * Parse options. Everything after `--` is returned as `rest` when `keepRest`
 * (the Archify passthrough); otherwise it is positional, so a file named like
 * an option can still be given as `lint -- --odd.md`.
 */
function parseArgs(args, valued = [], booleans = [], { keepRest = false } = {}) {
  const positional = [];
  const opts = {};
  let rest = null;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--') {
      if (keepRest) rest = args.slice(i + 1);
      else positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (valued.includes(name)) {
        if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw usage(`--${name} needs a value`);
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
  return { positional, opts, rest };
}

function cmdDoctor(args) {
  const { opts } = parseArgs(args, [], ['deep']);
  const nodeOk = nodeVersionOk();
  const mmdc = resolveMmdc();
  const browser = findBrowser();
  const archify = resolveArchify();
  const techGraphDir = path.resolve(SKILL_DIR, '..', 'ak-tech-graph');
  const techGraphScript = path.join(techGraphDir, 'scripts', 'generate-from-template.py');
  const python = findPython();
  const rsvg = onPath(['rsvg-convert']);

  const engines = {
    mermaid: {
      lint: 'PASS',
      render: nodeOk ? 'READY' : 'BLOCKED',
      runner: mmdc.kind,
      pin: mmdc.pin,
      installed: mmdc.installed === undefined ? null : mmdc.installed,
      browser: browser ? display(browser) : null,
      note: [
        mmdc.note,
        mmdc.kind === 'npx' ? `not installed; render needs --allow-download (after the user agrees) to fetch ${MMDC_PACKAGE}@${mmdc.pin} from npm` : null,
        mmdc.kind.startsWith('env') && mmdc.installed !== mmdc.pin ? `AK_DIAGRAM_MMDC_BIN runs ${mmdc.installed || 'an unknown version'}, not the pin ${mmdc.pin}` : null,
        browser ? null : 'no Chrome/Edge found; mermaid-cli downloads its own browser on first render',
      ].filter(Boolean),
    },
    archify: archify.found
      ? { status: archify.supported ? 'READY' : 'UNSUPPORTED', scope: archify.scope, dir: display(archify.dir), version: archify.version, minVersion: ARCHIFY_MIN_VERSION }
      : { status: 'NOT_INSTALLED', searched: archify.searched, install: ARCHIFY_INSTALL_HINT },
    techGraph: {
      status: fs.existsSync(techGraphScript) && python ? 'READY' : 'BLOCKED',
      skill: fs.existsSync(techGraphScript) ? display(techGraphDir) : null,
      python: python ? python.version : null,
      png: rsvg ? 'READY' : 'NOT_AVAILABLE',
      note: rsvg ? [] : ['rsvg-convert not on PATH: SVG only, PNG export NOT_RUN (install librsvg)'],
    },
  };
  if (opts.deep && archify.found) {
    const res = spawnSync(process.execPath, [archify.bin, 'doctor'], { encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
    engines.archify.doctor = { exit: res.status, output: `${res.stdout || ''}${res.stderr || ''}`.trim().slice(0, 2000) };
    if (res.status !== 0) engines.archify.status = 'FAIL';
  }
  // Availability gaps are reported per engine; a health check that ran and failed fails doctor.
  const failedChecks = opts.deep && engines.archify.status === 'FAIL' ? ['archify doctor'] : [];
  const ok = nodeOk && failedChecks.length === 0;
  const status = !nodeOk ? 'BLOCKED' : failedChecks.length ? 'FAIL' : 'PASS';
  out({ ok, status, node: process.versions.node, nodeOk, failedChecks, engines });
  return !nodeOk ? 3 : failedChecks.length ? 1 : 0;
}

function cmdRoute(args) {
  const { positional, opts } = parseArgs(args, ['target', 'nodes']);
  out(route(positional.join(' '), { target: opts.target, nodes: opts.nodes }));
  return 0;
}

function cmdPaths(args) {
  const { positional, opts } = parseArgs(args, ['engine', 'dir', 'type']);
  if (!positional.length || !opts.engine) throw usage('paths <topic> --engine mermaid|archify|tech-graph [--dir <dir>] [--type <archify type>]');
  const p = diagramPaths(positional.join(' '), { engine: opts.engine, dir: opts.dir, type: opts.type });
  const shown = {};
  for (const [k, v] of Object.entries(p)) shown[k] = typeof v === 'string' && path.isAbsolute(v) ? display(v) : v;
  shown.sourceExists = fs.existsSync(p.source);
  out(shown);
  return 0;
}

function cmdLint(args) {
  const { positional } = parseArgs(args);
  if (!positional.length) throw usage('lint <file.md|file.mmd...>');
  const results = lintFiles(positional);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  out({ ok: failed === 0, blocks: results.length, failed, results });
  return failed ? 1 : 0;
}

function runMmdc(runner, args, env) {
  const opts = { encoding: 'utf8', timeout: TIMEOUT_MS, env, maxBuffer: 16 * 1024 * 1024 };
  let res;
  if (runner.cli) res = spawnSync(process.execPath, [runner.cli, ...args], opts);
  else if (runner.exe) res = spawnSync(runner.exe, args, opts);
  else {
    const npx = npmBinJs('npx');
    if (!npx) throw blocked('npx was not found next to this Node.js; install mermaid-cli globally or set AK_DIAGRAM_MMDC_BIN');
    res = spawnSync(process.execPath, [npx, '-y', `${MMDC_PACKAGE}@${runner.pin}`, ...args], opts);
  }
  if (res.error) throw blocked(`could not run mermaid-cli (${runner.kind}): ${res.error.code || res.error.message}`);
  return res;
}

function cleanMmdcError(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s+at\s/.test(l) && !/node_modules/.test(l))
    .slice(0, 8)
    .join('\n');
}

/** Output file names unique across all inputs: a lone .mmd keeps its stem; others get path + block number. */
function outputNames(sources, format, root = process.cwd()) {
  // Every name handed out, including suffixed ones, is reserved, so a later
  // input called "a-b-2" cannot reuse a suffix generated for "a_b".
  const used = new Set();
  const names = [];
  const multi = sources.length > 1;
  for (const { abs, blocks } of sources) {
    const rel = path.relative(root, abs);
    const base = multi && !rel.startsWith('..') ? slugify(rel.replace(/\.[^.]+$/, '')) : slugify(path.basename(abs).replace(/\.[^.]+$/, ''));
    const lone = blocks.length === 1 && /\.(mmd|mermaid)$/i.test(abs);
    names.push(blocks.map((_, i) => {
      const stem = `${base || 'diagram'}${lone ? '' : `-${i + 1}`}`;
      let name = stem;
      for (let n = 2; used.has(name); n += 1) name = `${stem}-${n}`;
      used.add(name);
      return `${name}.${format}`;
    }));
  }
  return names;
}

function cmdRender(args) {
  const { positional, opts } = parseArgs(args, ['out-dir', 'format'], ['check', 'allow-download']);
  if (!positional.length) throw usage('render <file.md|file.mmd...> [--out-dir <dir>] [--format svg|png] [--check] [--allow-download]');
  const format = opts.format || 'svg';
  if (!['svg', 'png'].includes(format)) throw usage('--format must be svg or png');
  if (!nodeVersionOk()) throw blocked(`Node.js ${MIN_NODE.join('.')}+ is required`);
  const runner = resolveMmdc();
  if (runner.kind === 'npx' && !opts['allow-download']) {
    throw blocked(`${MMDC_PACKAGE}@${runner.pin} is not installed. Ask the user before downloading it from npm, then rerun with --allow-download (or install it: npm i -g ${MMDC_PACKAGE}@${runner.pin}). Lint still works offline.`);
  }
  const sources = positional.map(readSource);
  const names = outputNames(sources, format);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-diagram-'));
  const browser = findBrowser();
  const env = { ...process.env };
  const mmdcArgsBase = ['-q', '-b', 'transparent'];
  if (browser) {
    const cfg = path.join(tmp, 'puppeteer.json');
    const config = { executablePath: browser, headless: true };
    if (process.platform === 'linux') config.args = ['--no-sandbox', '--disable-setuid-sandbox'];
    fs.writeFileSync(cfg, JSON.stringify(config));
    mmdcArgsBase.push('-p', cfg);
    env.PUPPETEER_SKIP_DOWNLOAD = '1';
  }
  const results = [];
  let failed = 0;
  try {
    sources.forEach(({ abs, blocks }, sourceIndex) => {
      blocks.forEach((block, index) => {
        const lint = lintMermaid(block.code, { unclosed: block.unclosed });
        const entry = { file: display(abs), block: index + 1, line: block.line, type: lint.type, warnings: lint.warnings };
        if (lint.errors.length) {
          failed += 1;
          results.push({ ...entry, status: 'FAIL', stage: 'lint', errors: lint.errors });
          return;
        }
        const name = names[sourceIndex][index];
        const input = path.join(tmp, `${sourceIndex + 1}-${index + 1}.mmd`);
        fs.writeFileSync(input, block.code);
        const outDir = opts.check || !opts['out-dir'] ? tmp : path.resolve(opts['out-dir']);
        fs.mkdirSync(outDir, { recursive: true });
        const output = path.join(outDir, name);
        // A file left from an earlier run must not count as this run's output.
        fs.rmSync(output, { force: true });
        const res = runMmdc(runner, ['-i', input, '-o', output, ...mmdcArgsBase], env);
        if (res.status !== 0 || !fs.existsSync(output)) {
          failed += 1;
          results.push({ ...entry, status: 'FAIL', stage: 'render', error: cleanMmdcError(res.stderr || res.stdout) || `mmdc exited ${res.status}` });
          return;
        }
        const bytes = fs.statSync(output).size;
        results.push({ ...entry, status: 'PASS', stage: 'render', bytes, out: opts.check || !opts['out-dir'] ? null : display(output) });
      });
    });
  } finally {
    // Exports go to --out-dir; the temp folder only ever holds inputs and config.
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const version = runner.installed === undefined ? runner.pin : runner.installed;
  out({ ok: failed === 0, runner: runner.kind, pin: runner.pin, version: version || 'unknown', pinMatched: version === runner.pin, browser: browser ? 'system' : 'bundled', format, blocks: results.length, failed, results });
  return failed ? 1 : 0;
}

const SCAN_SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', 'coverage', '.next']);

function scanTree(rootDir, { maxFiles = 5000 } = {}) {
  const report = { markdown: [], mermaidFiles: [], archify: [], techGraph: [], images: [], unreadable: [] };
  let seen = 0;
  let depthLimited = false;
  const walk = (dir, depth) => {
    if (seen > maxFiles) return;
    if (depth > 12) {
      depthLimited = true;
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      report.unreadable.push({ path: display(dir), error: err.code || err.message });
      return;
    }
    for (const e of entries) {
      if (SCAN_SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') && e.name !== '.archify' && e.name !== '.github') continue;
        walk(full, depth + 1);
        continue;
      }
      seen += 1;
      const lower = e.name.toLowerCase();
      if (/\.(md|mdx|markdown)$/.test(lower)) {
        let text = '';
        try {
          text = fs.readFileSync(full, 'utf8');
        } catch (err) {
          report.unreadable.push({ path: display(full), error: err.code || err.message });
          continue;
        }
        const blocks = extractMermaidBlocks(text);
        if (blocks.length) {
          const types = blocks.map((b) => (headerOf(b.code) || {}).token || null);
          report.markdown.push({ file: display(full), mermaidBlocks: blocks.length, types });
        }
      } else if (/\.(mmd|mermaid)$/.test(lower)) {
        report.mermaidFiles.push(display(full));
      } else if (lower.endsWith('.finalize-summary.json') || (/\.json$/.test(lower) && ARCHIFY_TYPES.some((t) => lower.endsWith(`.${t}.json`)))) {
        report.archify.push(display(full));
      } else if (lower.endsWith('.tech-graph.json')) {
        report.techGraph.push(display(full));
      } else if (/\.(svg|png)$/.test(lower) && /(^|[\\/])(diagrams?|visuals|architecture)([\\/]|$)/i.test(full)) {
        report.images.push(display(full));
      }
    }
  };
  walk(rootDir, 0);
  report.truncated = seen > maxFiles || depthLimited;
  return report;
}

function cmdScan(args) {
  const { positional } = parseArgs(args);
  const dir = path.resolve(positional[0] || '.');
  if (!fs.existsSync(dir)) throw usage(`directory not found: ${positional[0]}`);
  if (!fs.statSync(dir).isDirectory()) throw usage(`scan takes a directory; use lint ${positional[0]} for a single file`);
  const report = scanTree(dir);
  const blocks = report.markdown.reduce((n, m) => n + m.mermaidBlocks, 0);
  // An incomplete inventory is not a clean one.
  const complete = !report.truncated && report.unreadable.length === 0;
  out({
    ok: complete,
    complete,
    root: display(dir),
    counts: { markdownWithMermaid: report.markdown.length, mermaidBlocks: blocks, mermaidFiles: report.mermaidFiles.length, archifySources: report.archify.length, techGraphSources: report.techGraph.length, diagramImages: report.images.length },
    ...report,
  });
  return complete ? 0 : 1;
}

function cmdArchify(args) {
  const { rest } = parseArgs(args, [], [], { keepRest: true });
  if (!rest || !rest.length) throw usage('archify -- <archify args...>, for example: archify -- finalize architecture candidate.json out.html --quality showcase --json');
  const archify = resolveArchify();
  if (!archify.found) throw blocked('Archify is not installed', { searched: archify.searched, install: ARCHIFY_INSTALL_HINT });
  if (!archify.supported) {
    throw blocked(archify.wellFormed
      ? `Archify ${archify.version} is older than ${ARCHIFY_MIN_VERSION}; ask the user before updating it`
      : archify.version
        ? `Archify at ${display(archify.dir)} reports a malformed version "${archify.version}"; reinstall it with the user's consent`
        : `Archify at ${display(archify.dir)} has no readable version (skill-release.json); reinstall it with the user's consent`);
  }
  const res = spawnSync(process.execPath, [archify.bin, ...rest], { stdio: 'inherit', timeout: 15 * 60 * 1000 });
  if (res.error) throw blocked(`could not run Archify: ${res.error.code || res.error.message}`);
  return res.status === null ? 1 : res.status;
}

/** Markup that would execute or load something when the SVG is opened in a browser. */
function svgActiveContent(svg) {
  // Element and attribute names may carry any XML namespace prefix, including
  // non-ASCII ones (<s:script>, <é:script>, ev:onclick); match the local name.
  const ns = '(?:[^\\s<>/:="\']+:)?';
  const checks = [
    ['<script>', new RegExp(`<${ns}script\\b`, 'iu')],
    ['<foreignObject>', new RegExp(`<${ns}foreignObject\\b`, 'iu')],
    ['<iframe>/<object>/<embed>', new RegExp(`<${ns}(iframe|object|embed|handler|listener)\\b`, 'iu')],
    ['event handler attribute', new RegExp(`<[^>]*\\s${ns}on[a-z]+\\s*=`, 'iu')],
    ['set/animate of an href', new RegExp(`<${ns}(set|animate)\\b[^>]*attributeName\\s*=\\s*["']${ns}href`, 'iu')],
    ['@import', /@import\b/i],
  ];
  const found = checks.filter(([, re]) => re.test(svg)).map(([label]) => label);
  // Walk every tag with a quote-aware scanner so a '>' inside a quoted value
  // cannot hide the attributes that follow it.
  const localName = (name) => name.slice(name.lastIndexOf(':') + 1).toLowerCase();
  const clean = (value) => decodeXmlEntities(value).replace(/[\u0000- ]/g, '');
  for (const { name, attrs, target } of svgTags(svg)) {
    if (name === '?pi') {
      found.push(`processing instruction <?${target}?>`);
      continue;
    }
    const element = localName(name);
    if (element === 'script') found.push('<script>');
    if (element === 'foreignobject') found.push('<foreignObject>');
    if (['iframe', 'object', 'embed', 'handler', 'listener'].includes(element)) found.push('<iframe>/<object>/<embed>');
    for (const [attrName, rawValue] of attrs) {
      const attr = localName(attrName);
      const value = clean(rawValue);
      if (attr.startsWith('on')) found.push('event handler attribute');
      // Links are allowlisted, not blacklisted: after XML entity decoding,
      // every href must point inside the document (#id). That covers
      // javascript:, data:, remote URLs and any encoding of them.
      if (attr === 'href' && !value.startsWith('#')) found.push('non-local link');
      if (/^(set|animate\w*)$/.test(element) && attr === 'attributename' && localName(value) === 'href') {
        found.push('set/animate of an href');
      }
    }
  }
  // Script URLs and external url() loads anywhere (attributes, <style>, text),
  // however they are encoded. url(#id) references stay allowed.
  // CSS escapes (u\72l, \75 rl) are decoded too, after XML entities.
  const flat = clean(decodeCssEscapes(decodeXmlEntities(svg))).toLowerCase();
  if (/(java|vb)script:|data:text\/html/.test(flat)) found.push('script URL');
  if (/@import/.test(flat)) found.push('@import');
  // CSS can fetch through more functions than url() (image-set, cross-fade,
  // src, element ...). In CSS contexts (<style> text and attribute values)
  // allow only #id arguments and no quoted absolute or protocol-relative URL.
  const cssParts = [];
  for (const m of svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)) cssParts.push(m[1]);
  for (const { name, attrs } of svgTags(svg)) {
    if (name === '?pi') continue;
    for (const [attrName, value] of attrs) if (!/^xmlns(:|$)/i.test(attrName)) cssParts.push(value);
  }
  const css = decodeCssEscapes(decodeXmlEntities(cssParts.join('\n'))).replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, '').toLowerCase();
  if (/(?:^|[^a-z0-9_-])(?:-webkit-)?(?:image-set|image|cross-fade|element|src|url)\s*\(\s*(?!['"]?\s*#)[^)\s]/.test(css)
    || /["']\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/.test(css)) {
    found.push('external CSS load');
  }
  if (/url\((?!['"]?#)/.test(flat)) found.push('external url()');
  return [...new Set(found)];
}

/**
 * Yield { name, attrs: [[name, value]] } for each start tag the way an XML
 * parser sees it: comments, CDATA sections and declarations are skipped as
 * whole units (so a quote inside them cannot shift tag boundaries), quoted
 * values may contain '>', and processing instructions are reported as '?pi'.
 */
function* svgTags(svg) {
  let i = 0;
  const skipTo = (from, end) => {
    const k = svg.indexOf(end, from);
    return k === -1 ? svg.length : k + end.length;
  };
  while ((i = svg.indexOf('<', i)) !== -1) {
    if (svg.startsWith('<!--', i)) { i = skipTo(i + 4, '-->'); continue; }
    if (svg.startsWith('<![CDATA[', i)) { i = skipTo(i + 9, ']]>'); continue; }
    if (svg.startsWith('<?', i)) {
      const end = skipTo(i + 2, '?>');
      const target = /^<\?([^\s?]+)/.exec(svg.slice(i, end));
      if (!target || target[1].toLowerCase() !== 'xml') yield { name: '?pi', attrs: [], target: target ? target[1] : '' };
      i = end;
      continue;
    }
    if (svg.startsWith('<!', i)) { i = skipTo(i + 2, '>'); continue; }
    const nameMatch = /^<([^\s/>!?]+)/u.exec(svg.slice(i, i + 256));
    if (!nameMatch) { i += 1; continue; }
    let j = i + nameMatch[0].length;
    let quote = null;
    for (; j < svg.length; j += 1) {
      const ch = svg[j];
      if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break;
    }
    const body = svg.slice(i + nameMatch[0].length, j);
    const attrs = [];
    for (const m of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu)) {
      attrs.push([m[1], m[2] ?? m[3] ?? m[4] ?? '']);
    }
    yield { name: nameMatch[1], attrs };
    i = j + 1;
  }
}

/**
 * Structural allowlist for generated SVG, run with Python's XML parser so that
 * namespaces, CDATA and entities are resolved exactly as a browser's XML
 * parser resolves them. Only plain SVG drawing elements and presentation
 * attributes are allowed; every reference must be a local #id; CSS may use
 * only a few value functions, no at-rules and no escapes. This is the
 * authority; svgActiveContent is a fast first pass with clearer messages.
 */
const SVG_ALLOWLIST_PY = String.raw`
import json, re, sys
import xml.etree.ElementTree as ET
SVG = '{http://www.w3.org/2000/svg}'
XLINK_HREF = '{http://www.w3.org/1999/xlink}href'
XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'
ELEMENTS = set('svg g defs title desc rect circle ellipse line polyline polygon path text tspan marker '
               'linearGradient radialGradient stop pattern clipPath mask symbol use style filter '
               'feDropShadow feGaussianBlur feOffset feFlood feComposite feMerge feMergeNode feBlend feColorMatrix'.split())
ATTRS = set('id class style width height x y x1 x2 y1 y2 cx cy r rx ry d points dx dy viewBox '
            'preserveAspectRatio transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity '
            'stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity '
            'font-family font-size font-weight font-style letter-spacing text-anchor dominant-baseline '
            'alignment-baseline text-decoration marker-start marker-mid marker-end markerWidth markerHeight '
            'markerUnits refX refY orient offset stop-color stop-opacity gradientUnits gradientTransform '
            'fx fy patternUnits patternContentUnits patternTransform clip-path clipPathUnits mask maskUnits '
            'filter filterUnits primitiveUnits flood-color flood-opacity stdDeviation result in in2 mode '
            'operator k1 k2 k3 k4 type values href version visibility display'.split())
FUNCS = {'url', 'rgb', 'rgba', 'hsl', 'hsla', 'translate', 'rotate', 'scale', 'matrix', 'skewx', 'skewy'}
LOCAL_URL = re.compile(r"url\(\s*(['\"]?)#[A-Za-z_][\w.:-]*\1\s*\)")
problems = []
raw = sys.stdin.read()
if re.search(r'<!DOCTYPE|<!ENTITY', raw, re.I):
    problems.append('DOCTYPE/ENTITY declaration')
if any(m.group(1).lower() != 'xml' for m in re.finditer(r'<\?([^\s?>]*)', raw)):
    problems.append('processing instruction')
def css_ok(text, where):
    if '\\' in text:
        problems.append(f'CSS escape in {where}')
    # No string or comment stripping: any '@' fails, whatever surrounds it.
    if '@' in text and where == '<style>':
        problems.append('CSS at-rule in <style>')
    for m in re.finditer(r'([A-Za-z_-][\w-]*)\s*\(', text):
        if m.group(1).lower() not in FUNCS:
            problems.append(f'CSS function {m.group(1)}() in {where}')
    for m in re.finditer(r'url\s*\(', text, re.I):
        if not LOCAL_URL.match(text, m.start()):
            problems.append(f'non-local url() in {where}')
    if re.search(r'(?:[A-Za-z][\w+.-]*:)?//', text) and where == '<style>':
        problems.append('URL in <style>')
if not problems:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as err:
        root = None
        problems.append(f'not well-formed XML: {err}')
    if root is not None:
        if root.tag != SVG + 'svg':
            problems.append('root element is not <svg>')
        for el in root.iter():
            if not isinstance(el.tag, str) or not el.tag.startswith(SVG):
                problems.append(f'element outside the SVG namespace: {el.tag}')
                continue
            name = el.tag[len(SVG):]
            if name not in ELEMENTS:
                problems.append(f'element <{name}> is not allowed')
            if name == 'style':
                css_ok(''.join(el.itertext()), '<style>')
            for key, value in el.attrib.items():
                if key in (XLINK_HREF, 'href'):
                    if not value.strip().startswith('#'):
                        problems.append(f'non-local href on <{name}>')
                    continue
                if key == XML_SPACE:
                    continue
                if key not in ATTRS:
                    problems.append(f'attribute {key} on <{name}> is not allowed')
                    continue
                css_ok(value, f'{key}="..." on <{name}>')
print(json.dumps(sorted(set(problems))))
`;

function svgAllowlist(svg, python = findPython()) {
  if (!python) return { ran: false, problems: [] };
  const res = spawnSync(python.bin, [...python.prefix, '-I', '-c', SVG_ALLOWLIST_PY], {
    input: svg, encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  if (res.error || res.status !== 0) return { ran: true, problems: [`allowlist check failed to run: ${cleanMmdcError(res.stderr) || (res.error && res.error.message) || res.status}`] };
  try {
    return { ran: true, problems: JSON.parse(res.stdout) };
  } catch {
    return { ran: true, problems: ['allowlist check returned unreadable output'] };
  }
}

/** Decode CSS escapes: \72 or \000072 (optional trailing space) and \x for any other character. */
function decodeCssEscapes(text) {
  return String(text).replace(/\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|([^\r\n\f0-9a-f]))/gi, (whole, hex, ch) => {
    if (ch !== undefined) return ch;
    const code = Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
  });
}

/** Decode XML character and predefined entity references (&#x61; &#97; &amp; ...). */
function decodeXmlEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n' };
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1].toLowerCase() === 'x' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const key = ref.toLowerCase();
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : whole;
  });
}

function cmdTechGraph(args) {
  const { positional, opts } = parseArgs(args, [], ['png']);
  if (positional.length !== 3) throw usage(`tech-graph <template> <out.svg> <data.json> [--png]; templates: ${TECH_GRAPH_TEMPLATES.join(', ')}`);
  const [template, outSvg, dataFile] = positional;
  if (!TECH_GRAPH_TEMPLATES.includes(template)) throw usage(`unknown template "${template}"; use one of ${TECH_GRAPH_TEMPLATES.join(', ')}`);
  if (!outSvg.toLowerCase().endsWith('.svg')) throw usage('output must end with .svg');
  const dataAbs = path.resolve(dataFile);
  if (!fs.existsSync(dataAbs)) throw usage(`data file not found: ${dataFile}`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataAbs, 'utf8'));
  } catch (err) {
    out({ ok: false, stage: 'data', error: `invalid JSON: ${err.message}` });
    return 1;
  }
  const script = path.resolve(SKILL_DIR, '..', 'ak-tech-graph', 'scripts', 'generate-from-template.py');
  if (!fs.existsSync(script)) throw blocked('ak:tech-graph is not installed next to ak:diagram in this registry');
  const python = findPython();
  if (!python) throw blocked('Python 3 was not found on PATH; ak:tech-graph needs it');
  const outAbs = path.resolve(outSvg);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  // The generator prints non-ASCII status marks; a cp1252 Windows console would crash it.
  const pyEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  // JSON goes through stdin: large diagrams would exceed command-line length limits.
  fs.rmSync(outAbs, { force: true });
  const res = spawnSync(python.bin, [...python.prefix, script, template, outAbs], { encoding: 'utf8', timeout: TIMEOUT_MS, env: pyEnv, input: JSON.stringify(data) });
  if (res.error || res.status !== 0 || !fs.existsSync(outAbs)) {
    out({ ok: false, stage: 'generate', error: cleanMmdcError(res.stderr || res.stdout) || (res.error && res.error.message) || `exit ${res.status}` });
    return 1;
  }
  const svg = fs.readFileSync(outAbs, 'utf8');
  const steps = [{ step: 'generate', status: 'PASS' }];
  const wellFormed = /^\s*(<\?xml[^>]*>\s*)?<svg\b/.test(svg) && /<\/svg>\s*$/.test(svg);
  steps.push({ step: 'svg-shape', status: wellFormed ? 'PASS' : 'FAIL' });
  const active = svgActiveContent(svg);
  const allow = svgAllowlist(svg, python);
  for (const problem of allow.problems) if (!active.includes(problem)) active.push(problem);
  steps.push(active.length
    ? { step: 'svg-safety', status: 'FAIL', error: `active content in SVG: ${active.join(', ')}; remove markup from the data JSON` }
    : { step: 'svg-safety', status: 'PASS' });
  if (active.length) {
    // Never leave a script-bearing image where someone will open it.
    fs.rmSync(outAbs, { force: true });
    out({ ok: false, template, svg: null, steps });
    return 1;
  }
  const rsvg = onPath(['rsvg-convert']);
  let png = null;
  if (!rsvg) {
    steps.push({ step: 'rsvg-validate', status: 'NOT_RUN', reason: 'rsvg-convert not on PATH' });
    if (opts.png) steps.push({ step: 'png', status: 'NOT_RUN', reason: 'rsvg-convert not on PATH' });
  } else {
    const target = opts.png ? outAbs.replace(/\.svg$/i, '.png') : path.join(os.tmpdir(), `ak-diagram-${process.pid}.png`);
    const conv = spawnSync(rsvg, ['-w', '1920', outAbs, '-o', target], { encoding: 'utf8', timeout: TIMEOUT_MS });
    const passed = conv.status === 0 && fs.existsSync(target);
    steps.push({ step: 'rsvg-validate', status: passed ? 'PASS' : 'FAIL', error: passed ? undefined : cleanMmdcError(conv.stderr) });
    if (opts.png) steps.push({ step: 'png', status: passed ? 'PASS' : 'FAIL' });
    if (opts.png && passed) png = display(target);
    if (!opts.png) fs.rmSync(target, { force: true });
  }
  const ok = steps.every((s) => s.status !== 'FAIL');
  out({ ok, template, svg: display(outAbs), png, bytes: Buffer.byteLength(svg), steps });
  return ok ? 0 : 1;
}

const COMMANDS = {
  doctor: cmdDoctor,
  route: cmdRoute,
  paths: cmdPaths,
  lint: cmdLint,
  render: cmdRender,
  scan: cmdScan,
  archify: cmdArchify,
  'tech-graph': cmdTechGraph,
};

function main(argv) {
  const [command, ...rest] = argv;
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`usage: node ak-diagram.cjs <${Object.keys(COMMANDS).join('|')}> ...\n`);
    return 2;
  }
  try {
    return fn(rest);
  } catch (err) {
    const code = err.exitCode || 1;
    out({ ok: false, status: code === 3 ? 'BLOCKED' : code === 2 ? 'USAGE' : 'ERROR', error: err.message, ...(err.extra || {}) });
    return code;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  fold,
  slugify,
  compareVersions,
  nodeVersionOk,
  route,
  diagramPaths,
  extractMermaidBlocks,
  headerOf,
  lintMermaid,
  parseArgs,
  mmdcVersion,
  resolveMmdc,
  browserCandidates,
  archifyCandidates,
  archifyVersion,
  resolveArchify,
  scanTree,
  outputNames,
  svgActiveContent,
  svgAllowlist,
  DEFAULT_MMDC_VERSION,
  ARCHIFY_MIN_VERSION,
  ARCHIFY_TYPES,
  TECH_GRAPH_TEMPLATES,
  MERMAID_TYPES,
};
