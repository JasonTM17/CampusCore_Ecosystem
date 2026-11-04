const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  elements,
  flush,
  installBrowserEnv,
  loadMessages,
  loadTs,
  textOf,
} = require('./dashboard-shell-harness');

const messages = loadMessages('vi');
const authPages = loadTs('src/i18n/messages-auth.ts');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

function loginStubs(runtime, pushed) {
  return {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      useRouter: () => ({ push: (href) => pushed.push(href), replace: () => {} }),
      useSearchParams: () => new URLSearchParams(''),
    },
    axios: { AxiosError: class AxiosError extends Error {} },
    'lucide-react': iconStub,
    '@/context/AuthContext': {
      useAuth: () => ({
        login: async () => ({}),
        verifyTwoFactor: async () => ({}),
        logout: async () => {},
      }),
    },
    '@/components/auth/AuthShell': {
      AuthShell: ({ children }) => React.createElement('div', null, children),
    },
    '@/components/LocalizedLink': {
      LocalizedLink: ({ href, children, ...rest }) => React.createElement('a', { href, ...rest }, children),
    },
    '@/components/ui/button': {
      Button: ({ children, ...rest }) => React.createElement(
        'button',
        { type: rest.type ?? 'button', disabled: rest.disabled },
        children,
      ),
    },
    '@/components/ui/input': {
      Input: ({ id, type, value, onChange, icon, endAction, ...rest }) => React.createElement(
        'input',
        { id, type, value, onChange, ...rest },
      ),
    },
    '@/i18n': {
      useI18n: () => ({ href: (value) => value, messages, locale: 'vi' }),
    },
    '@/lib/api': {
      API_BASE_URL: 'http://127.0.0.1:9/api/v1',
      SessionVerificationError: class SessionVerificationError extends Error {},
    },
  };
}

/**
 * Render the login page the way the shell tests do: a small hook runtime drives
 * the real component (including its effects) so surface-dependent rendering is
 * observed instead of matched as source text.
 */
async function renderLogin({ host, lane }) {
  const runtime = createRuntime();
  const { windowStub } = installBrowserEnv();
  windowStub.location = { host, pathname: '/login', search: '' };

  const previousLane = process.env.NEXT_PUBLIC_BFF_LANE;
  if (lane === undefined) {
    delete process.env.NEXT_PUBLIC_BFF_LANE;
  } else {
    process.env.NEXT_PUBLIC_BFF_LANE = lane;
  }
  const previousFetch = global.fetch;
  global.fetch = async () => ({ ok: true });

  try {
    const stubs = loginStubs(runtime, []);
    const page = loadTs('src/app/login/page.tsx', stubs, { cache: false });
    let tree = null;
    for (let pass = 0; pass < 4; pass += 1) {
      const rendered = runtime.render(page.default, {});
      runtime.runEffects(rendered.effects);
      tree = rendered.tree;
      await flush();
    }
    return tree;
  } finally {
    global.fetch = previousFetch;
    if (previousLane === undefined) {
      delete process.env.NEXT_PUBLIC_BFF_LANE;
    } else {
      process.env.NEXT_PUBLIC_BFF_LANE = previousLane;
    }
  }
}

function controlsOfType(tree, type) {
  return elements(tree).filter((node) => node.type === type);
}

function ssoAction(tree) {
  return controlsOfType(tree, 'a').find((node) =>
    String(node.props.href ?? '').startsWith('/session/login?return='),
  );
}

function fieldIds(tree) {
  return elements(tree)
    .filter((node) => node.type === 'input' || node.type?.name === 'Input')
    .map((node) => node.props.id)
    .filter(Boolean);
}

test('a BFF surface renders the SSO action and no credential form', async () => {
  const tree = await renderLogin({ host: 'portal.localhost:3102' });

  const sso = ssoAction(tree);
  assert.ok(sso, 'the BFF host must render the /session/login action');
  assert.equal(textOf(sso), authPages.authPagesVi.login.sso, 'the SSO action keeps its accessible name');
  assert.match(String(sso.props.href), /^\/session\/login\?return=%2F/, 'the SSO return stays a relative path');

  assert.deepEqual(fieldIds(tree), [], 'BFF surfaces have no credential login route, so no field may render');
  assert.equal(
    controlsOfType(tree, 'form').length,
    0,
    'BFF surfaces must not render a submit form for a proxy route that rejects it',
  );
});

test('a direct-API surface keeps the credential form and offers no SSO action', async () => {
  const tree = await renderLogin({ host: 'localhost:3000' });

  assert.deepEqual(fieldIds(tree), ['email', 'password'], 'the direct lane keeps both credential fields');
  assert.equal(ssoAction(tree), undefined, 'the direct lane has no BFF session route');
  assert.equal(controlsOfType(tree, 'form').length, 1, 'the direct lane keeps its submit form');
});

test('disabling the BFF lane restores the direct credential form', async () => {
  const tree = await renderLogin({ host: 'portal.localhost:3102', lane: 'false' });

  assert.deepEqual(fieldIds(tree), ['email', 'password']);
  assert.equal(ssoAction(tree), undefined);
});
