const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { loadTs } = require('./dashboard-shell-harness');

const root = path.resolve(__dirname, '..');
const pagePath = 'src/app/admin/assistant-knowledge/page.tsx';
const pageSource = fs.readFileSync(path.join(root, pagePath), 'utf8');
const ops = loadTs('src/i18n/messages-admin-ops.ts', {}, { cache: false });
const en = ops.adminOpsEn.assistantKnowledge;
const vi = ops.adminOpsVi.assistantKnowledge;

const documentSnapshot = {
  documentId: 'doc-1',
  revisionId: 'rev-1',
  version: 7,
  state: 'DRAFT',
  locale: 'both',
  slug: 'registration-window',
  title: 'Registration window',
  content: 'Registration opens on the published date.',
  source: 'CampusUTE academic policy',
  domain: 'GENERAL_FAQ',
  priority: 100,
};

function extractDeclaration(relativePath, name, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === name) declaration = node;
    ts.forEachChild(node, visit);
  }

  visit(tree);
  assert.ok(declaration, `${relativePath} contains ${name}`);
  const snippet = ts.isVariableDeclaration(declaration)
    ? `const ${declaration.getText(tree)};`
    : declaration.getText(tree).replace(/^export\s+/, '');
  const output = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return Function(...Object.keys(dependencies), `${output}\nreturn ${name};`)(
    ...Object.values(dependencies),
  );
}

function loadActionError() {
  return extractDeclaration(pagePath, 'actionError', {
    adminOpsEn: ops.adminOpsEn,
    adminOpsVi: ops.adminOpsVi,
    isStaleVersionError: extractDeclaration(pagePath, 'isStaleVersionError'),
  });
}

function loadSave(overrides = {}) {
  const calls = {
    update: [],
    create: [],
    editing: [],
    formError: '',
    formOpen: true,
    notice: '',
    loads: 0,
  };
  const editing = Object.hasOwn(overrides, 'editing') ? overrides.editing : documentSnapshot;
  const form = overrides.form ?? documentSnapshot;
  const save = extractDeclaration(pagePath, 'save', {
    form,
    editing,
    opsUi: en.ui,
    setIsSaving() {},
    setFormError(value) {
      calls.formError = value;
    },
    setFormOpen(value) {
      calls.formOpen = value;
    },
    setNotice(value) {
      calls.notice = value;
    },
    setEditing(value) {
      calls.editing.push(value);
    },
    assistantKnowledgeApi: {
      async update(documentId, request) {
        calls.update.push({ documentId, request });
        if (overrides.updateError) throw overrides.updateError;
        return { documentId, revisionId: 'rev-2', version: 8, state: 'DRAFT' };
      },
      async create(request) {
        calls.create.push(request);
        return { documentId: 'doc-2', revisionId: 'rev-new', version: 1, state: 'DRAFT' };
      },
    },
    actionError: loadActionError(),
    locale: 'en',
    isStaleVersionError: extractDeclaration(pagePath, 'isStaleVersionError'),
    async load() {
      calls.loads += 1;
    },
  });
  return { save, calls, editing, form };
}

test('a stale version conflict maps to the stale-record copy in both locales', () => {
  const actionError = loadActionError();
  const stale = { response: { status: 409, data: { code: 'STALE_VERSION' } } };

  assert.equal(actionError(stale, 'en'), en.staleVersion);
  assert.equal(actionError(stale, 'vi'), vi.staleVersion);
  assert.equal(
    actionError({ response: { status: 409, data: { code: 'KNOWLEDGE_SECOND_REVIEW_REQUIRED' } } }, 'en'),
    en.errorSecondReview,
  );
  assert.match(en.staleVersion, /changed after you opened it/i);
  assert.match(vi.staleVersion, /thay đổi sau khi bạn mở/i);
});

test('assistant knowledge update sends the revision currently being edited', async () => {
  const { save, calls } = loadSave();

  await save();

  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].documentId, 'doc-1');
  assert.equal(calls.update[0].request.expectedVersion, 7);
  assert.equal(calls.update[0].request.title, documentSnapshot.title);
});

test('a successful update refreshes the editing revision from the response', async () => {
  const { save, calls, editing } = loadSave();

  await save();

  assert.equal(calls.editing.length, 1);
  assert.equal(typeof calls.editing[0], 'function');
  assert.equal(calls.editing[0](editing).version, 8);
  assert.equal(calls.formOpen, false);
  assert.equal(calls.notice, en.ui.draftSaved);
  assert.equal(calls.loads, 1);
});

test('a STALE_VERSION save shows the stale message and keeps the typed form content', async () => {
  const typed = { ...documentSnapshot, title: 'Edited in this tab' };
  const conflict = { response: { status: 409, data: { code: 'STALE_VERSION' } } };
  const { save, calls, form } = loadSave({ form: typed, updateError: conflict });

  await save();

  assert.equal(calls.update[0].request.expectedVersion, 7);
  assert.equal(calls.update[0].request.title, 'Edited in this tab');
  assert.equal(calls.formError, en.staleVersion);
  assert.equal(form.title, 'Edited in this tab');
  assert.equal(calls.formOpen, true);
  assert.equal(calls.loads, 1);
});

test('assistant knowledge create does not send an expected version', async () => {
  const { save, calls } = loadSave({ editing: null });

  await save();

  assert.equal(calls.update.length, 0);
  assert.equal(calls.create.length, 1);
  assert.equal(Object.hasOwn(calls.create[0], 'expectedVersion'), false);
});

test('the admin request type exposes expectedVersion as an optional field', () => {
  const apiSource = fs.readFileSync(path.join(root, 'src/lib/thesis-api.ts'), 'utf8');
  const requestBlock = apiSource.match(
    /export interface AssistantKnowledgeRequest \{([\s\S]*?)\n\}/,
  );
  assert.ok(requestBlock, 'AssistantKnowledgeRequest is declared');
  assert.match(requestBlock[1], /expectedVersion\?: number;/);
  assert.match(pageSource, /expectedVersion: editing\.version/);
});
