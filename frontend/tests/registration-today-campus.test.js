const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRuntime,
  elements,
  installBrowserEnv,
  loadTs,
  textOf,
} = require('./dashboard-shell-harness');

const iconStub = new Proxy(
  {},
  { get: (_target, property) => (property === '__esModule' ? true : () => null) },
);

const labels = {
  gridAriaLabel: 'Timetable',
  today: 'Today',
  sectionPrefix: 'Section',
  roomPending: 'Room pending',
  noSlot: 'No meetings',
  blockHint: '',
  item: 'meeting',
  items: 'meetings',
};

function loadGrid(runtime) {
  return loadTs('src/components/schedule/weekly-grid.tsx', {
    react: runtime.fakeReact,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': iconStub,
    '@/lib/campus-day': loadTs('src/lib/campus-day.ts', { react: runtime.fakeReact }, { cache: false }),
  }, { cache: false });
}

function headersWithToday(tree) {
  return elements(tree).filter(
    (element) => element.props?.role === 'columnheader' && textOf(element).includes(labels.today),
  );
}

function renderToday(Component, runtime) {
  let current = null;
  for (let index = 0; index < 4; index += 1) {
    const rendered = runtime.render(Component, {
      items: [],
      locale: 'en',
      labels,
    });
    runtime.runEffects(rendered.effects);
    current = rendered.tree;
  }
  return current;
}

// The fixed instant is Monday 09:30 in Los Angeles but already Tuesday 00:30
// on the campus calendar, so a device-zone fallback badges the wrong column.
const INSTANT = '2026-11-02T17:30:00Z';

test('the timetable fallback reads the campus day west of campus', (t) => {
  process.env.TZ = 'America/Los_Angeles';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(INSTANT) });

  try {
    assert.equal(new Date().getDay(), 1, 'the viewer calendar is still Monday');
    const { campusDayOfWeek } = loadTs('src/lib/campus-day.ts');
    assert.equal(campusDayOfWeek(), 3, 'the campus calendar is already Tuesday');

    const { windowStub } = installBrowserEnv();
    windowStub.setTimeout = () => 1;
    windowStub.clearTimeout = () => {};

    const runtime = createRuntime();
    const { WeeklyGrid } = loadGrid(runtime);
    const tree = renderToday(WeeklyGrid, runtime);

    const todayHeaders = headersWithToday(tree);
    assert.equal(todayHeaders.length, 1, 'exactly one day is badged today');
    assert.match(textOf(todayHeaders[0]), /^Tuesday/, 'the campus Tuesday is badged, not the device Monday');
  } finally {
    t.mock.timers.reset();
  }
});

test('the timetable fallback keeps the campus day when the device matches it', (t) => {
  process.env.TZ = 'Asia/Ho_Chi_Minh';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(INSTANT) });

  try {
    assert.equal(new Date().getDay(), 2, 'the viewer calendar is Tuesday in campus time');

    const { windowStub } = installBrowserEnv();
    windowStub.setTimeout = () => 1;
    windowStub.clearTimeout = () => {};

    const runtime = createRuntime();
    const { WeeklyGrid } = loadGrid(runtime);
    const tree = renderToday(WeeklyGrid, runtime);

    const todayHeaders = headersWithToday(tree);
    assert.equal(todayHeaders.length, 1, 'exactly one day is badged today');
    assert.match(textOf(todayHeaders[0]), /^Tuesday/);
  } finally {
    t.mock.timers.reset();
  }
});
