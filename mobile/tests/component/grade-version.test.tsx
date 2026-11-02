import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { fillCopy } from '../../src/i18n/academic-messages';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

// RNTL v14's async render needs the act environment flag; jest-expo does not set it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface QueryStub {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  isLoading?: boolean;
  isStale?: boolean;
}

type SaveCall = [string, Array<Record<string, unknown>>];

const mockRuntime = {
  mode: 'live' as 'live' | 'preview',
  queries: {} as Record<string, QueryStub>,
  reloads: {} as Record<string, ReturnType<typeof jest.fn>>,
  saveGrades: jest.fn(async (..._args: unknown[]) => undefined),
};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockRuntime.mode }; },
  campusApi: {},
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));
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
      isStale: state.isStale ?? false,
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

import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';

const sections = [
  { sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS-A', courseNameVi: 'Course A', courseNameEn: 'Course A' },
  { sectionId: 'section-b', sectionNumber: '02', courseCode: 'CS-B', courseNameVi: 'Course B', courseNameEn: 'Course B' },
];

const versionedSheet = {
  sectionId: 'section-a',
  rows: [
    {
      enrollmentId: 'ea',
      studentName: 'Alpha',
      studentCode: 'A1',
      processScore: null,
      finalExamScore: 5,
      gradeStatus: 'DRAFT',
      version: 3,
    },
  ],
};

const legacySheet = {
  sectionId: 'section-a',
  rows: [
    {
      enrollmentId: 'ea',
      studentName: 'Alpha',
      studentCode: 'A1',
      processScore: null,
      finalExamScore: 5,
      gradeStatus: 'DRAFT',
    },
  ],
};

const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const themed = (element: ReactElement, locale: 'vi' | 'en' = 'en') =>
  <LocaleProvider initialLocale={locale}>
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>;

const processLabel = `${fillCopy(operationsMessages.en.gradeRowLabel, { name: 'Alpha' })}, ${operationsMessages.en.process}`;
const saveButton = () => screen.getByRole('button', { name: operationsMessages.en.saveScores });
const reloadButton = () => screen.getByRole('button', { name: operationsMessages.en.reload });
const changesLabel = fillCopy(operationsMessages.en.changesCountOne, { n: 1 });
const staleVersion = Object.assign(new Error('The record changed; reload before editing'), {
  status: 409,
  code: 'STALE_VERSION',
});
const savedCalls = () => mockRuntime.saveGrades.mock.calls as unknown as SaveCall[];

beforeEach(() => {
  mockRuntime.mode = 'live';
  mockRuntime.reloads = {};
  mockRuntime.queries = {
    'lecturer:grading': { data: sections },
    'lecturer:grades:section-a': { data: versionedSheet },
  };
  mockRuntime.saveGrades.mockReset().mockResolvedValue(undefined);
});

describe('grade row versions on the lecturer grade sheet', () => {
  test('a save sends the version each row was loaded with', async () => {
    await render(themed(<LecturerGradingScreen {...props} />));
    await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
    await fireEvent.press(saveButton());

    expect(savedCalls()).toEqual([
      ['section-a', [{ enrollmentId: 'ea', processScore: 7, finalExamScore: 5, version: 3 }]],
    ]);
  });

  test('a legacy sheet without versions still saves and omits the version', async () => {
    mockRuntime.queries['lecturer:grades:section-a'] = { data: legacySheet };
    await render(themed(<LecturerGradingScreen {...props} />));
    await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
    await fireEvent.press(saveButton());

    const [sectionId, changes] = savedCalls()[0];
    expect(sectionId).toBe('section-a');
    expect(changes).toEqual([{ enrollmentId: 'ea', processScore: 7, finalExamScore: 5 }]);
    expect(Object.prototype.hasOwnProperty.call(changes[0], 'version')).toBe(false);
  });

  test('a version 0 baseline is sent instead of being dropped as falsy', async () => {
    mockRuntime.queries['lecturer:grades:section-a'] = {
      data: { sectionId: 'section-a', rows: [{ ...versionedSheet.rows[0], version: 0 }] },
    };
    await render(themed(<LecturerGradingScreen {...props} />));
    await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
    await fireEvent.press(saveButton());

    expect(savedCalls()[0][1]).toEqual([{ enrollmentId: 'ea', processScore: 7, finalExamScore: 5, version: 0 }]);
  });
});

describe('a STALE_VERSION conflict keeps the draft and reconciles explicitly', () => {
  test('the conflict keeps every edit and asks for a reload instead of refetching', async () => {
    mockRuntime.saveGrades.mockRejectedValueOnce(staleVersion);
    await render(themed(<LecturerGradingScreen {...props} />));
    await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
    await fireEvent.press(saveButton());

    expect(savedCalls()).toHaveLength(1);
    expect(screen.getByLabelText(processLabel).props.value).toBe('7');
    expect(screen.getByText(changesLabel)).toBeOnTheScreen();
    expect(screen.getByText(operationsMessages.en.gradesVersionStale)).toBeOnTheScreen();
    expect(reloadButton()).toBeOnTheScreen();
    expect(saveButton().props.accessibilityState?.disabled).toBe(true);
    expect(mockRuntime.reloads['lecturer:grades:section-a']).not.toHaveBeenCalled();
  });

  test('an explicit reload refetches, flags the changed row, keeps the edit and offers the new version', async () => {
    mockRuntime.saveGrades.mockRejectedValueOnce(staleVersion);
    const view = await render(themed(<LecturerGradingScreen {...props} />));
    await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');
    await fireEvent.press(saveButton());
    expect(savedCalls()).toHaveLength(1);

    await fireEvent.press(reloadButton());
    expect(mockRuntime.reloads['lecturer:grades:section-a']).toHaveBeenCalledTimes(1);

    // The refetched baseline moved the row: another editor stored 4 at version 4.
    mockRuntime.queries['lecturer:grades:section-a'] = {
      data: {
        sectionId: 'section-a',
        rows: [{ ...versionedSheet.rows[0], processScore: 4, version: 4 }],
      },
    };
    await view.rerender(themed(<LecturerGradingScreen {...props} />));

    expect(screen.getByText(operationsMessages.en.changedOnServer)).toBeOnTheScreen();
    expect(screen.getByLabelText(processLabel).props.value).toBe('7');
    expect(screen.getByText(changesLabel)).toBeOnTheScreen();
    expect(screen.queryByText(operationsMessages.en.gradesVersionStale)).toBeNull();
    expect(saveButton().props.accessibilityState?.disabled).toBe(false);
    // Reconciliation is explicit: reload never re-sends the old draft on its own.
    expect(savedCalls()).toHaveLength(1);

    await fireEvent.press(saveButton());
    expect(savedCalls()).toHaveLength(2);
    expect(savedCalls()[1]).toEqual([
      'section-a',
      [{ enrollmentId: 'ea', processScore: 7, finalExamScore: 5, version: 4 }],
    ]);
  });

  test('a background version bump under a dirty draft is still a server change', async () => {
    const view = await render(themed(<LecturerGradingScreen {...props} />));
    await fireEvent.changeText(await screen.findByLabelText(processLabel), '7');

    mockRuntime.queries['lecturer:grades:section-a'] = {
      data: { sectionId: 'section-a', rows: [{ ...versionedSheet.rows[0], version: 4 }] },
    };
    await view.rerender(themed(<LecturerGradingScreen {...props} />));

    expect(screen.getByText(operationsMessages.en.gradesStale)).toBeOnTheScreen();
    expect(screen.getByLabelText(processLabel).props.value).toBe('7');
    expect(saveButton().props.accessibilityState?.disabled).toBe(true);
  });
});
