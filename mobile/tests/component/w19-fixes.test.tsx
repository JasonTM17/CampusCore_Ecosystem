import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { Linking, Platform } from 'react-native';

// RNTL v14's async render needs the act environment flag; jest-expo does not set it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface QueryStub {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  isLoading?: boolean;
  isStale?: boolean;
}

const mockRuntime = {
  mode: 'live' as 'live' | 'preview',
  queries: {} as Record<string, QueryStub>,
  reloads: {} as Record<string, ReturnType<typeof jest.fn>>,
  stale: false,
};

const mockAcademic = {
  isDeviceOffline: jest.fn<() => Promise<boolean>>(),
  enrollInSection: jest.fn<(sectionId: string, locale: string) => Promise<void>>(),
  dropEnrollmentById: jest.fn<(enrollmentId: string) => Promise<void>>(),
};

const mockLane = {
  creditApplications: jest.fn<(status: string) => Promise<unknown[]>>(),
};

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true };

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockRuntime.mode }; },
  campusApi: {},
}));
jest.mock('expo-router', () => {
  const { useEffect } = require('react') as typeof import('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
    useLocalSearchParams: () => ({}),
    useRouter: () => mockRouter,
  };
});
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const state = mockRuntime.queries[key] ?? {};
    const reload = mockRuntime.reloads[key] ?? (mockRuntime.reloads[key] = jest.fn(async () => {}));
    return {
      data: state.data,
      error: state.error ?? null,
      warning: state.warning ?? null,
      errorStatus: null,
      isLoading: state.isLoading ?? false,
      isStale: state.isStale ?? mockRuntime.stale,
      reload,
      setData: jest.fn(),
    };
  },
}));
jest.mock('../../src/screens/operations/lecturer-api', () => ({
  StaleAttendanceError: class StaleAttendanceError extends Error {},
  lecturerApi: {
    schedule: jest.fn(async () => []),
    gradingSections: jest.fn(async () => []),
    attendanceSheet: jest.fn(async () => ({ sectionId: '', date: '', roster: [], marks: [] })),
    saveAttendance: jest.fn(async () => 0),
    sectionGrades: jest.fn(async () => ({ sectionId: '', rows: [] })),
    saveGrades: jest.fn(async () => undefined),
    publishGrades: jest.fn(async () => undefined),
  },
}));
jest.mock('../../src/screens/operations/lecturer-ui', () => {
  const React = require('react') as typeof import('react');
  const Native = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('../../src/screens/operations/lecturer-ui') as typeof import('../../src/screens/operations/lecturer-ui');
  return {
    ...actual,
    OpsShell: ({ children, list, onRefresh, refreshing }: {
      children: ReactNode;
      onRefresh?: () => void;
      refreshing?: boolean;
      list?: {
        data: readonly unknown[];
        renderItem: (info: { item: unknown; index: number }) => ReactNode;
        footer?: ReactNode;
      };
    }) => React.createElement(
      Native.View,
      null,
      onRefresh ? React.createElement(Native.Pressable, {
        testID: 'pull-to-refresh',
        accessibilityRole: 'button',
        accessibilityLabel: 'Pull to refresh',
        onPress: onRefresh,
      }) : null,
      React.createElement(Native.Text, { testID: 'refresh-state' }, refreshing ? 'refreshing' : 'idle'),
      children,
      ...(list?.data.map((item, index) => React.createElement(
        React.Fragment,
        { key: String(index) },
        list.renderItem({ item, index }),
      )) ?? []),
      list?.footer,
    ),
    SectionPicker: ({ sections, onChange }: {
      sections: readonly { sectionId: string }[];
      value: string;
      onChange: (sectionId: string) => void;
    }) => React.createElement(
      Native.View,
      null,
      ...sections.map((section) => React.createElement(
        Native.Pressable,
        {
          key: section.sectionId,
          accessibilityRole: 'button',
          accessibilityLabel: `Select ${section.sectionId}`,
          onPress: () => onChange(section.sectionId),
        },
        React.createElement(Native.Text, null, section.sectionId),
      )),
    ),
    CsvExport: () => null,
    HandoffButton: () => null,
  };
});
jest.mock('../../src/screens/academic/academic-api', () => ({
  academicApi: {
    semesters: jest.fn(async () => []),
    attendanceSummary: jest.fn(async () => []),
    attendanceRecords: jest.fn(async () => []),
    enrollments: jest.fn(async () => []),
  },
  isDeviceOffline: () => mockAcademic.isDeviceOffline(),
  enrollInSection: (sectionId: string, locale: string) => mockAcademic.enrollInSection(sectionId, locale),
  dropEnrollmentById: (enrollmentId: string) => mockAcademic.dropEnrollmentById(enrollmentId),
  isOfflineError: (error: unknown) => (error as { status?: number } | null)?.status === 0 || error instanceof TypeError,
}));
jest.mock('../../src/screens/attendance-checkin/CheckinEntryCard', () => ({ CheckinEntryCard: () => null }));
jest.mock('../../src/screens/lanes/lane-api', () => ({
  LANE_PAGE_SIZE: 20,
  laneApi: {
    creditApplications: (status: string) => mockLane.creditApplications(status),
  },
}));

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { fillCopy } from '../../src/i18n/academic-messages';
import { academicMessages } from '../../src/i18n/academic-messages';
import { checkinMessages } from '../../src/i18n/checkin-messages';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';
import type { CheckinMachine } from '../../src/attendance-checkin/checkin-machine';
import { campusIsoDate } from '../../src/i18n/locale';
import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';
import { AdminCreditLimitsScreen } from '../../src/screens/lanes/AdminLaneScreens';
import { AttendanceScreen } from '../../src/screens/student/AttendanceScreen';
import { EnrollmentWorkspace } from '../../src/screens/academic/EnrollmentWorkspace';
import { useRegistrationActions } from '../../src/screens/academic/useRegistrationActions';
import { CheckinScreen } from '../../src/screens/attendance-checkin/CheckinScreen';
import { StudentDashboardScreen } from '../../src/screens/student/StudentDashboardScreen';

