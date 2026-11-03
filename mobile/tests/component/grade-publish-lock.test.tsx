import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockRuntime = {
  queries: {} as Record<string, unknown>,
  reloads: {} as Record<string, ReturnType<typeof jest.fn>>,
  publishGrades: jest.fn(async (..._args: unknown[]) => undefined),
};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: 'live' }; },
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
    saveAttendance: jest.fn(async () => 1),
    sectionGrades: jest.fn(async () => []),
    saveGrades: jest.fn(async () => undefined),
    publishGrades: (...args: unknown[]) => mockRuntime.publishGrades(...args),
  },
}));
jest.mock('../../src/screens/operations/lecturer-ui', () => {
  const React = require('react') as typeof import('react');
  const Native = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('../../src/screens/operations/lecturer-ui') as typeof import('../../src/screens/operations/lecturer-ui');
  return {
    ...actual,
    OpsShell: ({ children, list }: {
      children: ReactNode;
      list?: {
        data: readonly unknown[];
        renderItem: (info: { item: unknown; index: number }) => ReactNode;
        footer?: ReactNode;
      };
    }) => React.createElement(
      Native.View,
      null,
      children,
      ...(list?.data.map((item, index) => React.createElement(
        React.Fragment,
        { key: String(index) },
        list.renderItem({ item, index }),
      )) ?? []),
      list?.footer,
    ),
    SectionPicker: () => null,
    CsvExport: () => null,
    HandoffButton: () => null,
  };
});
jest.mock('../../src/screens/lanes/LaneEntries', () => ({ LaneEntries: () => null }));

import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';

const copy = operationsMessages.en;
const section = {
  sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS-A', courseNameEn: 'Course A', courseNameVi: 'Course A',
  enrolledCount: 1, gradedCount: 1, publishedCount: 0, canPublish: true, gradeStatus: 'DRAFT',
};
const gradeSheet = {
  sectionId: 'section-a',
  rows: [{ enrollmentId: 'ea', studentName: 'Alpha', studentCode: 'A1', processScore: 8, finalExamScore: 9, gradeStatus: 'DRAFT' }],
};
const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const screenElement = (element: ReactElement) => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="en">{element}</LocaleProvider>
  </ThemeProvider>
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockRuntime.reloads = {};
  mockRuntime.queries = { 'lecturer:grading': [section], 'lecturer:grades:section-a': gradeSheet };
  mockRuntime.publishGrades.mockReset();
  mockRuntime.publishGrades.mockResolvedValue(undefined);
});

test('a second publish press during the post-publish reload is ignored', async () => {
  const reload = deferred<void>();
  mockRuntime.reloads['lecturer:grading'] = jest.fn(() => reload.promise);
  mockRuntime.reloads['lecturer:grades:section-a'] = jest.fn(() => reload.promise);
  await render(screenElement(<LecturerGradingScreen {...props} />));
  await screen.findByText('Alpha');

  await fireEvent.press(screen.getByRole('button', { name: copy.publishGrades }));
  await fireEvent.press(screen.getByRole('button', { name: copy.publishConfirm }));
  expect(await screen.findByText(copy.publishedOk)).toBeOnTheScreen();
  expect(mockRuntime.publishGrades).toHaveBeenCalledTimes(1);

  // The reload has not landed, so the section still reads DRAFT: the button
  // must stay locked rather than offer a second publish.
  const publishButton = screen.getByRole('button', { name: copy.publishGrades });
  await fireEvent.press(publishButton);
  const confirm = screen.queryByRole('button', { name: copy.publishConfirm });
  if (confirm) {
    await fireEvent.press(confirm);
    await act(async () => { await Promise.resolve(); });
  }
  expect(mockRuntime.publishGrades).toHaveBeenCalledTimes(1);
  expect(publishButton).toBeDisabled();

  mockRuntime.queries['lecturer:grading'] = [{ ...section, publishedCount: 1, canPublish: false, gradeStatus: 'PUBLISHED' }];
  mockRuntime.queries['lecturer:grades:section-a'] = {
    ...gradeSheet,
    rows: [{ ...gradeSheet.rows[0], gradeStatus: 'PUBLISHED' }],
  };
  await act(async () => {
    reload.resolve();
    await reload.promise;
  });

  expect(screen.getByText(copy.published)).toBeOnTheScreen();
  expect(screen.getByText(copy.publishedOk)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: copy.publishGrades })).toBeDisabled();
  expect(mockRuntime.publishGrades).toHaveBeenCalledTimes(1);
});
