const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('both authenticated shells use the on-demand assistant boundary', () => {
  for (const file of ['src/components/admin/AdminFrame.tsx', 'src/app/dashboard/layout.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /from ['"]@\/components\/assistant\/AssistantPanel['"]/);
    assert.match(source, /from ['"]@\/components\/assistant\/lazy-assistant-panel['"]/);
    assert.match(source, /<AssistantPanel \/>/);
  }
});

test('the assistant loads only on intent and replays after its listener is ready', () => {
  const source = read('src/components/assistant/lazy-assistant-panel.tsx');
  assert.match(source, /dynamic\(/);
  assert.match(source, /import\('\.\/AssistantPanel'\)/);
  assert.match(source, /ssr: false/);
  assert.match(source, /requested \? <DynamicAssistantPanel onReady=\{handleReady\} \/> : null/);
  assert.match(source, /pendingOpen\.current =/);
  assert.match(source, /document\.activeElement/);
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\('open-campus-assistant'/);
  assert.match(source, /window\.removeEventListener\('open-campus-assistant', handleOpen\)/);
  const panel = read('src/components/assistant/AssistantPanel.tsx');
  assert.ok(panel.indexOf("window.addEventListener('open-campus-assistant'") < panel.indexOf('onReady?.()'));
  assert.match(panel, /detail\?\.trigger \?\? document\.activeElement/);
});

test('the pre-load launcher keeps the same accessible name and visual classes', () => {
  const source = read('src/components/assistant/lazy-assistant-panel.tsx');
  const panel = read('src/components/assistant/AssistantPanel.tsx');
  assert.match(source, /aria-label=\{messages\.assistant\.open\}/);
  assert.match(source, /type="button"/);
  for (const classes of ['group relative flex h-14 w-14', 'absolute -right-0.5 -top-0.5']) {
    const className = new RegExp(`className="(${classes}[^\"]*)"`);
    assert.equal(source.match(className)?.[1], panel.match(className)?.[1]);
  }
  for (const route of ['/admin', '/dashboard/assistant-specialized', '/dashboard/register']) {
    assert.ok(source.includes(route));
  }
});

test('private builds opt into NEXT_DIST_DIR while the default remains .next', async () => {
  const config = await import(pathToFileURL(path.join(root, 'next.config.mjs')).href);
  assert.equal(config.default.distDir, process.env.NEXT_DIST_DIR || '.next');
  assert.match(read('next.config.mjs'), /distDir: process\.env\.NEXT_DIST_DIR \|\| '\.next'/);
});

test('a delayed assistant activation retains the latest scope and original trigger exactly once', () => {
  const slots = [];
  const cleanups = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); }
    },
    useCallback: (callback) => callback,
  };
  const output = ts.transpileModule(read('src/components/assistant/lazy-assistant-panel.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} };
  const dynamicPanel = () => null;
  const dependencies = (name) => {
    if (name === 'react') return hooks;
    if (name === 'next/dynamic') return () => dynamicPanel;
    if (name === 'next/navigation') return { usePathname: () => '/admin' };
    if (name === '@/i18n') return { useI18n: () => ({ messages: { assistant: { open: 'Open assistant' } } }) };
    if (name === '@/i18n/paths') return { stripLocaleFromPathname: pathname => ({ pathname }) };
    if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (name === './AssistantMascot') return { AssistantMascot: () => null };
    return require(name);
  };
  Function('require', 'module', 'exports', output)(dependencies, record, record.exports);
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = new EventTarget();
  const firstTrigger = { id: 'header-button' };
  const lastTrigger = { id: 'specialized-button' };
  global.document = { activeElement: firstTrigger };
  const render = () => { cursor = 0; return record.exports.LazyAssistantPanel(); };
  try {
    assert.equal(render().props.children[0], null, 'closed panel is not mounted');
    window.dispatchEvent(new CustomEvent('open-campus-assistant'));
    const loading = render().props.children[0];
    assert.equal(loading.type, dynamicPanel);
    document.activeElement = lastTrigger;
    window.dispatchEvent(new CustomEvent('open-campus-assistant', { detail: { mode: 'specialized' } }));
    document.activeElement = { id: 'moved-while-loading' };
    const replayed = [];
    window.addEventListener('open-campus-assistant', event => replayed.push(event.detail));
    loading.props.onReady();
    loading.props.onReady(); // Strict Mode / repeated readiness cannot reopen the panel.
    assert.equal(replayed.length, 1);
    assert.deepEqual(replayed[0], { mode: 'specialized', trigger: lastTrigger });
    window.dispatchEvent(new CustomEvent('open-campus-assistant', { detail: { mode: 'academic' } }));
    assert.equal(replayed.length, 2, 'later activations pass through without a second replay');
    assert.deepEqual(replayed[1], { mode: 'academic' });
    assert.equal(render().props.children[1], null, 'pre-load launcher is removed after readiness');
    for (const cleanup of cleanups) cleanup?.();
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});
