const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.resolve(root, '../contracts/assistant-link-policy-cases.json'), 'utf8'));
const router = { push() {} };
const messages = { assistant: { technicalBlocked: 'Blocked' } };

function transpile(filename, aliases = {}) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const record = { exports: {} };
  const resolve = (name) => {
    if (Object.prototype.hasOwnProperty.call(aliases, name)) return aliases[name];
    return require(name);
  };
  Function('require', 'module', 'exports', output)(resolve, record, record.exports);
  return record.exports;
}

const policy = transpile(path.join(root, 'src/lib/assistant-link-policy.ts'));
const regex = transpile(path.join(root, 'src/lib/assistant-inline-markdown-regex.ts'));
const component = transpile(path.join(root, 'src/components/assistant/AssistantMarkdownContent.tsx'), {
  'next/navigation': { useRouter: () => router },
  '@/i18n': { useI18n: () => ({ href: (value) => value, locale: 'en', messages }) },
  '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  '@/lib/assistant-output-guard': {
    sanitizeAssistantOutput: (value) => value,
  },
  '@/lib/assistant-inline-markdown-regex': regex,
  '@/lib/assistant-link-policy': policy,
});

function render(content, streaming = false) {
  return renderToStaticMarkup(React.createElement(component.AssistantMarkdownContent, { content, streaming }));
}

test('shared conformance fixture is enforced by the frontend policy', () => {
  assert.deepEqual([...policy.ASSISTANT_ALLOWED_DASHBOARD_ROUTES], fixture.dashboardRoutes);
  for (const item of fixture.cases) {
    assert.equal(policy.resolveAssistantLinkDestination(item.destination) !== null, item.allowed, item.name);
  }
});

test('denied Markdown destinations become plain labels and preserve surrounding prose', () => {
  const html = render('Before [document](/docs/academic-regulations) and [schedule](/dashboard/schedule), but [outside](https://example.edu/x) and [script](javascript:alert(1)) stay text.');
  assert.match(html, /href="\/docs\/academic-regulations"/);
  assert.match(html, /href="\/dashboard\/schedule"/);
  assert.doesNotMatch(html, /href="https:\/\//i);
  assert.doesNotMatch(html, /href="javascript:/i);
  for (const phrase of ['Before', 'document', 'and', 'schedule', 'but', 'outside', 'script', 'stay text.']) {
    assert.ok(html.includes(phrase), `missing surrounding text: ${phrase}`);
  }
});

test('direct route strings link only when the complete route is allowlisted', () => {
  const safe = render('Open /docs/academic-regulations and /dashboard/schedule.');
  assert.match(safe, /href="\/docs\/academic-regulations"/);
  assert.match(safe, /href="\/dashboard\/schedule"/);
  const denied = render('Keep /dashboard/profile and /dashboard%2Fschedule as text.');
  assert.doesNotMatch(denied, /href="\/dashboard\/profile"/);
  assert.doesNotMatch(denied, /href="\/dashboard"/);
  assert.ok(denied.includes('/dashboard/profile'));
  assert.ok(denied.includes('/dashboard%2Fschedule'));
});

test('every SSE split boundary keeps an external Markdown destination unclickable', () => {
  const answer = 'Before [outside](https://xn--e1afmkfd.example/docs/policy) after.';
  let accumulated = '';
  for (const character of answer) {
    accumulated += character;
    assert.doesNotMatch(render(accumulated, true), /href="https:\/\//i);
  }
  const final = render(accumulated);
  assert.doesNotMatch(final, /href=/);
  assert.ok(final.includes('Before'));
  assert.ok(final.includes('outside'));
  assert.ok(final.includes('after.'));
});

test('every SSE split boundary keeps an allowed document destination internal', () => {
  const answer = 'Before [document](/docs/academic-regulations?rev=2) after.';
  let accumulated = '';
  for (const character of answer) {
    accumulated += character;
    assert.doesNotMatch(render(accumulated, true), /href="https:\/\//i);
  }
  const final = render(accumulated);
  assert.match(final, /href="\/docs\/academic-regulations\?rev=2"/);
});
