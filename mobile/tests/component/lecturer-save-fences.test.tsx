import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { fillCopy } from '../../src/i18n/academic-messages';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';
import { campusIsoDate } from '../../src/i18n/locale';

const mockRuntime = {
  mode: 'live' as 'live' | 'preview',
  queries: {} as Record<string, unknown>,
  reloads: {} as Record<string, ReturnType<typeof jest.fn>>,
  saveAttendance: jest.fn(async (..._args: unknown[]) => 1),
  saveGrades: jest.fn(async (..._args: unknown[]) => undefined),
};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockRuntime.mode }; },
  campusApi: {},
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => ({
    data: mockRuntime.queries[key],
    error: null,
    warning: null,
    errorStatus: null,
    isLoading: false,
    isStale: false,
    reload: mockRuntime.reloads[key] ?? (mockRuntime.reloads[key] = jest.fn(async () => {})),
    setData: jest.fn(),
  }),
}));
jest.mock('../../src/screens/operations/lecturer-api', () => ({
  StaleAttendanceError: class StaleAttendanceError extends Error {},
  lecturerApi: {
    schedule: jest.fn(async () => []),
    gradingSections: jest.fn(async () => []),
    attendanceSheet: jest.fn(async () => ({ sectionId: '', date: '', roster: [], marks: [] })),
    saveAttendance: (...args: unknown[]) => mockRuntime.saveAttendance(...args),
    sectionGrades: jest.fn(async () => []),
    saveGrades: (...args: unknown[]) => mockRuntime.saveGrades(...args),
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
jest.mock('../../src/screens/lanes/LaneEntries', () => ({ LaneEntries: () => null }));

import { LecturerDashboardScreen } from '../../src/screens/operations/LecturerDashboardScreen';
import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';
import { LecturerScheduleScreen } from '../../src/screens/operations/LecturerScheduleScreen';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function pressTwiceBeforeCommit(button: unknown) {
  const originalError = console.error;
  const warning = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('overlapping act() calls')) return;
    originalError(message, ...args);
  });
  try {
    await act(async () => {
      fireEvent.press(button as never);
      fireEvent.press(button as never);
    });
  } finally {
    warning.mockRestore();
  }
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
const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const screenElement = (element: ReactElement, locale: 'vi' | 'en' = 'vi') =>
  <LocaleProvider initialLocale={locale}>
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>;
const renderScreen = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => render(screenElement(element, locale));

beforeEach(() => {
  mockRuntime.mode = 'live';
  mockRuntime.reloads = {};
  mockRuntime.queries = {
    'lecturer:schedule': sections,
    [`lecturer:sheet:section-a:${today}`]: attendanceSheetA,
    [`lecturer:sheet:section-b:${today}`]: attendanceSheetB,
    'lecturer:grading': sections,
    'lecturer:grades:section-a': gradeSheetA,
    'lecturer:grades:section-b': gradeSheetB,
  };
  mockRuntime.saveAttendance.mockReset().mockResolvedValue(1);
  mockRuntime.saveGrades.mockReset().mockResolvedValue(undefined);
});

test('lecturer dashboard pull-to-refresh reloads both dashboard queries', async () => {
  await renderScreen(<LecturerDashboardScreen {...props} />);
  await fireEvent.press(screen.getByTestId('pull-to-refresh'));
  expect(mockRuntime.reloads['lecturer:schedule']).toHaveBeenCalledTimes(1);
  expect(mockRuntime.reloads['lecturer:grading']).toHaveBeenCalledTimes(1);
});

test('lecturer schedule pull-to-refresh reloads its schedule query', async () => {
  await renderScreen(<LecturerScheduleScreen {...props} />);
  await fireEvent.press(screen.getByTestId('pull-to-refresh'));
  expect(mockRuntime.reloads['lecturer:schedule']).toHaveBeenCalledTimes(1);
});

test('lecturer grading pull-to-refresh reloads sections and the active grade sheet', async () => {
  await renderScreen(<LecturerGradingScreen {...props} />);
  await fireEvent.press(screen.getByTestId('pull-to-refresh'));
  expect(mockRuntime.reloads['lecturer:grading']).toHaveBeenCalledTimes(1);
  expect(mockRuntime.reloads['lecturer:grades:section-a']).toHaveBeenCalledTimes(1);
});

test('lecturer attendance pull-to-refresh reloads the active sheet', async () => {
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await fireEvent.press(screen.getByTestId('pull-to-refresh'));
  expect(mockRuntime.reloads[`lecturer:sheet:section-a:${today}`]).toHaveBeenCalledTimes(1);
});

test('attendance pull-to-refresh reloads sections and the sheet, and the spinner tracks exactly that refresh', async () => {
  const sectionsPending = deferred<void>();
  const sheetPending = deferred<void>();
  mockRuntime.reloads['lecturer:schedule'] = jest.fn(() => sectionsPending.promise);
  mockRuntime.reloads[`lecturer:sheet:section-a:${today}`] = jest.fn(() => sheetPending.promise);

  await renderScreen(<LecturerAttendanceScreen {...props} />);
  expect(screen.getByTestId('refresh-state')).toHaveTextContent('idle');

  await fireEvent.press(screen.getByTestId('pull-to-refresh'));
  expect(mockRuntime.reloads['lecturer:schedule']).toHaveBeenCalledTimes(1);
  expect(mockRuntime.reloads[`lecturer:sheet:section-a:${today}`]).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('refresh-state')).toHaveTextContent('refreshing');

  await act(async () => {
    sectionsPending.resolve();
    sheetPending.resolve();
    await Promise.all([sectionsPending.promise, sheetPending.promise]);
  });
  expect(screen.getByTestId('refresh-state')).toHaveTextContent('idle');
});

test('a deferred attendance save does not apply section A state to section B', async () => {
  const pending = deferred<number>();
  mockRuntime.saveAttendance.mockReturnValueOnce(pending.promise);
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  const markAbsent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha',
    status: operationsMessages.vi.statusAbsent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markAbsent }));
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.vi.save }));
  expect(mockRuntime.saveAttendance).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole('button', { name: 'Select section-b' }));
  await screen.findByText('Bravo');
  await act(async () => {
    pending.resolve(1);
    await pending.promise;
  });

  expect(screen.queryByText(fillCopy(operationsMessages.vi.saved, { n: 1 }))).toBeNull();
  expect(screen.queryByText(fillCopy(operationsMessages.vi.unsavedOne, { n: 1 }))).toBeNull();
  expect(screen.getByText('Bravo')).toBeTruthy();
});

