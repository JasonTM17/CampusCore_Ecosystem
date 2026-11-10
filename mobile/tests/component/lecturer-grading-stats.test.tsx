import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockRuntime = {
  queries: {} as Record<string, unknown>,
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
    reload: jest.fn(async () => {}),
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

import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';

const gradingSection = {
  sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204',
  courseNameVi: 'Kiến trúc phần mềm', courseNameEn: 'Software Architecture',
  semesterId: 'term-1', semesterName: 'HK1',
  enrolledCount: 1297, gradedCount: 1297, publishedCount: 0, canPublish: false, gradeStatus: 'DRAFT',
};
const gradeSheet = {
  sectionId: 'section-a',
  rows: [{
    enrollmentId: 'enr-1', studentId: 'st-1', studentCode: '2022SE0417', studentName: 'Nguyen Minh',
    processScore: 8, finalExamScore: 9, gradeStatus: 'DRAFT',
  }],
};
const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;

function setWindow(width: number, fontScale = 1) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({
    width,
    height: 800,
    scale: 2,
    fontScale,
  } as ReturnType<typeof Dimensions.get>);
}

const screenElement = (element: ReactElement, locale: 'vi' | 'en') => (
  <LocaleProvider initialLocale={locale}>
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>
);
const renderScreen = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => render(screenElement(element, locale));

function flattenedStyle(node: { props: { style?: StyleProp<ViewStyle | TextStyle> } }) {
  return StyleSheet.flatten(node.props.style) ?? {};
}

beforeEach(() => {
  mockRuntime.queries = {
    'lecturer:grading': [gradingSection],
    'lecturer:grades:section-a': gradeSheet,
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('keeps the formatted grade total on one line and wraps its description only between words', async () => {
  setWindow(411);
  await renderScreen(<LecturerGradingScreen {...props} />, 'en');

  const count = screen.getByText('1,297');
  expect(count.props.numberOfLines).toBe(1);
  expect(count.props.adjustsFontSizeToFit).toBe(true);
  expect(count.props.minimumFontScale).toBe(0.7);

  const detail = screen.getByText(operationsMessages.en.gradesDetailSections);
  expect(detail.props.numberOfLines).toBeUndefined();
  const detailStyle = flattenedStyle(detail);
  expect(detailStyle.width).toBeUndefined();
  expect(detailStyle.minWidth).toBe(0);
  expect(detailStyle.flexShrink).toBe(1);
  expect(flattenedStyle(detail.parent!).flex).toBe(1);
});

test('uses the locale number grouping and keeps the total on one line in Vietnamese too', async () => {
  setWindow(411);
  await renderScreen(<LecturerGradingScreen {...props} />, 'vi');

  const count = screen.getByText('1.297');
  expect(count.props.numberOfLines).toBe(1);
  expect(count.props.adjustsFontSizeToFit).toBe(true);
  expect(count.props.minimumFontScale).toBe(0.7);
});

test('stacks the stat cards at a large system font scale without fixed text widths', async () => {
  setWindow(411, 1.3);
  await renderScreen(<LecturerGradingScreen {...props} />, 'en');

  const detail = screen.getByText(operationsMessages.en.gradesDetailSections);
  const card = detail.parent!;
  expect(flattenedStyle(card.parent!).flexDirection).toBe('column');
  expect(flattenedStyle(detail).width).toBeUndefined();
  expect(flattenedStyle(detail).minWidth).toBe(0);
  expect(screen.getByText('1,297').props.numberOfLines).toBe(1);
});
