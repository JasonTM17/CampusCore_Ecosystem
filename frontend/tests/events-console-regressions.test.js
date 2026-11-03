process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const {
  createRuntime,
  elements,
  flush,
  installBrowserEnv,
  loadTs,
  read,
  textOf,
} = require('./dashboard-shell-harness');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const eventsCopy = loadTs('src/i18n/events-messages.ts', {}).eventsMessages.vi;

const STAFF = {
  id: 'staff-1',
  email: 'staff@campuscore.edu',
  firstName: 'Binh',
  lastName: 'Tran',
  roles: ['LECTURER'],
};

const STUDENT = {
  id: 'student-1',
  email: 'student@campuscore.edu',
  firstName: 'An',
  lastName: 'Nguyen',
  roles: ['STUDENT'],
};

function eventRecord(overrides = {}) {
  return {
    id: 'e1',
    title: 'Ngay hoi viec lam',
    organizer: 'Doan Thanh nien',
    location: 'Hoi truong',
    description: '',
    capacity: 100,
    registeredCount: 0,
    seatsRemaining: 100,
    status: 'REGISTRATION_OPEN',
    startsAt: '2030-11-10T08:00:00Z',
    endsAt: '2030-11-10T10:00:00Z',
    registrationOpensAt: null,
    registrationClosesAt: null,
    myRegistrationStatus: null,
    myRegistrationId: null,
    myAttendanceStatus: null,
    ...overrides,
  };
}

function rosterEntry(index) {
  return {
    registrationId: `r-${index}`,
    version: 1,
    studentId: `s-${index}`,
    studentName: `Student ${index}`,
    email: `student-${index}@campuscore.edu`,
    status: 'REGISTERED',
    attendanceStatus: 'ABSENT',
    attendanceMarkedBy: null,
    attendanceMarkedAt: null,
    registeredAt: '2030-11-01T08:00:00Z',
  };
}

function staffDenied() {
  return Object.assign(new Error('Forbidden'), {
    response: { status: 403, data: { code: 'EVENTS_STAFF_REQUIRED' } },
  });
}

function loadPage(runtime, api, user) {
  const eventsMessages = loadTs('src/i18n/events-messages.ts', {}).eventsMessages;
  const stubs = {
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
        messages: loadTs('src/i18n/messages.ts', { '@/i18n/config': {} }).getMessages('vi'),
        href: (value) => value,
      }),
    },
    '@/i18n/events-messages': { eventsMessages },
    '@/lib/events-api': {
      eventsApi: api,
      isEventsStaffDenied: api.isEventsStaffDenied,
      newIdempotencyKey: api.newIdempotencyKey,
    },
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

async function mountConsole(api, user = STAFF) {
  installBrowserEnv();
  global.window.location.search = '';
  const runtime = createRuntime();
  const Page = loadPage(runtime, api, user);
  const tree = await settle(runtime, Page);
  return { runtime, Page, tree };
}

async function press(runtime, Page, element) {
  assert.ok(element, 'the control is rendered');
  element.props.onClick({ stopPropagation() {} });
  return settle(runtime, Page);
}

function byTestId(tree, id) {
  return elements(tree).find((element) => element.props?.['data-testid'] === id);
}

function card(node, id) {
  return elements(node).find((element) => element.props?.['data-event-id'] === id);
}

function isButtonElement(element) {
  return element.type === 'button'
    || (typeof element.type === 'function' && element.type.name === 'Button');
}

function cardButton(node, id, label) {
  const target = card(node, id);
  return target
    ? elements(target).find((element) => isButtonElement(element) && textOf(element).includes(label))
    : undefined;
}

test('a campus datetime-local value converts from the campus clock, not the browser clock', () => {
  assert.equal(
    new Date('2026-11-10T09:00').toISOString(),
    '2026-11-10T09:00:00.000Z',
    'the process clock is pinned to UTC, so a browser-local parse would keep 09:00Z',
  );

  const { campusLocalDateTimeToUtcIso } = loadTs('src/lib/attendance-checkin.ts', {});
  assert.equal(campusLocalDateTimeToUtcIso('2026-11-10T09:00'), '2026-11-10T02:00:00.000Z');
  assert.equal(campusLocalDateTimeToUtcIso('2026-11-10T09:00:30'), '2026-11-10T02:00:30.000Z');
  assert.equal(campusLocalDateTimeToUtcIso('2026-11-10T09:00:30.250'), '2026-11-10T02:00:30.250Z');
  assert.equal(campusLocalDateTimeToUtcIso('2026-02-31T09:00'), null);
  assert.equal(campusLocalDateTimeToUtcIso('not-a-date'), null);
});