test('same-frame repeated attendance save sends one request', async () => {
  const pending = deferred<number>();
  mockRuntime.saveAttendance.mockReturnValueOnce(pending.promise);
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');
  const markAbsent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha',
    status: operationsMessages.vi.statusAbsent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markAbsent }));

  try {
    await pressTwiceBeforeCommit(screen.getByRole('button', { name: operationsMessages.vi.save }));
    expect(mockRuntime.saveAttendance).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      pending.resolve(1);
      await pending.promise;
    });
  }
});

test('an attendance save for a revisited sheet preserves its current baseline', async () => {
  const pending = deferred<number>();
  mockRuntime.saveAttendance.mockReturnValueOnce(pending.promise);
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  const markAbsent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha',
    status: operationsMessages.vi.statusAbsent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markAbsent }));
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.vi.save }));
  await fireEvent.press(screen.getByRole('button', { name: 'Select section-b' }));
  await screen.findByText('Bravo');
  await fireEvent.press(screen.getByRole('button', { name: 'Select section-a' }));
  await screen.findByText('Alpha');

  await act(async () => {
    pending.resolve(1);
    await pending.promise;
  });

  expect(screen.getByText(fillCopy(operationsMessages.vi.saved, { n: 1 }))).toBeTruthy();
  expect(screen.queryByText(fillCopy(operationsMessages.vi.unsavedOne, { n: 1 }))).toBeNull();
});

test('reverting an attendance draft to baseline removes the cached edits', async () => {
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  const markPresent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha', status: operationsMessages.vi.statusPresent,
  });
  const markAbsent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha', status: operationsMessages.vi.statusAbsent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markAbsent }));
  await fireEvent.press(screen.getByRole('radio', { name: markPresent }));
  expect(screen.queryByText(fillCopy(operationsMessages.vi.unsavedOne, { n: 1 }))).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Select section-b' }));
  await screen.findByText('Bravo');
  await fireEvent.press(screen.getByRole('button', { name: 'Select section-a' }));
  await screen.findByText('Alpha');

  expect(screen.getByRole('radio', { name: markPresent }).props.accessibilityState?.checked).toBe(true);
});

