import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { eventsMessages } from '../../src/i18n/events-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

type QueryState = {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  errorStatus?: number | null;
  isLoading?: boolean;
  isStale?: boolean;
};

const mockQueries: Record<string, QueryState> = {};
const mockReload = jest.fn<() => Promise<void>>();
const mockPost = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../src/api/client', () => ({
  apiClient: {
    mode: 'live',
    get: jest.fn(async () => []),
    post: (...args: unknown[]) => (mockPost as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
  },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-key',
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, _requestId: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
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
      isStale: state.isStale ?? false,
      reload: mockReload,
      setData: jest.fn(),
    };
  },
}));

import { EventsScreen } from '../../src/screens/student/EventsScreen';

const copy = eventsMessages.vi;
const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

const event = {
  id: 'evt-1', title: 'Ngày hội tình nguyện', status: 'REGISTRATION_OPEN', seatsRemaining: 5,
  organizer: 'CLB', location: 'Hội trường', startsAt: '2026-12-01T01:00:00Z',
  myRegistrationStatus: null, myRegistrationId: null,
};
const emptyPage = { items: [], hasMore: false };

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

const registerAction = () => screen.getByRole('button', { name: `${copy.register}: ${event.title}` });

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockQueries['content.events'] = { data: { items: [event], hasMore: false } };
  mockQueries['content.events.mine'] = { data: emptyPage };
  mockReload.mockReset();
  mockReload.mockResolvedValue(undefined);
  mockPost.mockReset();
  mockPost.mockResolvedValue({});
});

test('a second register press during the catalogue refresh is ignored', async () => {
  const reload = deferred<void>();
  mockReload.mockImplementation(() => reload.promise);
  await render(screenElement(<EventsScreen {...props} />));

  await fireEvent.press(registerAction());
  expect(await screen.findByText(copy.registered)).toBeOnTheScreen();
  expect(mockPost).toHaveBeenCalledTimes(1);

  // The catalogue still carries the pre-write row until both reads land, so a
  // second tap must not register again.
  const action = registerAction();
  await fireEvent.press(action);
  await act(async () => { await Promise.resolve(); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(action).toBeDisabled();

  await act(async () => {
    reload.resolve();
    await reload.promise;
  });

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(screen.getByText(copy.registered)).toBeOnTheScreen();
  expect(screen.queryByText(copy.registerFailed)).toBeNull();
});
