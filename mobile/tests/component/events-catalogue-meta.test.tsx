import { expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { eventsMessages } from '../../src/i18n/events-messages';
import { formatDateTime } from '../../src/i18n/locale';
import type { MobileScreenProps } from '../../src/navigation/types';

type QueryState = { data?: unknown };

const mockQueries: Record<string, QueryState> = {};

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', get: jest.fn(async () => []), post: jest.fn() },
  campusApi: {},
  createAssistantClientRequestId: () => 'events-meta',
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => ({
    data: mockQueries[key]?.data,
    error: null,
    warning: null,
    errorStatus: null,
    isLoading: false,
    isStale: false,
    reload: jest.fn(async () => {}),
    setData: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { EventsScreen } from '../../src/screens/student/EventsScreen';

const event = {
  id: 'evt-1',
  title: 'Ngày hội',
  status: 'REGISTRATION_OPEN',
  seatsRemaining: 5,
  capacity: 50,
  organizer: 'Đoàn trường',
  location: 'Hội trường',
  startsAt: '2026-12-01T01:00:00Z',
  endsAt: '2026-12-01T03:30:00Z',
  myRegistrationStatus: null,
  myRegistrationId: null,
};

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

test('the events header shows the web eyebrow and student hint', async () => {
  mockQueries['content.events'] = { data: { items: [], hasMore: false } };
  mockQueries['content.events.mine'] = { data: { items: [], hasMore: false } };
  await render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">
        <EventsScreen {...props} />
      </LocaleProvider>
    </ThemeProvider> as ReactElement,
  );
  expect(screen.getByText(eventsMessages.vi.eyebrow)).toBeOnTheScreen();
  expect(screen.getByText(eventsMessages.vi.studentHint)).toBeOnTheScreen();
});

test('the catalogue card meta follows the web time and location line without the organizer', async () => {
  mockQueries['content.events'] = { data: { items: [event], hasMore: false } };
  mockQueries['content.events.mine'] = { data: { items: [], hasMore: false } };

  await render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">
        <EventsScreen {...props} />
      </LocaleProvider>
    </ThemeProvider> as ReactElement,
  );

  const range = `${formatDateTime(event.startsAt, 'vi')} → ${formatDateTime(event.endsAt, 'vi')}`;
  expect(screen.getByText(new RegExp(`${range.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*Hội trường`))).toBeOnTheScreen();
  expect(screen.queryByText(/Đoàn trường/)).toBeNull();
});
