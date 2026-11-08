import { beforeEach, expect, jest, test } from '@jest/globals';
import React, { type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { campusIsoDate } from '../../src/i18n/locale';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockRuntime = { mode: 'live', queries: {} as Record<string, unknown> };
const mockAttendanceRowRenderCounts: Record<string, number> = {};
const mockGradeRowRenderCounts: Record<string, number> = {};
let mockAttendanceChangeCountCalls = 0;
let mockAttendanceMetricsCalls = 0;

jest.mock('../../src/api/client', () => ({ get apiClient() { return { mode: mockRuntime.mode }; } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => ({
    data: mockRuntime.queries[key], error: null, warning: null, errorStatus: null,
    isLoading: false, isStale: false, reload: jest.fn(async () => {}), setData: jest.fn(),
  }),
}));
jest.mock('../../src/screens/operations/lecturer-api', () => ({
  StaleAttendanceError: class StaleAttendanceError extends Error {},
  lecturerApi: {
    schedule: jest.fn(async () => []), gradingSections: jest.fn(async () => []),
    attendanceSheet: jest.fn(async () => ({ sectionId: '', date: '', roster: [], marks: [] })),
    saveAttendance: jest.fn(async () => 1), sectionGrades: jest.fn(async () => []),
    saveGrades: jest.fn(async () => undefined), publishGrades: jest.fn(async () => undefined),
  },
}));
jest.mock('../../src/screens/operations/lecturer-ui', () => {
  const React = require('react') as typeof import('react');
  const Native = require('react-native') as typeof import('react-native');
  return {
    isOpsPreview: () => mockRuntime.mode === 'preview',
    useOpsQuery: (key: string) => ({
      data: mockRuntime.queries[key], error: null, warning: null, errorStatus: null,
      isLoading: false, isStale: false, reload: jest.fn(async () => {}), setData: jest.fn(),
    }),
    OpsShell: ({ children, list }: {
      children: ReactNode;
      list?: { data: readonly unknown[]; renderItem: (info: { item: unknown; index: number }) => ReactNode; footer?: ReactNode };
    }) => React.createElement(Native.View, null, children,
      ...(list?.data.map((item, index) => React.createElement(React.Fragment, { key: String(index) }, list.renderItem({ item, index }))) ?? []),
      list?.footer),
    SectionPicker: () => null,
    CsvExport: () => null,
    HandoffButton: () => null,
  };
});
jest.mock('../../src/screens/operations/AttendanceRosterRow', () => {
  const React = require('react') as typeof import('react');
  const Native = require('react-native') as typeof import('react-native');
  function Row({ row, onChange }: { row: { studentId: string; name: string }; onChange: (id: string, status: string) => void }) {
    mockAttendanceRowRenderCounts[row.studentId] = (mockAttendanceRowRenderCounts[row.studentId] ?? 0) + 1;
    return React.createElement(Native.Pressable, {
      accessibilityRole: 'radio', accessibilityLabel: row.name,
      onPress: () => onChange(row.studentId, 'PRESENT'),
    }, React.createElement(Native.Text, null, row.name));
  }
  return { AttendanceRosterRow: React.memo(Row) };
});
jest.mock('../../src/screens/operations/GradeRowCard', () => {
  const React = require('react') as typeof import('react');
  const Native = require('react-native') as typeof import('react-native');
  function Row({ row, edit, onEdit }: {
    row: { enrollmentId: string };
    edit: { processScore?: string } | undefined;
    onEdit: (id: string, field: 'processScore', text: string) => void;
  }) {
    mockGradeRowRenderCounts[row.enrollmentId] = (mockGradeRowRenderCounts[row.enrollmentId] ?? 0) + 1;
    return React.createElement(Native.TextInput, {
      testID: `score-${row.enrollmentId}`, value: edit?.processScore ?? '',
      onChangeText: (text: string) => onEdit(row.enrollmentId, 'processScore', text),
    });
  }
  return { GradeRowCard: React.memo(Row) };
});
jest.mock('../../src/screens/operations/lecturer-model', () => {
  const actual = jest.requireActual('../../src/screens/operations/lecturer-model') as typeof import('../../src/screens/operations/lecturer-model');
  return {
    ...actual,
    attendanceChangeCount: (...args: Parameters<typeof actual.attendanceChangeCount>) => {
      mockAttendanceChangeCountCalls += 1;
      return actual.attendanceChangeCount(...args);
    },
    attendanceMetrics: (...args: Parameters<typeof actual.attendanceMetrics>) => {
      mockAttendanceMetricsCalls += 1;
      return actual.attendanceMetrics(...args);
    },
  };
});

import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';

const section = { sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS-A', courseNameVi: 'Course A', courseNameEn: 'Course A' };
const today = campusIsoDate();
const roster = Array.from({ length: 32 }, (_, index) => ({
  studentId: `student-${index}`, studentCode: `S${index}`, firstName: `Student ${index}`,
}));
const grades = Array.from({ length: 32 }, (_, index) => ({
  enrollmentId: `enrollment-${index}`, studentName: `Student ${index}`, studentCode: `S${index}`,
  processScore: null, finalExamScore: null, gradeStatus: 'DRAFT',
}));
const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;
const screenElement = (element: ReactElement) => (
  <LocaleProvider initialLocale="vi"><ThemeProvider forcedScheme="light">{element}</ThemeProvider></LocaleProvider>
);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockRuntime.mode = 'live';
  mockRuntime.queries = {
    'lecturer:schedule': [section],
    [`lecturer:sheet:section-a:${today}`]: { sectionId: 'section-a', date: today, roster, marks: [] },
    'lecturer:grading': [section],
    'lecturer:grades:section-a': { sectionId: 'section-a', rows: grades },
  };
  for (const key of Object.keys(mockAttendanceRowRenderCounts)) delete mockAttendanceRowRenderCounts[key];
  for (const key of Object.keys(mockGradeRowRenderCounts)) delete mockGradeRowRenderCounts[key];
  mockAttendanceChangeCountCalls = 0;
  mockAttendanceMetricsCalls = 0;
});

