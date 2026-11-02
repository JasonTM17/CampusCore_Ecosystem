const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTs(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier];
    if (specifier.startsWith('@/')) {
      const base = `src/${specifier.slice(2)}`;
      const candidate = fs.existsSync(path.join(root, `${base}.tsx`)) ? `${base}.tsx` : `${base}.ts`;
      return loadTs(candidate, stubs);
    }
    return require(specifier);
  };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadMessages() {
  const stubs = { '@/i18n/config': {} };
  for (const relativePath of [
    'src/i18n/messages-thesis-workflow.ts',
    'src/i18n/messages-dean-overview.ts',
    'src/i18n/messages-content.ts',
    'src/i18n/messages-attendance-geofence.ts',
    'src/i18n/messages-teaching-pages.ts',
    'src/i18n/messages-admin-pages.ts',
    'src/i18n/messages-student-pages.ts',
  ]) {
    stubs[`@/i18n/${path.basename(relativePath, '.ts')}`] = loadTs(relativePath, stubs);
  }
  return loadTs('src/i18n/messages.ts', stubs);
}

const messages = loadMessages();

test('announcement dialogs map the server code instead of printing raw text', () => {
  for (const relativePath of [
    'src/components/announcements/AnnouncementEditModal.tsx',
    'src/components/announcements/LecturerAnnouncementCreateModal.tsx',
  ]) {
    const source = read(relativePath);
    assert.ok(
      source.includes('campusCodeMessage(err, messages.common.campusErrors, copy.saveFailed)'),
      `${relativePath} maps the announced error code`,
    );
    assert.ok(
      !/response\?\.data\?\.message/.test(source),
      `${relativePath} does not render the server sentence`,
    );
  }
});

test('announcement error codes resolve to localized copy in both catalogues', () => {
  const { campusCodeMessage } = loadTs('src/lib/campus-error.ts');
  const cases = [
    ['ANNOUNCEMENT_VERSION_CONFLICT', 409],
    ['UNSAFE_ANNOUNCEMENT_CONTENT', 400],
    ['LECTURER_ANNOUNCEMENT_FORBIDDEN', 403],
    ['ANNOUNCEMENT_WINDOW_INVALID', 400],
  ];

  for (const [code, status] of cases) {
    for (const locale of ['en', 'vi']) {
      const catalogue = messages[locale].common.campusErrors;
      assert.equal(
        typeof catalogue.codes[code],
        'string',
        `${locale} needs localized copy for ${code}`,
      );
      const error = {
        response: {
          status,
          data: { code, message: 'Raw server sentence that must not render' },
        },
      };
      assert.equal(
        campusCodeMessage(error, catalogue),
        catalogue.codes[code],
        `${locale} maps ${code}`,
      );
    }
  }
});

function createRuntime() {
  const state = [];
  const refs = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effects = [];
  const fakeReact = {
    ...React,
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) {
        state[index] = typeof initial === 'function' ? initial() : initial;
      }
      return [
        state[index],
        (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
        },
      ];
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callback) {
      return callback;
    },
    useRef(initial) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
  };

  return {
    fakeReact,
    render(Component, props) {
      stateCursor = 0;
      refCursor = 0;
      effects = [];
      const tree = Component(props);
      return { tree, effects: [...effects] };
    },
  };
}

function elements(tree) {
  const found = [];
  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || !React.isValidElement(node)) return;
    found.push(node);
    for (const value of Object.values(node.props ?? {})) {
      if (React.isValidElement(value) || Array.isArray(value)) walk(value);
    }
  }
  walk(tree);
  return found;
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf(node.props?.children);
  return '';
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the announcement edit dialog shows the localized version-conflict copy', async () => {
  const runtime = createRuntime();
  const button = ({ children, type = 'button', onClick, disabled }) =>
    React.createElement('button', { type, onClick, disabled }, children);
  function InputField({ value = '', onChange, placeholder, id, required }) {
    return React.createElement('input', { value, onChange, placeholder, id, required });
  }
  function TextareaField({ value = '', onChange, placeholder, id, required }) {
    return React.createElement('textarea', { value, onChange, placeholder, id, required });
  }

  const mod = loadTs('src/components/announcements/AnnouncementEditModal.tsx', {
    react: runtime.fakeReact,
    '@/i18n': {
      useI18n: () => ({ locale: 'vi', messages: messages.vi }),
    },
    '@/components/ui/modal': {
      Modal: ({ children }) => React.createElement('div', null, children),
    },
    '@/components/ui/button': { Button: button },
    '@/components/ui/input': { Input: InputField },
    '@/components/ui/textarea': { Textarea: TextareaField },
    '@/components/ui/rich-content-renderer': {
      RichContentRenderer: ({ content }) => React.createElement('div', null, content),
    },
    '@/components/ui/tinymce-editor': {
      TinyMceEditor: () => null,
      clearTinyMceAutosaveDrafts: () => undefined,
    },
    '@/lib/api': {},
  });

  const serverMessage = 'Announcement was changed by another administrator';
  let saved = 0;
  const props = {
    announcement: {
      id: 'announcement-1',
      title: 'Học vụ tuần này',
      content: 'Nội dung thông báo.',
      priority: 'NORMAL',
      targetRoles: ['STUDENT', 'LECTURER'],
      isGlobal: false,
      publishedBy: 'Phòng Đào tạo',
      version: 3,
    },
    isOpen: true,
    onClose: () => undefined,
    onSave: async () => {
      saved += 1;
      throw {
        response: {
          status: 409,
          data: { code: 'ANNOUNCEMENT_VERSION_CONFLICT', message: serverMessage },
        },
      };
    },
  };

  const first = runtime.render(mod.AnnouncementEditModal, props);
  for (const effect of first.effects) effect();
  const mounted = runtime.render(mod.AnnouncementEditModal, props).tree;

  const form = elements(mounted).find((element) => element.type === 'form');
  assert.ok(form, 'the quick-edit form renders');
  form.props.onSubmit({ preventDefault: () => undefined });
  await flush();
  await flush();

  const rendered = textOf(runtime.render(mod.AnnouncementEditModal, props).tree);
  assert.equal(saved, 1, 'the save attempt runs once');
  assert.ok(
    rendered.includes(messages.vi.common.campusErrors.codes.ANNOUNCEMENT_VERSION_CONFLICT),
    'the dialog shows the Vietnamese catalogue copy',
  );
  assert.ok(!rendered.includes(serverMessage), 'the raw English server sentence stays hidden');
});
