import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Dimensions, Pressable, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

interface MockSession {
  kind: 'authenticated';
  role: 'student';
  accountId: string;
  capabilities: string[];
}

const mockSession: { value: MockSession | null } = { value: null };
const mockProfile: { value: { id: string; email: string; avatar?: string | null } } = {
  value: { id: 'acct-1', email: 'minh.nguyen@ute.edu.vn', avatar: null },
};
const mockProfileFetch = jest.fn(async () => mockProfile.value);

jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => mockSession.value,
  useOptionalSession: () => mockSession.value,
}));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: { sessionEpoch: () => 0 } }));
jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live' },
  campusApi: { profile: () => mockProfileFetch() },
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true })),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(callback, [callback]);
  },
}));

import { AppBar } from '../../src/components/AppBar';
import { ThemeProvider } from '../../src/design/theme';
import { useScreenQuery } from '../../src/hooks/useScreenQuery';
import { clearQueryCache } from '../../src/hooks/query-cache';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { campusApi } from '../../src/api/client';

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

/** Mirrors the profile screen's own read, including its reload after a save. */
function ProfileRefreshProbe() {
  const query = useScreenQuery<{ avatar?: string | null } | null>('profile', () => campusApi.profile(), {
    enabled: true,
    scope: { locale: 'neutral' },
  });
  return <Pressable onPress={() => void query.reload()} testID="profile-refresh" />;
}

beforeEach(() => {
  mockSession.value = null;
  mockProfile.value = { id: 'acct-1', email: 'minh.nguyen@ute.edu.vn', avatar: null };
  mockProfileFetch.mockClear();
  clearQueryCache();
  AppState.currentState = 'active';
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  clearQueryCache();
});

describe('AppBar account photo', () => {
  test('shows a usable portrait in the account control at the icon size and keeps its label', async () => {
    await render(wrap(
      <AppBar avatar="https://cdn.ute.edu.vn/avatars/minh.png" role="student" onProfile={() => {}} />,
    ));

    const photo = screen.getByTestId('app-bar-account-avatar', { includeHiddenElements: true });
    expect(photo.props.source).toEqual({ uri: 'https://cdn.ute.edu.vn/avatars/minh.png' });
    expect(photo.props.resizeMode).toBe('cover');
    expect(StyleSheet.flatten(photo.props.style)).toMatchObject({ borderRadius: 13, height: 26, width: 26 });
    expect(screen.queryByTestId('app-bar-account-icon')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hồ sơ' })).toBeOnTheScreen();
  });

  test('accepts a data:image portrait', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    await render(wrap(<AppBar avatar={dataUrl} role="student" onProfile={() => {}} />));

    expect(screen.getByTestId('app-bar-account-avatar', { includeHiddenElements: true }).props.source).toEqual({ uri: dataUrl });
    expect(screen.queryByTestId('app-bar-account-icon')).toBeNull();
  });

  test('keeps the account icon when there is no avatar', async () => {
    await render(wrap(<AppBar role="student" onProfile={() => {}} />));

    expect(screen.getByTestId('app-bar-account-icon')).toBeOnTheScreen();
    expect(screen.queryByTestId('app-bar-account-avatar', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hồ sơ' })).toBeOnTheScreen();
  });

  test('keeps the account icon for an unusable avatar string', async () => {
    await render(wrap(<AppBar avatar="not-a-url" role="student" onProfile={() => {}} />));
    expect(screen.getByTestId('app-bar-account-icon')).toBeOnTheScreen();
    expect(screen.queryByTestId('app-bar-account-avatar', { includeHiddenElements: true })).toBeNull();
  });

  test('rejects an insecure http portrait', async () => {
    await render(wrap(
      <AppBar avatar="http://cdn.ute.edu.vn/avatars/minh.png" role="student" onProfile={() => {}} />,
    ));
    expect(screen.getByTestId('app-bar-account-icon')).toBeOnTheScreen();
    expect(screen.queryByTestId('app-bar-account-avatar', { includeHiddenElements: true })).toBeNull();
  });

  test('keeps the account control and portrait at the icon size when the font scale is 1.3', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 800, scale: 2, fontScale: 1.3 });
    await render(wrap(
      <AppBar avatar="https://cdn.ute.edu.vn/avatars/minh.png" role="student" onProfile={() => {}} />,
    ));

    const control = screen.getByRole('button', { name: 'Hồ sơ' });
    expect(StyleSheet.flatten(control.props.style)).toMatchObject({ height: 48, width: 48 });
    const photo = screen.getByTestId('app-bar-account-avatar', { includeHiddenElements: true });
    expect(StyleSheet.flatten(photo.props.style)).toMatchObject({ borderRadius: 13, height: 26, width: 26 });
  });

  test('falls back to the account icon when the image fails to load', async () => {
    await render(wrap(
      <AppBar avatar="https://cdn.ute.edu.vn/avatars/missing.png" role="student" onProfile={() => {}} />,
    ));

    const photo = screen.getByTestId('app-bar-account-avatar', { includeHiddenElements: true });
    await act(async () => {
      photo.props.onError?.({ nativeEvent: { error: '404' } });
    });

    expect(screen.queryByTestId('app-bar-account-avatar', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('app-bar-account-icon')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Hồ sơ' })).toBeOnTheScreen();
  });

  test('follows the profile reload after a photo is saved or removed', async () => {
    mockSession.value = { kind: 'authenticated', role: 'student', accountId: 'acct-1', capabilities: [] };
    mockProfile.value = {
      id: 'acct-1',
      email: 'minh.nguyen@ute.edu.vn',
      avatar: 'https://cdn.ute.edu.vn/avatars/saved.png',
    };

    await render(wrap(
      <>
        <AppBar role="student" onProfile={() => {}} />
        <ProfileRefreshProbe />
      </>,
    ));

    await waitFor(() => {
      expect(screen.getByTestId('app-bar-account-avatar', { includeHiddenElements: true }).props.source)
        .toEqual({ uri: 'https://cdn.ute.edu.vn/avatars/saved.png' });
    });

    mockProfile.value = {
      id: 'acct-1',
      email: 'minh.nguyen@ute.edu.vn',
      avatar: 'https://cdn.ute.edu.vn/avatars/replaced.png',
    };
    await fireEvent.press(screen.getByTestId('profile-refresh'));
    await waitFor(() => {
      expect(screen.getByTestId('app-bar-account-avatar', { includeHiddenElements: true }).props.source)
        .toEqual({ uri: 'https://cdn.ute.edu.vn/avatars/replaced.png' });
    });

    mockProfile.value = { id: 'acct-1', email: 'minh.nguyen@ute.edu.vn', avatar: null };
    await fireEvent.press(screen.getByTestId('profile-refresh'));
    await waitFor(() => {
      expect(screen.getByTestId('app-bar-account-icon')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('app-bar-account-avatar', { includeHiddenElements: true })).toBeNull();
  });
});