const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const themed = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => (
  <LocaleProvider initialLocale={locale}>
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const sections = [
  { sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS-A', courseNameVi: 'Course A', courseNameEn: 'Course A' },
  { sectionId: 'section-b', sectionNumber: '02', courseCode: 'CS-B', courseNameVi: 'Course B', courseNameEn: 'Course B' },
];
const today = campusIsoDate();
const attendanceSheetA = {
  sectionId: 'section-a', date: today,
  roster: [{ studentId: 'a1', studentCode: 'A1', firstName: 'Alpha' }], marks: [],
};
const attendanceSheetB = {
  sectionId: 'section-b', date: today,
  roster: [{ studentId: 'b1', studentCode: 'B1', firstName: 'Bravo' }],
  marks: [{ studentId: 'b1', status: 'ABSENT' }],
};
const gradeSheetA = {
  sectionId: 'section-a',
  rows: [{ enrollmentId: 'ea', studentName: 'Alpha', studentCode: 'A1', processScore: null, finalExamScore: null, gradeStatus: 'DRAFT' }],
};
const gradeSheetB = {
  sectionId: 'section-b',
  rows: [{ enrollmentId: 'eb', studentName: 'Bravo', studentCode: 'B1', processScore: null, finalExamScore: null, gradeStatus: 'DRAFT' }],
};
const summaryRows = [{
  sectionId: 'section-a', courseCode: 'CS101', courseName: 'Introduction', total: 10,
  present: 8, absent: 2, late: 0, excused: 0, attendanceRate: 80,
}];

beforeEach(() => {
  mockRuntime.mode = 'live';
  mockRuntime.queries = {};
  mockRuntime.reloads = {};
  mockRuntime.stale = false;
  mockAcademic.isDeviceOffline.mockReset().mockResolvedValue(false);
  mockAcademic.enrollInSection.mockReset().mockResolvedValue(undefined);
  mockAcademic.dropEnrollmentById.mockReset().mockResolvedValue(undefined);
  mockLane.creditApplications.mockReset().mockResolvedValue([]);
  mockRouter.back.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('lecturer attendance keeps dirty marks per sheet', () => {
  test('a section change keeps the unsaved marks and restores them on return', async () => {
    mockRuntime.queries = {
      'lecturer:schedule': { data: sections },
      [`lecturer:sheet:section-a:${today}`]: { data: attendanceSheetA },
      [`lecturer:sheet:section-b:${today}`]: { data: attendanceSheetB },
    };
    await render(themed(<LecturerAttendanceScreen {...props} />));
    await screen.findByText('Alpha');

    const markPresent = fillCopy(operationsMessages.vi.markStatusFor, {
      name: 'Alpha',
      status: operationsMessages.vi.statusPresent,
    });
    await fireEvent.press(screen.getByRole('radio', { name: markPresent }));
    await fireEvent.press(screen.getByRole('button', { name: 'Select section-b' }));
    await screen.findByText('Bravo');
    await fireEvent.press(screen.getByRole('button', { name: 'Select section-a' }));
    await screen.findByText('Alpha');

    expect(screen.getByText(fillCopy(operationsMessages.vi.unsaved, { n: 1 }))).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: markPresent }).props.accessibilityState?.checked).toBe(true);
  });
});

describe('lecturer grading keeps dirty edits per section', () => {
  test('a section change keeps the typed score and restores it on return', async () => {
    mockRuntime.queries = {
      'lecturer:grading': { data: sections },
      'lecturer:grades:section-a': { data: gradeSheetA },
      'lecturer:grades:section-b': { data: gradeSheetB },
    };
    await render(themed(<LecturerGradingScreen {...props} />));
    const processLabel = `${fillCopy(operationsMessages.vi.gradeRowLabel, { name: 'Alpha' })}, ${operationsMessages.vi.process}`;
    await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
    expect(screen.getByText(fillCopy(operationsMessages.vi.changesCount, { n: 1 }))).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Select section-b' }));
    await screen.findByText('Bravo');
    await fireEvent.press(screen.getByRole('button', { name: 'Select section-a' }));
    await screen.findByText('Alpha');

    expect(screen.getByLabelText(processLabel).props.value).toBe('7');
    expect(screen.getByText(fillCopy(operationsMessages.vi.changesCount, { n: 1 }))).toBeOnTheScreen();
  });
});

describe('credit-limit All filter', () => {
  test('selecting All sends the server-supported ALL value', async () => {
    await render(themed(<AdminCreditLimitsScreen />, 'en'));
    await screen.findByLabelText('Status: Pending');
    expect(mockLane.creditApplications).toHaveBeenCalledWith('PENDING');

    await fireEvent.press(screen.getByLabelText('Status: Pending'));
    await fireEvent.press(screen.getByRole('radio', { name: 'All' }));

    await waitFor(() => expect(mockLane.creditApplications).toHaveBeenLastCalledWith('ALL'));
  });
});

describe('attendance records read has its own state', () => {
  test('a failed records read shows a retryable error instead of the empty state', async () => {
    mockRuntime.queries = {
      'academic.semesters': { data: [] },
      'academic.attendance.summary.': { data: summaryRows },
      'academic.attendance.records.': { error: 'Records unavailable' },
    };
    await render(themed(<AttendanceScreen {...props} />));

    expect(await screen.findByText('Records unavailable')).toBeOnTheScreen();
    expect(screen.queryByText(academicMessages.vi.noRecords)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: academicMessages.vi.retry }));
    expect(mockRuntime.reloads['academic.attendance.records.']).toHaveBeenCalled();
  });

  test('a stale records warning is shown above the list', async () => {
    mockRuntime.queries = {
      'academic.semesters': { data: [] },
      'academic.attendance.summary.': { data: summaryRows },
      'academic.attendance.records.': {
        data: [{ id: 'r1', date: '2026-10-30', status: 'PRESENT' }],
        warning: 'Records are stale',
      },
    };
    await render(themed(<AttendanceScreen {...props} />));

    expect(await screen.findByText('Records are stale')).toBeOnTheScreen();
  });

  test('the records read shows its own loading state', async () => {
    mockRuntime.queries = {
      'academic.semesters': { data: [] },
      'academic.attendance.summary.': { data: summaryRows },
      'academic.attendance.records.': { isLoading: true },
    };
    await render(themed(<AttendanceScreen {...props} />));

    expect(await screen.findByText(academicMessages.vi.loading)).toBeOnTheScreen();
    expect(screen.queryByText(academicMessages.vi.noRecords)).toBeNull();
  });
});

