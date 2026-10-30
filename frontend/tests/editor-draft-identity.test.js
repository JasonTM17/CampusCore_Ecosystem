const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const pagePath = 'src/app/dashboard/editor/page.tsx';
const tinyPath = 'src/components/ui/tinymce-editor.tsx';
const A = { user: { id: 'admin-a', roles: ['ADMIN'] }, hasAccess: true, isLoading: false, isForbidden: false };
const B = { ...A, user: { id: 'admin-b', roles: ['ADMIN'] } };
const draftKey = id => `campuscore_editor_document:${encodeURIComponent(id)}`;
const engineKey = id => `campuscore_editor_engine:${encodeURIComponent(id)}`;
const draft = (title, extra = {}) => JSON.stringify({ title, content: `<p>${title}</p>`, category: 'notice', ...extra });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(done => setImmediate(done));

// Execute the real TSX and callbacks. Only dependencies/host UI are stubbed;
// keyed component instances, effect dependencies and unmount cleanup are retained.
function createStudio(entries = new Map(), search = '') {
  let auth = A;
  let active;
  let tree;
  let dirty;
  const instances = new Map();
  const effects = [];
  const reads = [];
  const writes = [];
  const updates = [];
  const requests = [];
  const storage = {
    getItem(key) { reads.push(key); return entries.get(key) ?? null; },
    setItem(key, value) { writes.push(key); entries.set(key, value); },
    removeItem(key) { entries.delete(key); },
    key(index) { return [...entries.keys()][index] ?? null; },
    get length() { return entries.size; },
  };
  const windowMock = { location: { pathname: '/vi/dashboard/editor', search }, localStorage: storage };
  const react = {
    useState(initial) {
      const instance = active;
      const index = instance.cursor++;
      if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [instance.slots[index], next => {
        if (!instance.mounted) return;
        instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next;
        dirty = true;
      }];
    },
    useRef(initial) {
      const index = active.cursor++;
      return active.slots[index] ??= { current: initial };
    },
    useMemo(factory, deps) {
      const index = active.cursor++;
      const old = active.slots[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) active.slots[index] = { deps, value: factory() };
      return active.slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const instance = active;
      const index = instance.cursor++;
      const old = instance.slots[index];
      if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        const slot = { deps, cleanup: old?.cleanup };
        instance.slots[index] = slot;
        effects.push(() => {
          if (!instance.mounted) return;
          slot.cleanup?.();
          slot.cleanup = fn();
        });
      }
    },
    useId: () => 'stable-editor',
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const blocks = ['header', 'recipient', 'summary', 'table', 'clauses', 'notice', 'signoff'];
  const messages = { editor: { blocks: Object.fromEntries(blocks.map(key => [key, { title: key, description: key }])),
    seedTitleVi: 'Seed', seedTitleEn: 'Seed', saveChanges: 'Save changes', saving: 'Saving',
    publishing: 'Publishing', publishChanges: 'Publish changes', editingBanner: 'Editing {title}',
    priorityOptions: {}, targetOptions: {}, targetRoleOptions: {}, categoryOptions: {}, cancelEdit: 'Cancel edit' } };
  const appearance = { hero: { vi: {}, en: {} }, postOrder: [], accent: 'ute-yellow' };
  const modules = new Map();
  const guard = { requestLeave: fn => fn(), confirmLeave() {}, cancelLeave() {} };
  const api = {
    getAll: async () => ({ data: [] }),
    getById: id => { const request = deferred(); requests.push({ id, ...request }); return request.promise; },
    create: async payload => { updates.push({ payload }); },
    update: async (id, payload) => { updates.push({ id, payload }); return payload; },
  };
  const stubs = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/context/AuthContext': { useRequireAuth: () => auth },
    '@/i18n': { useI18n: () => ({ locale: 'vi', formatDate: String, messages }) },
    '@/i18n/messages': { getMessages: () => messages },
    '@/lib/use-unsaved-changes-guard': { useUnsavedChangesGuard: () => guard },
    '@/lib/site-appearance': { DEFAULT_SITE_APPEARANCE: appearance, SITE_APPEARANCE_ACCENTS: [] },
    '@/lib/site-appearance-client': { fetchSiteAppearance: async () => appearance },
    '@/lib/announcement-limits': { findAnnouncementLengthViolation: () => null },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/components/announcements/AnnouncementEditModal': { EDIT_BANNER_PRESETS: [], AnnouncementEditModal: 'AnnouncementEditModal' },
    sonner: { toast: { success() {}, error() {}, info() {} } },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const record = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    function requireStub(spec) {
      if (stubs[spec]) return stubs[spec];
      if (spec === '@/lib/editor-document' || spec === '@/lib/editor-templates') return load(`${spec.replace('@/', 'src/')}.ts`);
      if (spec === '@/lib/api') return new Proxy({ announcementsApi: api }, { get: (target, key) => target[key] ?? api });
      if (spec === '@/components/ui/tinymce-editor') return { TinyMceEditor: 'TinyMceEditor', clearTinyMceAutosaveDrafts: load(tinyPath).clearTinyMceAutosaveDrafts };
      return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : String(key) });
    }
    Function('require', 'module', 'exports', 'window', 'localStorage', 'setTimeout', output)(requireStub, record, record.exports, windowMock, storage, () => 0);
    modules.set(file, record.exports);
    return record.exports;
  }
  const Page = load(pagePath).default;
  function render(nextAuth = auth, flush = true) {
    auth = nextAuth;
    const seen = new Set();
    function visit(node, position) {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map((child, index) => visit(child, `${position}/${index}`));
      if (typeof node.type === 'function') {
        const identity = `${position}/${node.type.name}/${node.key ?? ''}`;
        seen.add(identity);
        let instance = instances.get(identity);
        if (!instance) {
          instance = { cursor: 0, slots: [], mounted: true };
          instances.set(identity, instance);
        }
        instance.cursor = 0;
        active = instance;
        return visit(node.type(node.props), identity);
      }
      return { ...node, props: { ...node.props, children: visit(node.props?.children, `${position}/children`) } };
    }
    dirty = false;
    tree = visit(jsx(Page, {}), 'root');
    for (const [identity, instance] of instances) {
      if (!seen.has(identity)) {
        instance.mounted = false;
        instance.slots.forEach(slot => slot?.cleanup?.());
        instances.delete(identity);
      }
    }
    if (flush) {
      effects.splice(0).forEach(effect => effect());
      if (dirty) render(auth);
    }
    return tree;
  }
  function find(predicate, node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => find(predicate, child ?? null));
    if (!node || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...find(predicate, node.props?.children ?? null)];
  }
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
  const button = label => {
    const match = find(node => node.type === 'Button' && text(node).includes(label));
    assert.equal(match.length, 1, `one button labelled ${label}`);
    return match[0].props.onClick;
  };
  const editor = () => find(node => node.type === 'TinyMceEditor')[0];
  const title = () => find(node => node.type === 'Input' && node.props.placeholder === 'Nhập tiêu đề thông báo học vụ...')[0];
  return { render, button, editor, title, entries, reads, writes, updates, requests, load, windowMock };
}