test('attendance status changes only render the changed memoized row', async () => {
  const view = await render(screenElement(<LecturerAttendanceScreen {...props} />));
  await view.findByRole('radio', { name: 'Student 0' });

  const unchangedRenders = mockAttendanceRowRenderCounts['student-1'];
  await fireEvent.press(view.getByRole('radio', { name: 'Student 0' }));

  expect(mockAttendanceRowRenderCounts['student-0']).toBe(2);
  expect(mockAttendanceRowRenderCounts['student-1']).toBe(unchangedRenders);
});

test('attendance search does not recalculate roster metrics or change counts', async () => {
  const view = await render(screenElement(<LecturerAttendanceScreen {...props} />));
  await view.findByRole('radio', { name: 'Student 0' });
  const changeCountCalls = mockAttendanceChangeCountCalls;
  const metricsCalls = mockAttendanceMetricsCalls;

  fireEvent.changeText(view.getByLabelText('Tìm sinh viên'), 'Student 1');

  await waitFor(() => expect(view.getByRole('radio', { name: 'Student 1' })).toBeOnTheScreen());
  expect(mockAttendanceChangeCountCalls).toBe(changeCountCalls);
  expect(mockAttendanceMetricsCalls).toBe(metricsCalls);
});

test('grading edits only render the edited memoized row', async () => {
  const view = await render(screenElement(<LecturerGradingScreen {...props} />));
  await waitFor(() => expect(view.getByTestId('score-enrollment-0')).toBeTruthy());

  const unchangedRenders = mockGradeRowRenderCounts['enrollment-1'];
  fireEvent.changeText(view.getByTestId('score-enrollment-0'), '7');

  await waitFor(() => expect(mockGradeRowRenderCounts['enrollment-0']).toBe(2));
  expect(mockGradeRowRenderCounts['enrollment-1']).toBe(unchangedRenders);
});