describe('attendance term list failure', () => {
  test('a failed semesters read is shown with its own retry', async () => {
    mockRuntime.queries = {
      'academic.semesters': { error: 'Terms unavailable' },
      'academic.attendance.summary.': { data: [] },
      'academic.attendance.records.': { data: [] },
    };
    await render(themed(<AttendanceScreen {...props} />, 'en'));

    expect(await screen.findByText('Terms unavailable')).toBeOnTheScreen();
    expect(screen.queryByText(academicMessages.en.term)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: academicMessages.en.retry }));
    expect(mockRuntime.reloads['academic.semesters']).toHaveBeenCalled();
  });
});

describe('registration in-flight guard', () => {
  test('two taps during the offline probe start only one enroll loop', async () => {
    const gate = deferred<boolean>();
    mockAcademic.isDeviceOffline.mockReturnValue(gate.promise);
    const catalogIds = ['s1'];
    const reload = jest.fn(async () => {});
    let latest: ReturnType<typeof useRegistrationActions> | null = null;

    function Harness() {
      latest = useRegistrationActions({
        copy: academicMessages.en,
        locale: 'en',
        preview: false,
        knownOffline: false,
        reload,
        catalogIds,
      });
      return null;
    }

    await render(<Harness />);
    await act(async () => { latest!.dispatch({ type: 'toggle', sectionId: 's1' }); });
    expect(latest!.basket.selected).toEqual(['s1']);

    await act(async () => {
      const first = latest!.registerSelected();
      const second = latest!.registerSelected();
      gate.resolve(false);
      await Promise.all([first, second]);
    });

    expect(mockAcademic.enrollInSection).toHaveBeenCalledTimes(1);
    expect(latest!.busy).toBe(false);
  });
});

