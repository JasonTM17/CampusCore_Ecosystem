const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

// WEB-10: a fault anywhere under /dashboard or /admin used to bubble to the
// root error boundary and unmount the whole shell — sidebar, header, and the
// notification bell all vanished behind one error. Segment-level boundaries
// now render a localized retry inside the still-mounted layout, on both the
// canonical tree and the [locale] tree that serves /vi|en URLs.

const BOUNDARY_FILES = [
  'src/app/dashboard/error.tsx',
  'src/app/admin/error.tsx',
  'src/app/[locale]/dashboard/error.tsx',
  'src/app/[locale]/admin/error.tsx',
];

test('every routed dashboard/admin tree gets the segment boundary', () => {
  for (const file of BOUNDARY_FILES) {
    const source = read(file);
    assert.match(source, /export \{ default \} from '@\/components\/ui\/section-error';/,
      `${file} must mount the shared boundary`);
    assert.match(source, /'use client'/, `${file} must stay a client module`);
  }
  // The [locale] trees re-export the canonical layouts, so colocating the
  // boundary with them is what keeps the shell mounted under /vi|en URLs.
  assert.match(read('src/app/[locale]/dashboard/layout.tsx'),
    /export \{ default \} from '\.\.\/\.\.\/dashboard\/layout';/);
});

test('the shared boundary is a client component that retries via reset() and localizes copy', () => {
  const ts = require('typescript');
  const source = read('src/components/ui/section-error.tsx');
  assert.match(source, /'use client'/);

  const rendered = [];
  const effectCalls = [];
  const fakeRequire = (id) => {
    if (id === 'react') return { useEffect: (cb) => effectCalls.push(cb) };
    if (id === 'react/jsx-runtime') {
      return { jsx: (type, props) => rendered.push({ type, props }) };
    }
    if (id === '@/components/ui/state-block') {
      return { ErrorState: function ErrorState(props) { return props; } };
    }
    if (id === '@/i18n') {
      return {
        useI18n: () => ({
          messages: { common: { states: { sectionErrorTitle: 'T', sectionErrorDescription: 'D' } } },
        }),
      };
    }
    throw new Error(`unexpected import ${id}`);
  };
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, fakeRequire);

  const reset = () => {};
  moduleRecord.exports.default({ error: new Error('boom'), reset });
  assert.equal(rendered.length, 1, 'renders exactly one state block');
  assert.equal(rendered[0].props.title, 'T', 'title comes from the i18n catalog');
  assert.equal(rendered[0].props.description, 'D', 'description comes from the i18n catalog');
  assert.equal(rendered[0].props.onRetry, reset,
    'the retry button must invoke Next.js reset(), which re-renders the segment');
  assert.equal(effectCalls.length, 1, 'the error is logged once per failure');
});

test('the localized section-error strings exist in both catalogs', () => {
  const messages = read('src/i18n/messages.ts');
  const en = messages.slice(messages.indexOf('export const en'), messages.indexOf('export const vi'));
  const vi = messages.slice(messages.indexOf('export const vi'));
  for (const block of [en, vi]) {
    assert.match(block, /sectionErrorTitle:/, 'sectionErrorTitle');
    assert.match(block, /sectionErrorDescription:/, 'sectionErrorDescription');
  }
});
