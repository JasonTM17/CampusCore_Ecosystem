// The round a student is viewing belongs to one signed-in account: a sign-out
// or an expired session must drop it so the next account opens on its own
// default round.

import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import type { ReactElement } from 'react';

import { createSessionStore } from '../../src/auth/session-store';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { SessionProvider, useSession } from '../../src/session/SessionContext';
import { getSelectedThesisRoundId, selectThesisRound } from '../../src/screens/thesis/thesis-selection';
import { useActiveThesisRound } from '../../src/screens/thesis/use-thesis';

let mockStore: ReturnType<typeof createSessionStore>;
let sessionExpiredHandler: (() => void) | undefined;
const mockClient = {
  mode: 'live',
  setOnSessionExpired: jest.fn((handler?: () => void) => { sessionExpiredHandler = handler; }),
};

const ROUNDS = [
  {
    id: 'r1', name: 'Đợt cũ', status: 'RESULTS_PUBLISHED',
    registrationStart: '2026-01-05T00:00:00Z', registrationEnd: '2026-02-05T00:00:00Z',
  },
  {
    id: 'r2', name: 'Đợt mới', status: 'REGISTRATION_OPEN',
    registrationStart: '2026-08-25T00:00:00Z', registrationEnd: '2026-09-30T23:59:59Z',
  },
];

const mockApi: Record<string, jest.Mock<(...args: any[]) => Promise<any>>> = {
  rounds: jest.fn<(...args: any[]) => Promise<any>>(async () => ({ items: ROUNDS, hasMore: false, total: ROUNDS.length })),
  myGroups: jest.fn<(...args: any[]) => Promise<any>>(async () => ({ items: [], hasMore: false, total: 0 })),
};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return mockClient; },
  campusApi: { profile: async () => ({ id: 'u1', email: 'a@b.c', studentId: 's1' }) },
}));
jest.mock('../../src/screens/thesis/thesis-api', () => ({
  thesisApi: new Proxy({}, { get: (_target, key: string) => (...args: unknown[]) => mockApi[key](...args) }),
}));
jest.mock('../../src/auth/mobile-session-store', () => ({ get sessionStore() { return mockStore; } }));
jest.mock('../../src/auth/oidc-session', () => jest.requireActual('../../src/auth/oidc-core'));
jest.mock('../../src/config/lane-flags', () => ({ LANE_FLAGS: {} }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })) }));

const access = () => `e30.${Buffer.from(JSON.stringify({
  sub: 'account-a', roles: ['STUDENT'], exp: Math.floor(Date.now() / 1000) + 600,
})).toString('base64url')}.synthetic`;

let request: jest.Mock<(...args: unknown[]) => Promise<Response>>;
let secure: Map<string, string>;

function Probe() {
  const session = useSession();
  const active = useActiveThesisRound();
  return (
    <View>
      <Text testID="kind">{session.kind}</Text>
      <Text testID="round">{active.round?.id ?? 'none'}</Text>
      <Pressable testID="pick" onPress={() => selectThesisRound('r1')}><Text>pick</Text></Pressable>
      <Pressable testID="sign-out" onPress={() => { void session.signOut(); }}><Text>out</Text></Pressable>
      <Pressable testID="sign-in" onPress={() => session.completeSignIn('student', 'account-b')}><Text>in</Text></Pressable>
    </View>
  );
}

const renderProbe = (element: ReactElement) => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <SessionProvider>{element}</SessionProvider>
    </LocaleProvider>
  </ThemeProvider>,
);

beforeEach(() => {
  jest.restoreAllMocks();
  mockClient.mode = 'live';
  mockClient.setOnSessionExpired.mockClear();
  sessionExpiredHandler = undefined;
  selectThesisRound(null);
  mockApi.rounds.mockClear();
  mockApi.myGroups.mockClear();
  secure = new Map([['cu.install', JSON.stringify({ appInstanceId: 'install' })], ['cu.refresh', 'synthetic-refresh']]);
  request = jest.fn(async () => new Response('{}', { status: 503 }));
  mockStore = createSessionStore({
    issuer: 'https://issuer.test', fetchImpl: request as typeof fetch,
    secure: {
      getItemAsync: async (key) => secure.get(key) ?? null,
      setItemAsync: async (key, value) => { secure.set(key, value); },
      deleteItemAsync: async (key) => { secure.delete(key); },
    },
    sandbox: { getItem: async () => JSON.stringify({ appInstanceId: 'install' }), setItem: async () => {}, removeItem: async () => {} },
  });
});

const bootAsFirstAccount = () => {
  request.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: access(), refresh_token: 'synthetic-rotation' })));
};

async function openOnOwnRound() {
  expect(await screen.findByTestId('kind')).toHaveTextContent('authenticated');
  await waitFor(() => expect(screen.getByTestId('round')).toHaveTextContent('r2'));
  await fireEvent.press(screen.getByTestId('pick'));
  expect(screen.getByTestId('round')).toHaveTextContent('r1');
}

describe('thesis round selection across session boundaries', () => {
  test('signing out clears the selected round so the next account opens on its default', async () => {
    bootAsFirstAccount();
    await renderProbe(<Probe />);
    await openOnOwnRound();

    await fireEvent.press(screen.getByTestId('sign-out'));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('signedOut'));
    expect(getSelectedThesisRoundId()).toBeNull();

    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('authenticated'));
    await waitFor(() => expect(screen.getByTestId('round')).toHaveTextContent('r2'));
  });

  test('an expired session clears the selected round before the next sign-in', async () => {
    bootAsFirstAccount();
    await renderProbe(<Probe />);
    await openOnOwnRound();

    await act(async () => { sessionExpiredHandler?.(); });
    expect(screen.getByTestId('kind')).toHaveTextContent('signedOut');
    expect(getSelectedThesisRoundId()).toBeNull();

    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(screen.getByTestId('kind')).toHaveTextContent('authenticated'));
    await waitFor(() => expect(screen.getByTestId('round')).toHaveTextContent('r2'));
  });
});