test('draft save/logout/another administrator open never restores the previous author or edit context', () => {
  const studio = createStudio(new Map([[draftKey('admin-a'), draft('Private A', { editingId: 'notice-a', editingVersion: 7 })]]));
  studio.render(A);
  assert.equal(studio.title().props.value, 'Private A');
  studio.button('Lưu nháp')();
  studio.render({ user: null, hasAccess: false, isLoading: false, isForbidden: false });
  studio.render(B);
  assert.notEqual(studio.title().props.value, 'Private A');
  studio.button('Lưu nháp')();
  const saved = JSON.parse(studio.entries.get(draftKey('admin-b')));
  assert.equal(saved.editingId, null);
  assert.equal(saved.editingVersion, 0);
});

test('same mounted route switches owners before deferred hydration and delayed save retains its owner', () => {
  const studio = createStudio(new Map([[draftKey('admin-a'), draft('Private A')], [draftKey('admin-b'), draft('Private B')]]));
  studio.render(A);
  const delayedSave = studio.button('Lưu nháp');
  studio.render(B, false);
  assert.notEqual(studio.title().props.value, 'Private A', 'A must disappear before passive hydration runs');
  delayedSave();
  assert.equal(JSON.parse(studio.entries.get(draftKey('admin-b'))).title, 'Private B');
  studio.render(B);
  assert.equal(studio.title().props.value, 'Private B');
  studio.render(A);
  assert.equal(studio.title().props.value, 'Private A');
});