test('mark all present confirms before replacing an unsaved attendance mark', async () => {
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  const markAbsent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha', status: operationsMessages.vi.statusAbsent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markAbsent }));
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.vi.markAllPresent }));

  expect(await screen.findByText(operationsMessages.vi.discardUnsavedTitle)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: markAbsent }).props.accessibilityState?.checked).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(screen.getByRole('radio', {
    name: fillCopy(operationsMessages.vi.markStatusFor, { name: 'Alpha', status: operationsMessages.vi.statusPresent }),
  }).props.accessibilityState?.checked).toBe(true);
});

test('stale attendance reload confirms before discarding the local marks', async () => {
  const sheetWith = (status: string, notes: string) => ({
    sectionId: 'section-a', date: today,
    roster: [{ studentId: 'a1', studentCode: 'A1', firstName: 'Alpha' }],
    marks: [{ studentId: 'a1', status, notes }],
  });
  mockRuntime.queries[`lecturer:sheet:section-a:${today}`] = sheetWith('EXCUSED', 'sick');
  const view = await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');
  const markPresent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha', status: operationsMessages.vi.statusPresent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markPresent }));

  mockRuntime.queries[`lecturer:sheet:section-a:${today}`] = sheetWith('ABSENT', 'medical leave');
  await view.rerender(screenElement(<LecturerAttendanceScreen {...props} />));
  await screen.findByText(operationsMessages.vi.stale);
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.vi.reload }));

  expect(await screen.findByText(operationsMessages.vi.discardUnsavedTitle)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: markPresent }).props.accessibilityState?.checked).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(screen.getByRole('radio', {
    name: fillCopy(operationsMessages.vi.markStatusFor, { name: 'Alpha', status: operationsMessages.vi.statusAbsent }),
  }).props.accessibilityState?.checked).toBe(true);
});

test.each([
  ['success', false],
  ['failure', true],
])('a deferred grading %s for section A does not message section B', async (_outcome, shouldReject) => {
  const pending = deferred<undefined>();
  mockRuntime.saveGrades.mockReturnValueOnce(pending.promise);
  await renderScreen(<LecturerGradingScreen {...props} />, 'en');
  const processLabel = `${fillCopy(operationsMessages.en.gradeRowLabel, { name: 'Alpha' })}, ${operationsMessages.en.process}`;
  await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.en.saveScores }));
  expect(mockRuntime.saveGrades).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole('button', { name: 'Select section-b' }));
  await screen.findByText('Bravo');
  const processLabelB = `${fillCopy(operationsMessages.en.gradeRowLabel, { name: 'Bravo' })}, ${operationsMessages.en.process}`;
  const processInputB = await screen.findByLabelText(processLabelB);
  await fireEvent.changeText(processInputB, '8');
  await act(async () => {
    if (shouldReject) pending.reject(new Error('save failed'));
    else pending.resolve(undefined);
    await pending.promise.catch(() => undefined);
  });

  expect(screen.queryByText(fillCopy(operationsMessages.en.scoresSavedOne, { n: 1 }))).toBeNull();
  expect(screen.queryByText(operationsMessages.en.saveScoresFailed)).toBeNull();
  expect(screen.getByText('Bravo')).toBeTruthy();
  expect(screen.getByLabelText(processLabelB).props.value).toBe('8');
  await waitFor(() => expect(mockRuntime.saveGrades).toHaveBeenCalledTimes(1));
});

test('same-frame repeated grading save sends one request', async () => {
  const pending = deferred<undefined>();
  mockRuntime.saveGrades.mockReturnValueOnce(pending.promise);
  await renderScreen(<LecturerGradingScreen {...props} />, 'en');
  const processLabel = `${fillCopy(operationsMessages.en.gradeRowLabel, { name: 'Alpha' })}, ${operationsMessages.en.process}`;
  await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');

  try {
    await pressTwiceBeforeCommit(screen.getByRole('button', { name: operationsMessages.en.saveScores }));
    expect(mockRuntime.saveGrades).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
  }
});

test('a grading save for a revisited section preserves its new draft', async () => {
  const pending = deferred<undefined>();
  mockRuntime.saveGrades.mockReturnValueOnce(pending.promise);
  await renderScreen(<LecturerGradingScreen {...props} />, 'en');
  const processLabelA = `${fillCopy(operationsMessages.en.gradeRowLabel, { name: 'Alpha' })}, ${operationsMessages.en.process}`;
  await fireEvent.changeText(await screen.findByLabelText(processLabelA), '7');
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.en.saveScores }));

  await fireEvent.press(screen.getByRole('button', { name: 'Select section-b' }));
  await screen.findByText('Bravo');
  await fireEvent.press(screen.getByRole('button', { name: 'Select section-a' }));
  await screen.findByText('Alpha');
  const processInputA = await screen.findByLabelText(processLabelA);
  await fireEvent.changeText(processInputA, '8');

  await act(async () => {
    pending.resolve(undefined);
    await pending.promise;
  });

  expect(screen.getByText(fillCopy(operationsMessages.en.scoresSavedOne, { n: 1 }))).toBeTruthy();
  expect(screen.getByLabelText(processLabelA).props.value).toBe('8');
});