describe('grading pull spinner', () => {
  test('a background stale fetch does not show the pull spinner', async () => {
    mockRuntime.stale = true;
    const sectionsPending = deferred<void>();
    const gradesPending = deferred<void>();
    mockRuntime.queries = {
      'lecturer:grading': { data: sections },
      'lecturer:grades:section-a': { data: gradeSheetA },
    };
    mockRuntime.reloads['lecturer:grading'] = jest.fn(() => sectionsPending.promise);
    mockRuntime.reloads['lecturer:grades:section-a'] = jest.fn(() => gradesPending.promise);

    await render(themed(<LecturerGradingScreen {...props} />));
    expect(screen.getByTestId('refresh-state')).toHaveTextContent('idle');

    await fireEvent.press(screen.getByTestId('pull-to-refresh'));
    expect(screen.getByTestId('refresh-state')).toHaveTextContent('refreshing');

    await act(async () => {
      sectionsPending.resolve();
      gradesPending.resolve();
      await Promise.all([sectionsPending.promise, gradesPending.promise]);
    });
    expect(screen.getByTestId('refresh-state')).toHaveTextContent('idle');
  });
});

describe('enrollment workspace semester read', () => {
  const enrollment = {
    id: 'e1', sectionId: 's1', semesterId: 'sem-1', status: 'ENROLLED',
    section: {
      id: 's1', sectionNumber: '01', semesterId: 'sem-1', capacity: 40, enrolledCount: 1, status: 'OPEN',
      course: { code: 'CS101', name: 'Introduction' },
    },
  };

  test('a failed semesters read is shown with its own retry', async () => {
    mockRuntime.queries = {
      'academic.enrollments': { data: [enrollment] },
      'academic.semesters': { error: 'Terms unavailable' },
    };
    await render(themed(<EnrollmentWorkspace navigation={navigation} title="enrollmentsTitle" />, 'en'));

    expect(await screen.findByText('Terms unavailable')).toBeOnTheScreen();
    expect(screen.queryByText(academicMessages.en.term)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: academicMessages.en.retry }));
    expect(mockRuntime.reloads['academic.semesters']).toHaveBeenCalled();
  });

  test('a semesters warning is merged into the banner', async () => {
    mockRuntime.queries = {
      'academic.enrollments': { data: [enrollment] },
      'academic.semesters': { data: [], warning: 'Term list is stale' },
    };
    await render(themed(<EnrollmentWorkspace navigation={navigation} title="enrollmentsTitle" />, 'en'));

    expect(await screen.findByText('Term list is stale')).toBeOnTheScreen();
  });
});