test('unresolved, missing-ID and unauthorized identities cannot read or save a draft', () => {
  for (const auth of [
    { ...A, isLoading: true, hasAccess: false },
    { ...A, user: { roles: ['ADMIN'] } },
    { ...A, hasAccess: false, isForbidden: true },
    { ...A, user: null, hasAccess: false },
  ]) {
    const studio = createStudio(new Map([['campuscore_editor_document', draft('Unattributed')]]));
    studio.render(auth);
    assert.deepEqual(studio.reads, [], 'no persistence before authorized identity resolves');
    assert.equal(studio.editor(), undefined);
  }
});

test('unattributed legacy drafts and engine choices remain quarantined, never adopted or deleted', () => {
  const legacy = draft('Unattributed', { editingId: 'legacy-notice', editingVersion: 8 });
  const studio = createStudio(new Map([['campuscore_editor_document', legacy], ['campuscore_editor_engine', 'markdown']]));
  studio.render(B);
  assert.notEqual(studio.title().props.value, 'Unattributed');
  assert.ok(studio.editor(), 'unattributed engine is ignored');
  studio.button('Lưu nháp')();
  assert.equal(studio.entries.get('campuscore_editor_document'), legacy);
  assert.equal(JSON.parse(studio.entries.get(draftKey('admin-b'))).editingId, null);
});

for (const action of ['Tạo mới', 'Đăng lên Bảng tin Học vụ', 'Save changes']) {
  test(`${action} clears only the current owner's draft and TinyMCE recovery keys`, async () => {
    const studio = createStudio(new Map([
      [draftKey('admin-a'), draft('A', action === 'Save changes' ? { editingId: 'notice-a', editingVersion: 7 } : {})],
      [draftKey('admin-b'), draft('B')],
      ['campuscore_editor_document', draft('Legacy')],
      [engineKey('admin-b'), 'markdown'],
    ]));
    studio.render(A);
    const tinyProps = studio.editor().props;
    // Match the actual TinyMCE ID expression, including owner encoding.
    const source = fs.readFileSync(path.join(root, tinyPath), 'utf8');
    const ast = ts.createSourceFile('tiny.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TinyMceEditor');
    const idDeclaration = component.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(ast) === 'editorId'));
    const output = ts.transpileModule(idDeclaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const editorId = Function('id', 'generatedId', 'draftOwnerId', `${output}; return editorId;`)(tinyProps.id, 'test-id', tinyProps.draftOwnerId);
    tinyProps.onInit(null, { id: editorId });
    const prefix = `campuscore-tinymce-/vi/dashboard/editor-${editorId}-`;
    studio.entries.set(`${prefix}draft`, 'A recovery');
    studio.entries.set(`${prefix}time`, '123');
    studio.entries.set('campuscore-tinymce-/vi/dashboard/editor-studio-owner-admin-b-draft', 'B recovery');
    const preserved = new Map([...studio.entries].filter(([key]) => key !== draftKey('admin-a') && !key.startsWith(prefix)));
    await studio.button(action)();
    assert.equal(studio.entries.has(draftKey('admin-a')), false);
    assert.equal(studio.entries.has(`${prefix}draft`), false);
    assert.equal(studio.entries.has(`${prefix}time`), false);
    for (const [key, value] of preserved) assert.equal(studio.entries.get(key), value, `${key} preserved`);
  });
}

test('deferred announcement hydration from an unmounted owner cannot replace the new owner draft', async () => {
  const studio = createStudio(new Map([[draftKey('admin-b'), draft('Private B')]]), '?editId=notice-a');
  studio.render(A);
  assert.equal(studio.requests.length, 1);
  studio.render(B, false);
  studio.requests[0].resolve({ id: 'notice-a', title: 'A response', content: '<p>A response</p>', version: 4 });
  await settle();
  studio.render(B);
  assert.equal(studio.title().props.value, 'Private B');
});
