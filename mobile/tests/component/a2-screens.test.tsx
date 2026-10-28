import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  campusApi: new Proxy({}, { get: () => jest.fn(async () => ({ data: [] })) }),
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({
    data: undefined, error: null, warning: null,
    isLoading: false, reload: jest.fn(), setData: jest.fn(),
  }),
}));

import { LecturerDashboardScreen, LecturerScheduleScreen } from '../../src/screens/operations/OperationsScreens';
import { EventsScreen } from '../../src/screens/student/EventsScreen';
import { LibraryScreen } from '../../src/screens/student/LibraryScreen';
import { NewsScreen } from '../../src/screens/student/NewsScreen';
import { AssistantChatScreen } from '../../src/screens/assistant/AssistantScreen';
import { BottomNavigation } from '../../src/components/BottomNavigation';
import { MenuPanel } from '../../src/components/MenuPanel';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

function setWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}
afterEach(() => { jest.restoreAllMocks(); });
const renderThemed = (el: ReactElement, scheme: 'light' | 'dark' = 'light') =>
  render(<ThemeProvider forcedScheme={scheme}>{el}</ThemeProvider>);
const rootBg = () => StyleSheet.flatten(screen.toJSON()?.props.style)?.backgroundColor;

describe('operations screens', () => {
  test('lecturer dashboard renders preview content', async () => {
    setWidth(360);
    await renderThemed(<LecturerDashboardScreen {...props} />);
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });
  test('lecturer schedule renders + background follows scheme', async () => {
    setWidth(700);
    await renderThemed(<LecturerScheduleScreen {...props} />, 'light');
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
    expect(rootBg()).toBe(tokens.colors.background);
    await renderThemed(<LecturerScheduleScreen {...props} />, 'dark');
    expect(rootBg()).toBe(tokens.colorsDark.background);
  });
});

describe('student domain screens', () => {
  test('events renders header', async () => {
    setWidth(360);
    await renderThemed(<EventsScreen {...props} />);
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });
  test('library renders header', async () => {
    setWidth(360);
    await renderThemed(<LibraryScreen {...props} />);
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });
  test('news renders header', async () => {
    setWidth(1000);
    await renderThemed(<NewsScreen {...props} />);
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });
});

describe('assistant + chrome', () => {
  test('assistant renders composer', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    expect(screen.getAllByLabelText(/question|câu hỏi/i).length).toBeGreaterThan(0);
  });
  test('bottom navigation exposes tabs with selected state', async () => {
    setWidth(360);
    await renderThemed(
      <BottomNavigation activeRoute="dashboard.student" role="student" onNavigate={() => {}} onMenu={() => {}} />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(1);
    expect(tabs.some((t) => t.props.accessibilityState?.selected)).toBe(true);
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeOnTheScreen();
  });
  test('menu panel lists navigation and close', async () => {
    setWidth(360);
    const onClose = jest.fn();
    await renderThemed(
      <MenuPanel activeRoute="dashboard.student" role="student" onClose={onClose} onNavigate={() => {}} onSwitchRole={() => {}} allowRoleSwitch={false} />,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeOnTheScreen();
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });
});
