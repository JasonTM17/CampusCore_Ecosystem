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

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const messages = loadMessages('en');

function textInputStub(tagName, props) {
  const element = React.createElement(tagName, {
    id: props.id,
    value: props.value ?? '',
    onChange: props.onChange,
    maxLength: props.maxLength,
    disabled: props.disabled,
    'aria-label': props['aria-label'],
    'data-testid': props['data-testid'],
  });
  return React.createElement(
    'div',
    null,
    element,
    props.error ? React.createElement('p', { role: 'alert' }, props.error) : null,
  );
}

function loadAttendancePage(runtime, api, toasts) {
  return loadTs('src/app/dashboard/lecturer/attendance/page.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': iconStub,
    sonner: { toast: toasts },
    '@/context/AuthContext': {
      useRequireAuth: () => ({ hasAccess: true, isLoading: false }),
    },
    '@/lib/api': api,
    '@/components/ProtectedRoute': { WorkspaceForbiddenState: () => null },
    '@/components/ui/page-header': {
      PageHeader: ({ title, children }) => React.createElement('header', null, title, children),
      SectionEyebrow: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/select': {
      Select: ({ label, value, onChange, options = [] }) => React.createElement(
        'label',
        null,
        label,
        React.createElement(
          'select',
          { value, onChange },
          options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
        ),
      ),
    },
    '@/components/ui/input': {
      Input: (props) => textInputStub('input', props),
    },
    '@/components/ui/button': {
      Button: ({ children, onClick, type = 'button', disabled }) => React.createElement(
        'button',
        { type, onClick, disabled },
        children,
      ),
    },
    '@/components/ui/state-block': {
      EmptyState: ({ title }) => React.createElement('div', null, title),
      ErrorState: ({ title }) => React.createElement('div', null, title),
      LoadingState: ({ label }) => React.createElement('div', null, label),
    },
    '@/components/dashboard/WorkspaceSurface': {
      WorkspacePanel: ({ title, children }) => React.createElement('section', null, title, children),
      WorkspaceMetricCard: ({ label }) => React.createElement('div', null, label),
    },
    '@/components/lecturer/GeofenceCheckinPanel': { GeofenceCheckinPanel: () => null },
    '@/components/ui/status': { metricToneClass: () => '' },
    '@/components/ui/use-confirmation-dialog': {
      useConfirmationDialog: () => ({ confirm: async () => false, confirmationDialog: null }),
    },
    '@/components/ui/unsaved-changes-confirm': { UnsavedChangesConfirmDialog: () => null },
    '@/lib/use-unsaved-changes-guard': {
      useUnsavedChangesGuard: () => ({
        requestLeave: (action) => action(),
        confirmOpen: false,
        confirmTitle: '',
        confirmBody: '',
        confirmLeave: () => {},
        cancelLeave: () => {},
      }),
    },
    '@/i18n': {
      useI18n: () => ({ locale: 'en', formatNumber: String, messages, href: (value) => value }),
    },
  }, { cache: false }).default;
}

