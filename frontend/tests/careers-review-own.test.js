const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  elements,
  flush,
  installBrowserEnv,
  loadTs,
} = require('./dashboard-shell-harness');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const careerCopy = loadTs('src/i18n/careers-messages.ts', {}).careerMessages.vi;
const messages = loadTs('src/i18n/messages.ts', { '@/i18n/config': {} }).getMessages('vi');

const REVIEWER = {
  id: 'reviewer-1',
  email: 'reviewer@campuscore.edu',
  firstName: 'Mai',
  lastName: 'Le',
  roles: ['ADMIN'],
};

function opportunity(overrides = {}) {
  return {
    id: 'opp-1',
    organizationId: 'org-1',
    organizationName: 'UTE Partner',
    title: 'Backend intern',
    description: null,
    location: null,
    employmentType: null,
    salaryText: null,
    status: 'IN_REVIEW',
    submittedBy: REVIEWER.id,
    reviewedBy: null,
    reviewedAt: null,
    publishedAt: null,
    pausedAt: null,
    closedAt: null,
    moderationReason: null,
    version: 3,
    createdAt: '2030-11-01T08:00:00Z',
    ...overrides,
  };
}

function loadPage(runtime, api, user = REVIEWER) {
  return loadTs('src/components/careers/CareersDeskPage.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': iconStub,
    sonner: { toast: { success: () => {}, error: () => {} } },
    '@/context/AuthContext': {
      useRequireAuth: () => ({
        user,
        isLoading: false,
        hasAccess: true,
        isForbidden: false,
      }),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        formatDateTime: (value) => String(value),
        messages,
        href: (value) => value,
      }),
    },
    '@/i18n/careers-messages': {
      careerMessages: loadTs('src/i18n/careers-messages.ts', {}).careerMessages,
    },
    '@/lib/careers-api': { careersApi: api },
    '@/components/ui/button': {
      Button: ({ children, onClick, ...rest }) =>
        React.createElement('button', {
          type: 'button',
          onClick,
          disabled: rest.disabled,
          'data-testid': rest['data-testid'],
        }, children),
    },
    '@/components/ui/input': {
      Input: (props) => React.createElement('input', {
        value: props.value ?? '',
        'data-testid': props['data-testid'],
      }),
    },
    '@/components/ui/page-header': {
      PageHeader: ({ title, actions }) =>
        React.createElement('header', null, React.createElement('h1', null, title), actions),
      SectionEyebrow: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/state-block': {
      EmptyState: ({ title }) => React.createElement('div', null, title),
      ErrorState: ({ title, description }) =>
        React.createElement('div', { role: 'alert' }, title, description),
      ForbiddenState: ({ title }) => React.createElement('div', null, title),
      LoadingState: ({ label }) => React.createElement('div', { role: 'status' }, label),
    },
    '@/components/ui/link-button': {
      LinkButton: ({ children, href }) => React.createElement('a', { href }, children),
    },
    '@/components/ui/status': { statusToneClass: () => '' },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  }, { cache: false }).CareersDeskPage;
}

async function settle(runtime, Page) {
  let tree = null;
  for (let index = 0; index < 8; index += 1) {
    const rendered = runtime.render(Page, {});
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
    await flush();
  }
  return tree;
}

function byTestId(tree, id) {
  return elements(tree).find((element) => element.props?.['data-testid'] === id);
}

function mountDesk(api) {
  installBrowserEnv();
  const runtime = createRuntime();
  const Page = loadPage(runtime, api);
  return settle(runtime, Page).then((tree) => ({ runtime, Page, tree }));
}

function baseApi(overrides = {}) {
  return {
    myOrganizations: async () => [],
    reviewQueuePage: async () => ({
      items: [
        opportunity(),
        opportunity({ id: 'opp-2', title: 'Data intern', submittedBy: 'someone-else' }),
      ],
      page: 0,
      total: 2,
    }),
    publish: async () => opportunity({ status: 'PUBLISHED' }),
    rejectOpportunity: async () => opportunity({ status: 'REJECTED' }),
    opportunityQueuePage: async () => ({ items: [], page: 0, total: 0 }),
    applicationQueuePage: async () => ({ items: [], page: 0, total: 0 }),
    ...overrides,
  };
}

test('the moderation queue hides publish and reject on the reviewer own submission', async () => {
  const { tree } = await mountDesk(baseApi());

  const ownCard = elements(tree).find(
    (element) => element.props?.['data-testid'] === 'careers-review-opp-1',
  );
  const otherCard = elements(tree).find(
    (element) => element.props?.['data-testid'] === 'careers-review-opp-2',
  );
  assert.ok(ownCard, 'the own submission is listed in the review queue');
  assert.ok(otherCard, 'another submission is listed in the review queue');

  assert.equal(
    elements(ownCard).find((element) => element.props?.['data-testid'] === 'careers-publish-opp-1'),
    undefined,
    'the reviewer cannot publish their own submission',
  );
  assert.equal(
    elements(ownCard).find((element) => element.props?.['data-testid'] === 'careers-reject-opp-opp-1'),
    undefined,
    'the reviewer cannot reject their own submission',
  );
  assert.ok(
    elements(otherCard).find((element) => element.props?.['data-testid'] === 'careers-publish-opp-2'),
    'another submission can still be published',
  );
  assert.ok(
    elements(otherCard).find((element) => element.props?.['data-testid'] === 'careers-reject-opp-opp-2'),
    'another submission can still be rejected',
  );
});

test('a self-moderation rejection explains why the action is forbidden', async () => {
  const selfPublish = Object.assign(new Error('Forbidden'), {
    response: { status: 403, data: { code: 'SELF_PUBLISH_FORBIDDEN' } },
  });
  const api = baseApi({
    reviewQueuePage: async () => ({
      items: [opportunity({ id: 'opp-2', submittedBy: 'someone-else' })],
      page: 0,
      total: 1,
    }),
    publish: async () => { throw selfPublish; },
  });
  const { runtime, Page, tree } = await mountDesk(api);

  const publish = byTestId(tree, 'careers-publish-opp-2');
  assert.ok(publish, 'the publish control is rendered for a foreign submission');
  publish.props.onClick();
  const failed = await settle(runtime, Page);

  const errorState = elements(failed).find(
    (element) => element.props?.description && element.props?.title === careerCopy.failed,
  );
  assert.ok(errorState, 'the failure is announced');
  assert.equal(
    errorState.props.description,
    careerCopy.selfPublishForbidden,
    'the self-moderation rule gets its own explanation',
  );
});
