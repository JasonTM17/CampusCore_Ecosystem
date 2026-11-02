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

const STUDENT = {
  id: 'student-1',
  email: 'student@campuscore.edu',
  firstName: 'An',
  lastName: 'Nguyen',
  roles: ['STUDENT'],
};

function eventRecord(id, title) {
  return {
    id,
    title,
    organizer: 'Doan Thanh nien',
    location: 'Hoi truong',
    description: '',
    capacity: 100,
    registeredCount: 0,
    seatsRemaining: 100,
    status: 'REGISTRATION_OPEN',
    startsAt: '2026-11-10T08:00:00Z',
    endsAt: '2026-11-10T10:00:00Z',
    registrationOpensAt: null,
    registrationClosesAt: null,
    myRegistrationStatus: null,
    myRegistrationId: null,
    myAttendanceStatus: null,
  };
}

function staffDenied() {
  return Object.assign(new Error('Forbidden'), {
    response: { status: 403, data: { code: 'EVENTS_STAFF_REQUIRED' } },
  });
}

function loadPage(runtime) {
  const eventsMessages = loadTs('src/i18n/events-messages.ts', {}).eventsMessages;
  const stubs = {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': iconStub,
    sonner: { toast: { success: () => {}, error: () => {} } },
    '@/context/AuthContext': {
      useRequireAuth: () => ({
        user: STUDENT,
        isLoading: false,
        hasAccess: true,
        isForbidden: false,
      }),
    },
    '@/i18n': {
      useI18n: () => ({
        locale: 'vi',
        formatDateTime: (value) => String(value),
        href: (value) => value,
      }),
    },
    '@/i18n/events-messages': { eventsMessages },
    '@/lib/events-api': {
      eventsApi: {
        staffList: async () => {
          throw staffDenied();
        },
        listPublished: async () => [eventRecord('e1', 'Ngay hoi viec lam'), eventRecord('e2', 'Hien mau')],
        myRegistrations: async () => [],
      },
      isEventsStaffDenied: (error) => {
        const response = error?.response;
        return response?.status === 403 && response?.data?.code === 'EVENTS_STAFF_REQUIRED';
      },
      newIdempotencyKey: () => 'idempotency-key',
    },
    '@/components/ui/button': {
      Button: ({ children, onClick, ...rest }) =>
        React.createElement('button', { type: 'button', onClick }, children),
    },
    '@/components/ui/input': {
      Input: (props) => React.createElement('input', { value: props.value ?? '' }),
    },
    '@/components/ui/modal': { Modal: () => null },
    '@/components/ui/page-header': {
      PageHeader: ({ title, actions }) =>
        React.createElement('header', null, React.createElement('h1', null, title), actions),
      SectionEyebrow: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/state-block': {
      EmptyState: ({ title }) => React.createElement('div', null, title),
      ErrorState: ({ title }) => React.createElement('div', { role: 'alert' }, title),
      LoadingState: ({ label }) => React.createElement('div', { role: 'status' }, label),
    },
    '@/components/ui/status': { statusToneClass: () => '' },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  };
  return loadTs('src/components/events/EventsConsolePage.tsx', stubs, { cache: false })
    .EventsConsolePage;
}

async function mountEventsConsole(search) {
  const { documentStub } = installBrowserEnv();
  const scrolled = [];
  const cards = ['e1', 'e2'].map((id) => ({
    dataset: { eventId: id },
    scrollIntoView: (options) => scrolled.push({ id, options }),
  }));
  global.window.location.search = search;
  documentStub.querySelectorAll = (selector) =>
    selector === '[data-event-id]' ? cards : [];

  const runtime = createRuntime();
  const Page = loadPage(runtime);
  let tree = null;
  for (let index = 0; index < 6; index += 1) {
    const rendered = runtime.render(Page, {});
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
    await flush();
  }
  return { tree, scrolled };
}

function cardFor(tree, id) {
  return elements(tree).find(
    (element) => element.props?.['data-event-id'] === id,
  );
}

test('a student deep link highlights and reveals the referenced event', async () => {
  const { tree, scrolled } = await mountEventsConsole('?event=e1');

  const target = cardFor(tree, 'e1');
  assert.ok(target, 'the referenced event card is rendered');
  assert.equal(target.props['aria-current'], 'true', 'the card is announced as current');
  assert.match(target.props.className, /ring-2/, 'the card is visually highlighted');

  const other = cardFor(tree, 'e2');
  assert.ok(other, 'sibling events still render');
  assert.equal(other.props['aria-current'], undefined);

  assert.deepEqual(
    scrolled.map((entry) => entry.id),
    ['e1'],
    'only the referenced card is scrolled into view',
  );
  assert.deepEqual(scrolled[0].options, { block: 'center', behavior: 'smooth' });
});

test('without the query parameter no student card is highlighted', async () => {
  const { tree, scrolled } = await mountEventsConsole('');
  assert.ok(cardFor(tree, 'e1'), 'the events still render');
  assert.equal(cardFor(tree, 'e1').props['aria-current'], undefined);
  assert.deepEqual(scrolled, []);
});