function loadGeofencePanel(runtime, api) {
  const copy = messages.attendanceGeofence.lecturer;
  return loadTs('src/components/lecturer/GeofenceCheckinPanel.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': iconStub,
    sonner: { toast: { success: () => {}, error: () => {} } },
    '@/lib/api': api,
    '@/components/ui/button': {
      Button: ({ children, onClick, type = 'button', disabled, ...rest }) => React.createElement(
        'button',
        { type, onClick, disabled, 'aria-label': rest['aria-label'] },
        children,
      ),
    },
    '@/components/ui/input': { Input: (props) => textInputStub('input', props) },
    '@/components/ui/modal': {
      Modal: ({ isOpen, children }) => (isOpen ? React.createElement('div', null, children) : null),
    },
    '@/components/ui/select': {
      Select: ({ label, value, onChange, options = [] }) => React.createElement(
        'label',
        null,
        label,
        React.createElement(
          'select',
          { value, onChange },
          options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
        ),
      ),
    },
    '@/components/ui/status-pill': {
      StatusPill: ({ children }) => React.createElement('span', null, children),
    },
    '@/components/ui/textarea': {
      Textarea: (props) => textInputStub('textarea', props),
    },
    '@/components/ui/status': {
      metricToneClass: () => '',
      statusToneClass: () => '',
    },
    '@/components/ui/use-confirmation-dialog': {
      useConfirmationDialog: () => ({ confirm: async () => false, confirmationDialog: null }),
    },
    '@/components/dashboard/WorkspaceSurface': {
      WorkspacePanel: ({ children }) => React.createElement('section', null, children),
      WorkspaceMetricCard: ({ label }) => React.createElement('div', null, label),
    },
    '@/components/lecturer/ProjectorCodeOverlay': { ProjectorCodeOverlay: () => null },
    '@/i18n': {
      useI18n: () => ({
        formatDateTime: (value) => String(value),
        formatNumber: String,
        href: (value) => value,
        messages,
      }),
    },
  }, { cache: false }).GeofenceCheckinPanel;
}

async function settle(runtime, Component, props) {
  let tree = null;
  for (let index = 0; index < 8; index += 1) {
    const rendered = runtime.render(Component, props);
    runtime.runEffects(rendered.effects);
    tree = rendered.tree;
    await flush();
  }
  return tree;
}

function findButton(tree, label) {
  return elements(tree).find(
    (element) => typeof element.props?.onClick === 'function' && (
      element.props?.['aria-label'] === label || textOf(element).includes(label)
    ),
  );
}

function noteInput(tree) {
  return elements(tree).find(
    (element) => String(element.props?.['aria-label'] ?? '').includes('Nguyen An'),
  );
}

test('the roster note stops at the API limit instead of failing the whole save', async () => {
  installBrowserEnv();
  const toasts = [];
  const toast = {
    success: (message) => toasts.push(['success', message]),
    error: (message) => toasts.push(['error', message]),
    info: (message) => toasts.push(['info', message]),
    warning: (message) => toasts.push(['warning', message]),
  };
  const saveCalls = [];
  const api = {
    semestersApi: {
      getAll: async () => ({ data: [{ id: 'sem-1', name: 'HK1', nameEn: 'Semester 1', nameVi: 'HK1' }] }),
    },
    sectionsApi: {
      getMyGradingSections: async () => [{
        sectionId: 'sec-1',
        sectionNumber: '01',
        courseCode: 'CS101',
        courseName: 'Intro to CS',
      }],
    },
    attendanceApi: {
      getSectionRoster: async () => [{
        studentId: 's1',
        studentCode: 'SV001',
        lastName: 'Nguyen',
        firstName: 'An',
      }],
      getSectionAttendance: async () => [],
      getSectionSummary: async () => ({ attendanceRate: 100, totalSessions: 1 }),
      saveSectionAttendance: async (sectionId, payload) => {
        saveCalls.push({ sectionId, payload });
        return { updatedCount: payload.records.length };
      },
    },
  };

  const runtime = createRuntime();
  runtime.fakeReact.useId = () => 'control';
  const Page = loadAttendancePage(runtime, api, toast);
  const loaded = await settle(runtime, Page, {});

  const input = noteInput(loaded);
  assert.ok(input, 'the roster note input is rendered');
  input.props.onChange({ target: { value: 'x'.repeat(1001) } });

  const edited = await settle(runtime, Page, {});
  const save = findButton(edited, messages.lecturerAttendance.saveButton);
  assert.ok(save, 'the save action is rendered');
  await save.props.onClick();
  const after = await settle(runtime, Page, {});

  assert.equal(saveCalls.length, 0, 'a 1001-character note must never reach the attendance endpoint');
  assert.ok(toasts.some(([kind]) => kind === 'error'), 'the blocked save is announced');
  const noteAfter = noteInput(after);
  assert.match(
    String(noteAfter?.props?.error ?? ''),
    /1000/,
    'the oversized note is explained next to that row',
  );

  noteAfter.props.onChange({ target: { value: 'y'.repeat(1000) } });
  const atLimit = await settle(runtime, Page, {});
  const saveAtLimit = findButton(atLimit, messages.lecturerAttendance.saveButton);
  await saveAtLimit.props.onClick();
  const saved = await settle(runtime, Page, {});

  assert.equal(saveCalls.length, 1, 'a note exactly at the limit still saves');
  assert.equal(saveCalls[0].payload.records[0].notes.length, 1000);
  assert.equal(noteInput(saved)?.props?.error, undefined, 'the row error clears once the note fits');
});