describe('check-in location settings fallback', () => {
  test('a failing intent and failing app settings never leave an unhandled rejection', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockRejectedValue(new Error('no intent'));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('no settings'));
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => { rejections.push(reason); };
    process.on('unhandledRejection', onRejection);

    const machine: CheckinMachine = {
      getSnapshot: () => ({ state: { type: 'servicesOff' }, sessions: [], selectedSession: null }),
      subscribe: () => () => {},
      loadSessions: async () => {},
      selectSession: async () => {},
      acceptConsent: async () => {},
      acquireLocation: async () => {},
      submit: async () => {},
      reset: () => {},
    };

    try {
      await render(themed(<CheckinScreen {...props} machine={machine} />));
      await fireEvent.press(screen.getByRole('button', { name: checkinMessages.vi.openLocationSettings }));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(sendIntent).toHaveBeenCalledWith('android.settings.LOCATION_SOURCE_SETTINGS');
      expect(openSettings).toHaveBeenCalled();
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
      platform.restore();
    }
  });
});

describe('dashboard next meetings', () => {
  const enrollmentAt = (id: string, code: string, dayOfWeek: number, startTime: string, endTime: string) => ({
    id, sectionId: `sec-${id}`, semesterId: 'sem-1', status: 'ENROLLED',
    section: {
      id: `sec-${id}`, sectionNumber: '01', semesterId: 'sem-1', capacity: 40, enrolledCount: 1, status: 'OPEN',
      course: { code, name: code },
      schedules: [{ dayOfWeek, startTime, endTime }],
    },
  });

  test('it lists the next meetings from now instead of the first three enrollments', async () => {
    jest.useFakeTimers({
      now: new Date(2026, 10, 7, 9, 0, 0),
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
    });
    try {
      mockRuntime.queries = {
        'academic.enrollments': {
          data: [
            enrollmentAt('a', 'A101', 2, '07:00', '08:30'), // Monday, still ahead
            enrollmentAt('b', 'B202', 7, '10:00', '11:30'), // Saturday, next
            enrollmentAt('c', 'C303', 7, '11:00', '12:30'), // Saturday, after B
            enrollmentAt('d', 'D404', 1, '09:00', '10:30'), // Sunday, third
          ],
        },
        announcements: { data: { data: [] } },
      };

      await render(themed(<StudentDashboardScreen {...props} />, 'en'));

      expect(screen.getByText('D404')).toBeOnTheScreen();
      expect(screen.queryByText('A101')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
