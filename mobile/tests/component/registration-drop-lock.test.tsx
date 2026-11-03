import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { academicMessages } from '../../src/i18n/academic-messages';

type QueryState = { data?: unknown; error?: string | null; warning?: string | null; errorStatus?: number | null; isLoading?: boolean };

const mockQueries: Record<string, QueryState> = {};
const mockReload = jest.fn<() => Promise<void>>();
const mockPost = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../src/api/client', () => ({
  apiClient: {
    mode: 'live',
    get: jest.fn(async () => []),
    post: (...args: unknown[]) => (mockPost as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
    download: jest.fn(),
  },
  campusApi: {
    enrollments: jest.fn(async () => []),
    grades: jest.fn(async () => []),
    transcript: jest.fn(async () => ({})),
    attendanceSummary: jest.fn(async () => []),
    registrationRounds: jest.fn(async () => []),
    registrationSections: jest.fn(async () => []),
  },
  createAssistantClientRequestId: () => 'key-1',
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const state = mockQueries[key] ?? {};
    return {
      data: state.data,
      error: state.error ?? null,
      warning: state.warning ?? null,
      errorStatus: state.errorStatus ?? null,
      isLoading: state.isLoading ?? false,
      isStale: false,
      reload: mockReload,
      setData: jest.fn(),
    };
  },
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));

import { RegistrationScreen } from '../../src/screens/student/RegistrationScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const copy = academicMessages.vi;
const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const section = {
  id: 'sec-1', sectionNumber: '01', courseId: 'course-1', courseCode: 'CS101', courseName: 'Nhập môn',
  credits: 3, capacity: 40, enrolledCount: 1, remainingSeats: 39, status: 'OPEN', scheduleConflict: false, alreadyEnrolled: true,
};
const workspace = {
  sections: [section],
  enrollments: [{ id: 'enr-1', sectionId: 'sec-1', semesterId: 't2', status: 'ENROLLED' }],
  roundOpen: true,
  eligibility: { eligible: true, creditLimit: 20, creditsUsed: 3, creditsRemaining: 17 },
  closedReason: null,
};

const screenElement = (element: ReactElement) => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
  </ThemeProvider>
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockQueries['academic.registration'] = { data: workspace };
  mockReload.mockReset();
  mockReload.mockResolvedValue(undefined);
  mockPost.mockReset();
  mockPost.mockResolvedValue({ message: 'ok' });
  navigation.navigate = jest.fn();
});

test('a second drop press during the post-drop reload is ignored', async () => {
  const reload = deferred<void>();
  mockReload.mockImplementation(() => reload.promise);
  await render(screenElement(<RegistrationScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', { name: `${copy.dropSection}: CS101` }));
  await fireEvent.press(screen.getByRole('button', { name: copy.dropSection }));
  expect(await screen.findByText(copy.dropped)).toBeOnTheScreen();
  expect(mockPost).toHaveBeenCalledTimes(1);

  // The reload that removes the row has not settled yet: a second tap must not
  // reach a second drop request.
  const rowDrop = screen.getByRole('button', { name: `${copy.dropSection}: CS101` });
  await fireEvent.press(rowDrop);
  await act(async () => { await Promise.resolve(); });
  const confirm = screen.queryByRole('button', { name: copy.dropSection });
  if (confirm) {
    await fireEvent.press(confirm);
    await act(async () => { await Promise.resolve(); });
  }
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(rowDrop).toBeDisabled();

  await act(async () => {
    reload.resolve();
    await reload.promise;
  });

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(screen.getByText(copy.dropped)).toBeOnTheScreen();
  expect(screen.queryByText(copy.errors.generic)).toBeNull();
});