test('the check-in review note stops at the API limit before submitting', async () => {
  const { windowStub } = installBrowserEnv();
  const date = '2026-11-03';
  const storageKey = `cc_checkin_active_sec-1_${date}`;
  windowStub.sessionStorage = {
    getItem: (key) => (key === storageKey ? 'sess-abc123' : null),
    setItem: () => {},
    removeItem: () => {},
  };
  windowStub.location = { origin: 'http://localhost', search: '' };
  const previousSetInterval = global.setInterval;
  const previousClearInterval = global.clearInterval;
  global.setInterval = () => 1;
  global.clearInterval = () => {};

  try {
    const reviewCalls = [];
    const session = {
      id: 'sess-abc123',
      status: 'OPEN',
      sectionId: 'sec-1',
      date,
      geofenceId: 'geo-1',
      requireCode: true,
      closesAt: '2027-01-01T00:00:00Z',
    };
    const checkin = {
      id: 'chk-1',
      studentId: 's1',
      decision: 'PENDING_REVIEW',
      reason: 'BORDERLINE',
      distanceMeters: 10,
      accuracyMeters: 5,
      capturedAt: '2026-11-03T01:00:00Z',
    };
    const api = {
      geofencedAttendanceApi: {
        listActiveGeofences: async () => [{
          id: 'geo-1',
          name: 'Campus',
          campusCode: 'UTE-MAIN',
          centerLat: 10.85,
          centerLng: 106.77,
          radiusMeters: 150,
          isActive: true,
        }],
        getSession: async () => session,
        listSessionCheckins: async () => [checkin],
        reviewCheckin: async (id, payload) => {
          reviewCalls.push({ id, payload });
          return { ...checkin, decision: 'APPROVED', reviewNote: payload.note };
        },
      },
    };

    const runtime = createRuntime();
    const Panel = loadGeofencePanel(runtime, api);
    const props = {
      sectionId: 'sec-1',
      sectionLabel: 'CS101 - 01',
      date,
      roster: [{ studentId: 's1', studentCode: 'SV001', studentName: 'Nguyen An' }],
    };
    const loaded = await settle(runtime, Panel, props);

    const approve = findButton(
      loaded,
      `${messages.attendanceGeofence.lecturer.approve} — Nguyen An`,
    );
    assert.ok(approve, 'the pending check-in offers a review action');
    approve.props.onClick();

    const reviewing = await settle(runtime, Panel, props);
    const note = elements(reviewing).find(
      (element) => element.props?.['data-testid'] === 'checkin-review-note',
    );
    assert.ok(note, 'the review note field is rendered');
    note.props.onChange({ target: { value: 'x'.repeat(1001) } });

    const edited = await settle(runtime, Panel, props);
    const form = elements(edited).find((element) => element.type === 'form');
    assert.ok(form, 'the review form is rendered');
    form.props.onSubmit({ preventDefault() {} });
    await flush();
    await flush();
    const after = await settle(runtime, Panel, props);

    assert.equal(reviewCalls.length, 0, 'a 1001-character review note must never reach the review endpoint');
    const noteAfter = elements(after).find(
      (element) => element.props?.['data-testid'] === 'checkin-review-note',
    );
    assert.match(
      String(noteAfter?.props?.error ?? ''),
      /1000/,
      'the oversized review note is explained inline',
    );
  } finally {
    global.setInterval = previousSetInterval;
    global.clearInterval = previousClearInterval;
  }
});
