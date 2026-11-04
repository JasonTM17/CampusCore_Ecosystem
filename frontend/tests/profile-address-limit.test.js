const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  elements,
  flush,
  loadMessages,
  loadTs,
  textOf,
} = require('./dashboard-shell-harness');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const messages = loadMessages('en');

function loadProfilePage(runtime, authApi) {
  return loadTs('src/app/dashboard/profile/page.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': iconStub,
    sonner: { toast: { success: () => {}, error: () => {} } },
    '@/context/AuthContext': {
      useAuth: () => ({
        user: {
          id: 'u1',
          firstName: 'An',
          lastName: 'Nguyen',
          email: 'an@example.test',
          phone: '',
          address: '',
          dateOfBirth: '2003-05-15',
          roles: ['STUDENT'],
        },
        refreshUser: async () => {},
        logout: async () => {},
      }),
    },
    '@/lib/api': { authApi },
    '@/components/ui/button': {
      Button: ({ children, onClick, type = 'button', disabled }) => React.createElement(
        'button',
        { type, onClick, disabled },
        children,
      ),
    },
    '@/components/ui/input': {
      Input: (props) => React.createElement('input', {
        id: props.id,
        value: props.value ?? '',
        onChange: props.onChange,
        maxLength: props.maxLength,
      }),
    },
    '@/components/ui/page-header': {
      PageHeader: ({ title, children }) => React.createElement('header', null, title, children),
      SectionEyebrow: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/state-block': {
      LoadingState: ({ label }) => React.createElement('div', null, label),
    },
    '@/components/dashboard/WorkspaceSurface': {
      WorkspacePanel: ({ title, children }) => React.createElement('section', null, title, children),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'en',
        messages,
        href: (value) => value,
        formatNumber: String,
      }),
    },
  }, { cache: false }).default;
}

async function settle(runtime, Page) {
  let tree = null;
  for (let index = 0; index < 6; index += 1) {
    const rendered = runtime.render(Page, {});
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
  }
  return tree;
}

function addressInput(tree) {
  return elements(tree).find((element) => element.props?.id === 'profile-address');
}

test('a 501-character address is rejected before it reaches the profile endpoint', async () => {
  const updateCalls = [];
  const authApi = {
    getTwoFactorStatus: async () => ({ enabled: false }),
    updateProfile: async (payload) => {
      updateCalls.push(payload);
      return payload;
    },
  };

  const runtime = createRuntime();
  const Page = loadProfilePage(runtime, authApi);
  const loaded = await settle(runtime, Page);

  const address = addressInput(loaded);
  assert.ok(address, 'the address field is rendered');
  assert.equal(address.props.maxLength, 500, 'the address input mirrors the API limit');
  address.props.onChange({ target: { value: 'x'.repeat(501) } });

  const edited = await settle(runtime, Page);
  const profileForm = elements(edited).find(
    (element) => element.type === 'form' && textOf(element).includes(messages.profile.fields.address),
  );
  assert.ok(profileForm, 'the profile form is rendered');
  profileForm.props.onSubmit({ preventDefault() {} });
  const after = await settle(runtime, Page);

  assert.equal(updateCalls.length, 0, 'a 501-character address must never reach the profile endpoint');
  assert.match(
    String(addressInput(after)?.props?.error ?? ''),
    /500/,
    'the oversized address is explained next to the field',
  );
});
