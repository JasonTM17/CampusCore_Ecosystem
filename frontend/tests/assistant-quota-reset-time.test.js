const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function compile(relativePath) {
  return ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: relativePath,
  }).outputText;
}

function loadTs(relativePath, stubs = {}) {
  const output = compile(relativePath);
  const moduleRecord = { exports: {} };
  const resolve = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier];
    if (specifier.startsWith('@/')) {
      const base = `src/${specifier.slice(2)}`;
      const candidate = fs.existsSync(path.join(root, `${base}.tsx`)) ? `${base}.tsx` : `${base}.ts`;
      return loadTs(candidate, stubs);
    }
    if (specifier.startsWith('.')) {
      const base = path.posix.join(path.posix.dirname(relativePath), specifier);
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

function fakeReactHooks() {
  return {
    ...React,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => undefined],
    useEffect: () => undefined,
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial }),
  };
}

const messages = loadMessages();

function formatters() {
  const config = loadTs('src/i18n/config.ts');
  const provider = loadTs('src/i18n/index.tsx', {
    react: fakeReactHooks(),
    'next/navigation': { usePathname: () => '/dashboard' },
    '@/i18n/config': config,
    '@/i18n/messages': { getMessages: (locale) => messages[locale] },
    '@/i18n/paths': {
      buildLocaleSwitchPath: () => '/',
      localizePathname: (pathname) => pathname,
      stripLocaleFromPathname: () => ({ locale: null }),
    },
    '@/i18n/resolve-locale': {
      readLocaleCookie: () => null,
      resolveClientLocale: ({ serverLocale }) => serverLocale,
    },
  }).I18nProvider;
  return (locale) => provider({ locale, isPrefixed: false, children: null }).props.value;
}

function loadAssistant(context) {
  return loadTs('src/components/assistant/AssistantMessages.tsx', {
    '@/i18n': {
      useI18n: () => ({
        ...context,
        messages: messages.vi,
        locale: 'vi',
      }),
    },
    'sonner': { toast: { success: () => undefined, error: () => undefined } },
    'next/navigation': { useRouter: () => ({ push: () => undefined }) },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/components/ui/button': {
      Button: ({ children, ...props }) => React.createElement('button', props, children),
    },
  }).AssistantMessages;
}

test('the assistant quota reset time uses the campus locale and time zone', () => {
  const originalZone = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const context = formatters()('vi');
    const AssistantMessages = loadAssistant(context);
    const html = renderToStaticMarkup(
      React.createElement(AssistantMessages, {
        messageList: [
          {
            id: 'quota-1',
            role: 'assistant',
            content: 'Bạn đã dùng hết lượt hỏi trong ngày.',
            reasonCode: 'QUOTA_EXCEEDED',
            resetAt: '2026-11-03T17:00:00Z',
          },
        ],
        onFeedback: () => undefined,
      }),
    );

    assert.ok(html.includes('00:00'), 'the reset is shown on the campus clock');
    assert.ok(!html.includes('17:00'), 'the device time zone does not leak into the badge');
  } finally {
    process.env.TZ = originalZone;
  }
});
