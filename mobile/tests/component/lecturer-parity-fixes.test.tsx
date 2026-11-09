import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { fillCopy } from '../../src/i18n/academic-messages';
import { campusIsoDate } from '../../src/i18n/locale';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockRuntime = {
  mode: 'live' as 'live' | 'preview',
  queries: {} as Record<string, unknown>,
  reloads: {} as Record<string, ReturnType<typeof jest.fn>>,
  saveAttendance: jest.fn(async (..._args: unknown[]) => 1),
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
    CsvExport: () => null,
    HandoffButton: () => null,
  };
});

import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';

const copy = operationsMessages.vi;
const today = campusIsoDate();
const sections = [
  {
    sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS-A',
    courseNameVi: 'Course A', courseNameEn: 'Course A', semesterId: 'term-1', semesterName: 'Term 1',
  },
  {
    sectionId: 'section-b', sectionNumber: '02', courseCode: 'CS-B',
    courseNameVi: 'Course B', courseNameEn: 'Course B', semesterId: 'term-2', semesterName: 'Term 2',
  },
];
const attendanceSheetA = {
  sectionId: 'section-a', date: today,
  roster: [
    { studentId: 'a1', studentCode: 'A1', firstName: 'Alpha' },
    { studentId: 'a2', studentCode: 'A2', firstName: 'Bravo' },
  ],
  marks: [],
};
const attendanceSheetB = {
  sectionId: 'section-b', date: today,
  roster: [{ studentId: 'b1', studentCode: 'B1', firstName: 'Bravo' }],
  marks: [],
};
const summaryA = { sectionId: 'section-a', attendanceRate: 60, totalSessions: 5 };
const summaryB = { sectionId: 'section-b', attendanceRate: 80, totalSessions: 7 };
const gradeSheetA = {
  sectionId: 'section-a',
  rows: [
    {
      enrollmentId: 'ea', studentName: 'Alpha', studentCode: 'A1', email: 'alpha@example.edu',
      processScore: 7.5, finalExamScore: 8, gradeStatus: 'APPEALED',
    },
    {
      enrollmentId: 'eb', studentName: 'Bravo', studentCode: 'A2',
      processScore: null, finalExamScore: null, gradeStatus: 'DRAFT',
    },
  ],
};
const gradeSheetB = {
  sectionId: 'section-b',
  rows: [{ enrollmentId: 'ec', studentName: 'Bravo', studentCode: 'B1', processScore: 8, finalExamScore: 8, gradeStatus: 'DRAFT' }],
};
const gradingSections = [
  { ...sections[0], enrolledCount: 2, gradedCount: 1, publishedCount: 0, canPublish: false, gradeStatus: 'PARTIAL' },
  { ...sections[1], enrolledCount: 1, gradedCount: 1, publishedCount: 0, canPublish: true, gradeStatus: 'DRAFT' },
];
const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const screenElement = (element: ReactElement) => (
  <LocaleProvider initialLocale="vi">
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>
);
const renderScreen = (element: ReactElement) => render(screenElement(element));

beforeEach(() => {
  mockRuntime.mode = 'live';
  mockRuntime.reloads = {};
  mockRuntime.queries = {
    'lecturer:schedule': sections,
    [`lecturer:sheet:section-a:${today}`]: attendanceSheetA,
    [`lecturer:sheet:section-b:${today}`]: attendanceSheetB,
    'lecturer:attendance-summary:section-a': summaryA,
    'lecturer:attendance-summary:section-b': summaryB,
    'lecturer:grading': gradingSections,
    'lecturer:grades:section-a': gradeSheetA,
    'lecturer:grades:section-b': gradeSheetB,
  };
  mockRuntime.saveAttendance.mockReset().mockResolvedValue(1);
});

test('a fresh attendance day starts all present and saves only when the lecturer presses save', async () => {
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  for (const name of ['Alpha', 'Bravo']) {
    const present = fillCopy(copy.markStatusFor, { name, status: copy.statusPresent });
    expect(screen.getByRole('radio', { name: present }).props.accessibilityState?.checked).toBe(true);
  }
  expect(screen.getByRole('button', { name: copy.save })).toBeEnabled();
  expect(mockRuntime.saveAttendance).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: copy.save }));
  await waitFor(() => expect(mockRuntime.saveAttendance).toHaveBeenCalledTimes(1));
  expect((mockRuntime.saveAttendance.mock.calls[0] as unknown[])[2]).toEqual([
    { studentId: 'a1', status: 'PRESENT' },
    { studentId: 'a2', status: 'PRESENT' },
  ]);
});