test('the event create form converts every datetime-local field through the campus helper', () => {
  const source = read('src/components/events/EventsConsolePage.tsx');

  assert.match(source, /campusLocalDateTimeToUtcIso/);
  for (const field of ['startsAt', 'endsAt', 'registrationOpensAt', 'registrationClosesAt']) {
    assert.match(
      source,
      new RegExp(`campusLocalDateTimeToUtcIso\\(form\\.${field}\\)`),
      `${field} is read on the campus clock`,
    );
    assert.doesNotMatch(
      source,
      new RegExp(`new Date\\(form\\.${field}\\)`),
      `${field} must not be parsed in the browser zone`,
    );
  }
});

test('the staff event list and roster request bounded pages and read the total header', async () => {
  const requests = [];
  const apiClient = {
    get: async (url, config) => {
      requests.push({ url, config });
      return { data: [], headers: { 'x-total-count': '45' } };
    },
  };
  const { eventsApi } = loadTs('src/lib/events-api.ts', {
    '@/lib/api': { __esModule: true, default: apiClient },
  });

  const events = await eventsApi.staffListPage(1, 20);
  const roster = await eventsApi.staffRosterPage('event-1', 2, 20);

  assert.deepEqual(requests, [
    { url: '/events/staff', config: { params: { page: 1, limit: 20 } } },
    { url: '/events/staff/event-1/roster', config: { params: { page: 2, limit: 20 } } },
  ]);
  assert.equal(events.total, 45);
  assert.equal(events.page, 1);
  assert.equal(roster.total, 45);
  assert.equal(roster.page, 2);
});

test('the staff console pages the event list and the roster instead of rendering every row', async () => {
  const calls = [];
  const api = {
    staffList: async () => {
      calls.push({ kind: 'staff-legacy' });
      return [eventRecord()];
    },
    staffRoster: async (eventId) => {
      calls.push({ kind: 'roster-legacy', eventId });
      return Array.from({ length: 45 }, (_, index) => rosterEntry(index));
    },
    staffListPage: async (page, limit) => {
      calls.push({ kind: 'staff', page, limit });
      return { items: [eventRecord()], page, total: 45, totalPages: 3 };
    },
    staffRosterPage: async (eventId, page, limit) => {
      calls.push({ kind: 'roster', eventId, page, limit });
      return {
        items: Array.from({ length: 20 }, (_, index) => rosterEntry(index)),
        page,
        total: 45,
        totalPages: 3,
      };
    },
    listPublished: async () => [],
    myRegistrations: async () => [],
    isEventsStaffDenied: () => false,
    newIdempotencyKey: () => 'idempotency-key',
  };
  const { runtime, Page, tree } = await mountConsole(api);

  assert.deepEqual(calls[0], { kind: 'staff', page: 0, limit: 20 });

  const titleButton = elements(tree).find(
    (element) => element.type === 'button' && textOf(element).includes('Ngay hoi viec lam'),
  );
  let next = await press(runtime, Page, titleButton);
  assert.deepEqual(
    calls.find((call) => call.kind === 'roster'),
    { kind: 'roster', eventId: 'e1', page: 0, limit: 20 },
  );
  assert.equal(
    elements(next).filter((element) => element.props?.['data-testid'] === 'events-roster-row').length,
    20,
    'only the requested roster page is rendered',
  );

  next = await press(runtime, Page, byTestId(next, 'events-staff-next'));
  assert.deepEqual(calls.filter((call) => call.kind === 'staff').at(-1), {
    kind: 'staff',
    page: 1,
    limit: 20,
  });

  next = await press(runtime, Page, byTestId(next, 'events-roster-next'));
  assert.deepEqual(calls.filter((call) => call.kind === 'roster').at(-1), {
    kind: 'roster',
    eventId: 'e1',
    page: 1,
    limit: 20,
  });
});

test('cancel registration is not offered once the event has started', async () => {
  const past = eventRecord({
    id: 'past',
    title: 'Started event',
    startsAt: '2020-01-01T08:00:00Z',
    endsAt: '2020-01-01T10:00:00Z',
    myRegistrationStatus: 'REGISTERED',
    myRegistrationId: 'registration-past',
  });
  const future = eventRecord({
    id: 'future',
    title: 'Upcoming event',
    myRegistrationStatus: 'REGISTERED',
    myRegistrationId: 'registration-future',
  });
  const api = {
    staffList: async () => { throw staffDenied(); },
    staffListPage: async () => { throw staffDenied(); },
    listPublished: async () => [past, future],
    myRegistrations: async () => [],
    isEventsStaffDenied: (error) =>
      error?.response?.status === 403 && error?.response?.data?.code === 'EVENTS_STAFF_REQUIRED',
    newIdempotencyKey: () => 'idempotency-key',
  };
  const { tree } = await mountConsole(api, STUDENT);

  assert.equal(
    cardButton(tree, 'past', eventsCopy.cancelRegistration),
    undefined,
    'a started event offers no cancel',
  );
  assert.ok(
    cardButton(tree, 'future', eventsCopy.cancelRegistration),
    'a future event still offers cancel',
  );
});
