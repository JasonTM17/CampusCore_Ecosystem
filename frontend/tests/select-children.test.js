const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(relativePath) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} };
  const resolve = name => name === '@/lib/utils' ? load('src/lib/utils.ts') : require(name);
  Function('module', 'exports', 'require', output)(record, record.exports, resolve);
  return record.exports;
}

const { Select } = load('src/components/ui/select.tsx');
const option = (value, label) => React.createElement('option', { value, key: value }, label);
const render = props => renderToStaticMarkup(React.createElement(Select, props));

test('Select renders native option children and the controlled selected value', () => {
  const html = render({ id: 'section', label: 'Class section', value: 'audit', onChange() {},
    children: [option('demo', 'Demo class'), option('audit', 'Audit class')] });
  assert.match(html, /<option value="demo">Demo class<\/option>/);
  assert.match(html, /<option value="audit" selected="">Audit class<\/option>/);
  assert.match(html, /<label for="section"/);
});

test('Select preserves groups and options precedence over native children', () => {
  const props = { children: option('child', 'Native child'),
    options: [{ value: 'array', label: 'Array option' }] };
  const array = render(props);
  assert.match(array, /Array option/);
  assert.doesNotMatch(array, /Native child/);
  const grouped = render({ ...props, groups: [{ label: 'Semester', options: [{ value: 'group', label: 'Grouped option' }] }] });
  assert.match(grouped, /<optgroup label="Semester"><option value="group">Grouped option/);
  assert.doesNotMatch(grouped, /Array option|Native child/);
});

test('Select explicit empty groups or options remain empty', () => {
  assert.doesNotMatch(render({ options: [], children: option('child', 'Native child') }), /<option/);
  assert.doesNotMatch(render({ groups: [], options: [{ value: 'array', label: 'Array option' }],
    children: option('child', 'Native child') }), /<option/);
});

function loadWithStubs(relativePath, stubs = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} };
  const resolve = name => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    return name === '@/lib/utils' ? load('src/lib/utils.ts') : require(name);
  };
  Function('module', 'exports', 'require', output)(record, record.exports, resolve);
  return record.exports;
}

function describedByIds(html) {
  const value = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  return value ? value.split(/\s+/).filter(Boolean) : [];
}

test('W14 Textarea mirrors Input: error and hint text is linked to the control', () => {
  const { Textarea } = load('src/components/ui/textarea.tsx');

  const errorHtml = renderToStaticMarkup(React.createElement(Textarea, {
    id: 'bio',
    error: 'Too short',
  }));
  assert.match(errorHtml, /aria-invalid="true"/, 'a failing textarea must be announced as invalid');
  const errorIds = describedByIds(errorHtml);
  assert.equal(errorIds.length, 1, `expected one describedby id, got ${errorIds.join(',')}`);
  assert.match(errorHtml, new RegExp(`<p id="${errorIds[0]}"[^>]*>Too short</p>`));

  const hintHtml = renderToStaticMarkup(React.createElement(Textarea, {
    id: 'bio',
    hint: 'Up to 500 characters',
  }));
  assert.doesNotMatch(hintHtml, /aria-invalid/, 'a valid textarea must not claim invalid state');
  const hintIds = describedByIds(hintHtml);
  assert.equal(hintIds.length, 1, `expected one describedby id, got ${hintIds.join(',')}`);
  assert.match(hintHtml, new RegExp(`<p id="${hintIds[0]}"[^>]*>Up to 500 characters</p>`));

  const externalHtml = renderToStaticMarkup(React.createElement(Textarea, {
    'aria-describedby': 'outside-help',
    hint: 'Hint',
  }));
  const externalIds = describedByIds(externalHtml);
  assert.equal(externalIds[0], 'outside-help', 'caller-provided descriptions stay first');
  assert.equal(externalIds.length, 2);
});

test('W14 AdminFormField links its error and description to the cloned control', () => {
  const dummy = function DummyComponent() {
    return null;
  };
  const { AdminFormField } = loadWithStubs('src/components/admin/AdminSurface.tsx', {
    '@/components/ui/card': {
      Card: dummy,
      CardContent: dummy,
      CardDescription: dummy,
      CardHeader: dummy,
      CardTitle: dummy,
    },
    '@/components/ui/button': { Button: dummy },
    '@/i18n': { useI18n: () => ({ locale: 'en' }) },
    '@/components/LocalizedLink': { LocalizedLink: dummy },
    'lucide-react': new Proxy({}, { get: () => dummy }),
  });

  const html = renderToStaticMarkup(React.createElement(AdminFormField, {
    label: 'Title',
    description: 'Shown to students',
    error: 'Required',
  }, React.createElement('input', { id: 'title' })));

  assert.match(html, /id="title"/);
  assert.match(html, /aria-invalid="true"/, 'the labelled control must be announced as invalid');
  const ids = describedByIds(html);
  assert.equal(ids.length, 2, `expected error and description ids, got ${ids.join(',')}`);
  const [errorId, descriptionId] = ids;
  assert.match(html, new RegExp(`<p id="${errorId}"[^>]*role="alert"[^>]*>Required</p>`));
  assert.match(html, new RegExp(`<p id="${descriptionId}"[^>]*>Shown to students</p>`));

  const validHtml = renderToStaticMarkup(React.createElement(AdminFormField, {
    label: 'Title',
    description: 'Shown to students',
  }, React.createElement('input', { id: 'title' })));
  assert.doesNotMatch(validHtml, /aria-invalid/, 'a valid field must not claim invalid state');
  assert.equal(describedByIds(validHtml).length, 1);
});