test('a note-only server edit is stale and keeps the attendance draft', async () => {
  const sheetWithNote = (notes: string) => ({
    sectionId: 'section-a',
    date: today,
    roster: [{ studentId: 'a1', studentCode: 'A1', firstName: 'Alpha' }],
    marks: [{ studentId: 'a1', status: 'EXCUSED', notes }],
  });
  mockRuntime.queries[`lecturer:sheet:section-a:${today}`] = sheetWithNote('sick');
  const view = await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  const markPresent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha',
    status: operationsMessages.vi.statusPresent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markPresent }));

  mockRuntime.queries[`lecturer:sheet:section-a:${today}`] = sheetWithNote('medical leave');
  await view.rerender(screenElement(<LecturerAttendanceScreen {...props} />));

  expect(screen.getByText(operationsMessages.vi.stale)).toBeTruthy();
  expect(screen.getByText(fillCopy(operationsMessages.vi.unsavedOne, { n: 1 }))).toBeTruthy();
  expect(screen.getByRole('radio', { name: markPresent }).props.accessibilityState?.checked).toBe(true);
});

test('attendance refresh during a pending save preserves the dirty rows and baseline', async () => {
  const pending = deferred<number>();
  mockRuntime.saveAttendance.mockReturnValueOnce(pending.promise);
  const view = await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  const markAbsent = fillCopy(operationsMessages.vi.markStatusFor, {
    name: 'Alpha',
    status: operationsMessages.vi.statusAbsent,
  });
  await fireEvent.press(screen.getByRole('radio', { name: markAbsent }));
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.vi.save }));
  expect(mockRuntime.saveAttendance).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId('pull-to-refresh'));
  mockRuntime.queries[`lecturer:sheet:section-a:${today}`] = {
    ...attendanceSheetA,
    roster: [{ ...attendanceSheetA.roster[0], firstName: 'Remote Alpha' }],
    marks: [{ studentId: 'a1', status: 'ABSENT' }],
  };
  await view.rerender(screenElement(<LecturerAttendanceScreen {...props} />));

  expect(screen.getByText('Alpha')).toBeTruthy();
  expect(screen.queryByText('Remote Alpha')).toBeNull();
  expect(screen.getByText(operationsMessages.vi.stale)).toBeTruthy();
  expect(screen.getByText(fillCopy(operationsMessages.vi.unsavedOne, { n: 1 }))).toBeTruthy();
  expect(screen.getByRole('radio', { name: markAbsent }).props.accessibilityState?.checked).toBe(true);

  await act(async () => {
    pending.resolve(1);
    await pending.promise;
  });
});

test('grading refresh during a pending save preserves the dirty rows and baseline', async () => {
  const pending = deferred<undefined>();
  mockRuntime.saveGrades.mockReturnValueOnce(pending.promise);
  const view = await renderScreen(<LecturerGradingScreen {...props} />, 'en');
  const processLabel = `${fillCopy(operationsMessages.en.gradeRowLabel, { name: 'Alpha' })}, ${operationsMessages.en.process}`;
  await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
  await fireEvent.press(screen.getByRole('button', { name: operationsMessages.en.saveScores }));
  expect(mockRuntime.saveGrades).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId('pull-to-refresh'));
  mockRuntime.queries['lecturer:grades:section-a'] = {
    ...gradeSheetA,
    rows: [{ ...gradeSheetA.rows[0], studentName: 'Remote Alpha', processScore: 6 }],
  };
  await view.rerender(screenElement(<LecturerGradingScreen {...props} />, 'en'));

  expect(screen.getByLabelText(processLabel).props.value).toBe('7');
  expect(screen.getByText('Alpha')).toBeTruthy();
  expect(screen.queryByText('Remote Alpha')).toBeNull();
  expect(screen.getByText(operationsMessages.en.gradesStale)).toBeTruthy();
  expect(screen.getByText(fillCopy(operationsMessages.en.changesCountOne, { n: 1 }))).toBeTruthy();

  await act(async () => {
    pending.resolve(undefined);
    await pending.promise;
  });
});
