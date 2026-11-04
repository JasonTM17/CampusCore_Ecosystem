/**
 * Test harness for the dashboard shell: loads the real layout module with a
 * small hook runtime and the real VI/EN catalogue, so behaviour tests render
 * the production navigation instead of matching source text.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const moduleCache = new Map();

function loadTs(relativePath, stubs = {}, options = {}) {
  const cacheable = options.cache !== false;
  if (cacheable && moduleCache.has(relativePath)) {
    return moduleCache.get(relativePath).exports;
  }
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
  if (cacheable) {
    moduleCache.set(relativePath, moduleRecord);
  }
  const resolve = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      return stubs[specifier];
    }
    if (specifier.startsWith('@/i18n/')) {
      return loadTs(`src/i18n/${specifier.slice('@/i18n/'.length)}.ts`, stubs);
    }
    if (specifier.startsWith('@/lib/')) {
      return loadTs(`src/lib/${specifier.slice('@/lib/'.length)}.ts`, stubs);
    }
    return require(specifier);
  };
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

function loadMessages(locale) {
  const catalog = loadTs('src/i18n/messages.ts', {
    '@/i18n/config': {},
  });
  return catalog.getMessages(locale);
}

const depsEqual = (left, right) => {
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => Object.is(value, right[index]));
};

/** Minimal hook runtime: state/refs persist, effects respect dependencies. */
function createRuntime() {
  const state = [];
  const refs = [];
  const memos = [];
  const effectState = [];
  let stateCursor = 0;
  let refCursor = 0;
  let memoCursor = 0;
  let effectCursor = 0;
  let pending = [];

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
    useRef(initial) {
      const index = refCursor++;
      if (!(index in refs)) {
        refs[index] = { current: initial };
      }
      return refs[index];
    },
    useMemo(factory, deps) {
      const index = memoCursor++;
      const previous = memos[index];
      if (previous && depsEqual(previous.deps, deps)) {
        return previous.value;
      }
      const value = factory();
      memos[index] = { deps, value };
      return value;
    },
    useCallback(callback, deps) {
      return fakeReact.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const index = effectCursor++;
      pending.push({ index, effect, deps });
    },
  };

  return {
    fakeReact,
    render(Component, props) {
      stateCursor = 0;
      refCursor = 0;
      memoCursor = 0;
      effectCursor = 0;
      pending = [];
      const tree = Component(props);
      return { tree, effects: pending };
    },
    runEffects(effects) {
      for (const { index, effect, deps } of effects) {
        const previous = effectState[index];
        if (previous && depsEqual(previous.deps, deps)) {
          continue;
        }
        if (previous?.cleanup) {
          previous.cleanup();
        }
        const cleanup = effect();
        effectState[index] = {
          deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        };
      }
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

/** Browser globals used by the shell effects, with a real in-tab event bus. */
function installBrowserEnv() {
  const listeners = new Map();
  const documentStub = {
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
    body: { style: {} },
    visibilityState: 'visible',
    title: '',
    head: {},
    querySelectorAll: () => [],
  };
  const windowStub = {
    matchMedia: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      listeners.set(type, handlers.filter((entry) => entry !== handler));
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) ?? []) {
        handler(event);
      }
      return true;
    },
    location: { search: '' },
    document: documentStub,
  };
  global.window = windowStub;
  global.document = documentStub;
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return { windowStub, documentStub, listeners };
}

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

function createDashboardShell(options) {
  const {
    pathname = '/dashboard',
    locale = 'vi',
    user,
    flags = {},
    notifications = {},
    messages = loadMessages(locale),
    extraStubs = {},
    routeHref = (value) => value,
  } = options;

  const { windowStub, documentStub } = installBrowserEnv();
  const replaced = [];
  const router = {
    replace: (href) => replaced.push(href),
    push: (href) => replaced.push(href),
  };
  const apiCalls = { getMy: [], unreadCount: [] };
  const notificationsApi = {
    getMy: async (params) => {
      apiCalls.getMy.push(params);
      return notifications.getMy ? notifications.getMy(params) : { data: [] };
    },
    unreadCount: async (params) => {
      apiCalls.unreadCount.push(params);
      return notifications.unreadCount ? notifications.unreadCount(params) : 0;
    },
    markRead: async () => undefined,
  };
  const authValue = {
    user,
    isLoading: false,
    isLoggingOut: false,
    isLecturer: Boolean(user?.roles?.includes('LECTURER')),
    isAdmin: Boolean(user?.roles?.includes('ADMIN')),
    isSuperAdmin: Boolean(user?.roles?.includes('SUPER_ADMIN')),
    isFacultyHead: Boolean(user?.roles?.includes('TRUONG_KHOA')),
    isDepartmentHead: Boolean(user?.roles?.includes('TRUONG_BO_MON')),
    logout: async () => {},
    refreshUser: async () => {},
    ...flags,
  };

  const runtime = createRuntime();
  const stubs = {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      usePathname: () => pathname,
      useRouter: () => router,
    },
    '@/context/AuthContext': { useAuth: () => authValue },
    sonner: { toast: { success: () => {}, error: () => {} } },
    '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
    '@/components/LanguageToggle': { LanguageToggle: () => null },
    '@/components/LocalizedLink': {
      LocalizedLink: ({ href, children, ...rest }) =>
        React.createElement('a', { href, ...rest }, children),
    },
    '@/components/ThemeToggle': { ThemeToggle: () => null },
    '@/components/BrandMark': { BrandMark: () => null },
    '@/components/auth/ForcedPasswordRotationGate': {
      ForcedPasswordRotationGate: () => null,
    },
    '@/components/assistant/lazy-assistant-panel': { LazyAssistantPanel: () => null },
    '@/components/assistant/AssistantMascot': { AssistantMascot: () => null },
    '@/lib/use-document-title': { useDocumentTitle: () => {} },
    '@/components/ui/button': {
      Button: ({ children, onClick, ...rest }) =>
        React.createElement(
          'button',
          {
            type: 'button',
            onClick,
            'aria-label': rest['aria-label'],
            'aria-expanded': rest['aria-expanded'],
            'aria-controls': rest['aria-controls'],
          },
          children,
        ),
    },
    '@/components/ui/skeleton': { Skeleton: () => null },
    '@/lib/api': {
      notificationsApi,
      clearNotificationCache: () => {},
      clearSemestersCache: () => {},
      clearDepartmentsCache: () => {},
    },
    '@/lib/session-hint': { hasCsrfSessionHint: () => Boolean(user) },
    '@/lib/utils': {
      cn: (...values) => values.filter(Boolean).join(' '),
      htmlToPlainText: (value) => value || '',
      stripNotificationTagPrefix: (value) => value || '',
    },
    '@/i18n': {
      useI18n: () => ({ href: routeHref, messages, locale }),
    },
    'lucide-react': iconStub,
    ...extraStubs,
  };

  const layoutModule = loadTs('src/app/dashboard/layout.tsx', stubs, { cache: false });
  const Layout = layoutModule.default;
  const props = { children: null };

  async function pump(times = 4) {
    let tree = null;
    for (let index = 0; index < times; index += 1) {
      const rendered = runtime.render(Layout, props);
      runtime.runEffects(rendered.effects);
      tree = rendered.tree;
      await flush();
    }
    return tree;
  }

  return {
    pump,
    flush,
    replaced,
    router,
    apiCalls,
    windowStub,
    documentStub,
    messages,
    treeElements: elements,
  };
}

module.exports = {
  read,
  loadTs,
  loadMessages,
  createDashboardShell,
  createRuntime,
  installBrowserEnv,
  elements,
  textOf,
  flush,
};