test('a stored attendance note is visible, editable and carried by the save request', async () => {
  mockRuntime.queries[`lecturer:sheet:section-a:${today}`] = {
    ...attendanceSheetA,
    marks: [{ studentId: 'a1', status: 'PRESENT', notes: 'sick' }],
  };
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  const noteLabel = `Lý do vắng hoặc ghi chú thêm (không bắt buộc) — Alpha`;
  const noteField = await screen.findByLabelText(noteLabel);
  expect(noteField.props.value).toBe('sick');
  await fireEvent.changeText(noteField, 'medical leave');
  await fireEvent.press(screen.getByRole('button', { name: copy.save }));

  await waitFor(() => expect(mockRuntime.saveAttendance).toHaveBeenCalledTimes(1));
  expect((mockRuntime.saveAttendance.mock.calls[0] as unknown[])[2]).toEqual([
    { studentId: 'a1', status: 'PRESENT', notes: 'medical leave' },
    { studentId: 'a2', status: 'PRESENT' },
  ]);
});

test('attendance tiles show the enrolled total and the term section rate from the summary endpoint', async () => {
  mockRuntime.queries[`lecturer:sheet:section-a:${today}`] = {
    ...attendanceSheetA,
    marks: [
      { studentId: 'a1', status: 'PRESENT' },
      { studentId: 'a2', status: 'EXCUSED' },
    ],
  };
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  expect(screen.getByText('Tổng số sinh viên')).toBeOnTheScreen();
  expect(screen.getByText('60%')).toBeOnTheScreen();
  expect(screen.getByText('5 buổi đã học')).toBeOnTheScreen();
  expect(screen.getByText('Tỷ lệ chuyên cần')).toBeOnTheScreen();
});

test('the attendance term filter narrows the section picker to the chosen term', async () => {
  await renderScreen(<LecturerAttendanceScreen {...props} />);
  await screen.findByText('Alpha');

  await fireEvent.press(screen.getByRole('button', { name: 'Học kỳ: Tất cả học kỳ' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Term 2' }));

  expect(await screen.findByText('Bravo')).toBeOnTheScreen();
  expect(screen.queryByText('Alpha')).toBeNull();
});

test('appealed grades stay editable, show under review, and partial sheets keep their label', async () => {
  await renderScreen(<LecturerGradingScreen {...props} />);
  await screen.findByText('Alpha');

  const processLabel = `${fillCopy(copy.gradeRowLabel, { name: 'Alpha' })}, ĐQT (50%)`;
  expect(screen.getByLabelText(processLabel).props.editable).not.toBe(false);
  expect(screen.getByText('Đang xem xét')).toBeOnTheScreen();
  expect(screen.getByText('Đã nhập một phần')).toBeOnTheScreen();
  expect(screen.queryByText('Bản nháp')).toBeNull();
  expect(screen.getByText('alpha@example.edu')).toBeOnTheScreen();
  expect(screen.getByText('Chưa có')).toBeOnTheScreen();
  expect(screen.getAllByText('Tổng kết')).toHaveLength(2);
  expect(screen.getAllByText('Điểm chữ')).toHaveLength(2);
  expect(screen.getByText('7,8')).toBeOnTheScreen();
  expect(screen.getAllByText('B').length).toBeGreaterThan(0);
  expect(screen.getAllByText('ĐCK (50%)')).toHaveLength(2);
});

test('the grading term filter narrows the section picker to the chosen term', async () => {
  await renderScreen(<LecturerGradingScreen {...props} />);
  await screen.findByText('Alpha');

  await fireEvent.press(screen.getByRole('button', { name: 'Học kỳ: Tất cả học kỳ' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Term 2' }));

  expect(await screen.findByText('Bravo')).toBeOnTheScreen();
});
