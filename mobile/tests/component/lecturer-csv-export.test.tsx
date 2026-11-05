import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { fillCopy } from '../../src/i18n/academic-messages';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockRuntime = {
  mode: 'live' as 'live' | 'preview',
  queries: {} as Record<string, unknown>,
  shared: [] as { content: string; name: string }[],
  shareFails: false,
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
  csvShareAvailable: () => true,
  shareCsv: async (content: string, name: string) => {
    if (mockRuntime.shareFails) throw new Error('native share failed');
    mockRuntime.shared.push({ content, name });
    return { status: 'done' as const };
  },
}));

import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';

const sections = [
  { sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS101', courseNameVi: 'Nhập môn', courseNameEn: 'Introduction' },
];
const gradeSheet = {
  sectionId: 'section-a',
  rows: [{ enrollmentId: 'ea', studentName: 'Alpha', studentCode: 'A1', processScore: 5, finalExamScore: 5, gradeStatus: 'DRAFT' }],
};
const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() };
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const screenElement = (element: ReactElement) => (
  <LocaleProvider initialLocale="en">
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>
);

const processInput = () =>
  `${fillCopy(operationsMessages.en.gradeRowLabel, { name: 'Alpha' })}, ${operationsMessages.en.process}`;

beforeEach(() => {
  mockRuntime.mode = 'live';
  mockRuntime.shared = [];
  mockRuntime.shareFails = false;
  mockRuntime.queries = {
    'lecturer:grading': sections,
    'lecturer:grades:section-a': gradeSheet,
  };
});

test('grade CSV exports the unsaved score shown on screen', async () => {
  await render(screenElement(<LecturerGradingScreen {...props} />));
  await fireEvent.changeText(await screen.findByLabelText(processInput()), '9');
  await fireEvent.press(screen.getByRole('button', { name: /Export CSV/ }));

  await waitFor(() => expect(mockRuntime.shared).toHaveLength(1));
  expect(mockRuntime.shared[0].content).toContain('"9.0"');
  expect(mockRuntime.shared[0].content).not.toContain('"5.00"');
});

test('grade CSV keeps the loaded score when the visible text is not a valid score', async () => {
  await render(screenElement(<LecturerGradingScreen {...props} />));
  await fireEvent.changeText(await screen.findByLabelText(processInput()), '11');
  await fireEvent.press(screen.getByRole('button', { name: /Export CSV/ }));

  await waitFor(() => expect(mockRuntime.shared).toHaveLength(1));
  expect(mockRuntime.shared[0].content).toContain('"5.0"');
  expect(mockRuntime.shared[0].content).not.toContain('"11.0"');
});

test('grade CSV reports a rejected share and releases the busy action', async () => {
  mockRuntime.shareFails = true;
  await render(screenElement(<LecturerGradingScreen {...props} />));
  await fireEvent.press(await screen.findByRole('button', { name: /Export CSV/ }));

  expect(await screen.findByText(operationsMessages.en.exportFailed)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /Export CSV/ })).toBeEnabled();
});

test('the 50% score field is labelled Coursework', async () => {
  await render(screenElement(<LecturerGradingScreen {...props} />));
  expect(await screen.findByLabelText('Scores for Alpha, Coursework')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Scores for Alpha, Process')).toBeNull();
  expect(operationsMessages.en.process).toBe('Coursework');
});
