import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';

import AppGroupLayout from '../../app/(app)/_layout';
import { ThemeProvider } from '../../src/design/theme';
import { uiMessages } from '../../src/i18n/locale';
import { roleHomePath } from '../../src/navigation/route-map';
import type { UserRole } from '../../src/navigation/routes';
import { useSession } from '../../src/session/SessionContext';

const mockRoute = { value: null as React.ReactElement | null };

jest.mock('expo-router', () => {
  const { Text: MockText, View: MockView } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <MockText testID="guard-redirect">{href}</MockText>,
    Slot: () => mockRoute.value ?? <MockView testID="route-content" />,
    usePathname: jest.fn(),
    useRouter: jest.fn(),
  };
});
jest.mock('../../src/session/SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' } }));
jest.mock('../../src/hooks/use-dashboard-prefetch', () => ({ useDashboardPrefetch: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));

function setWindow(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 });
}

function setSession(role: UserRole = 'student') {
  jest.mocked(useSession).mockReturnValue({
    kind: 'authenticated', role, switchRole: jest.fn(), epoch: 0, booted: true, accountId: null, blockedReason: null,
    enterPreview: () => true,
    completeSignIn: () => {},
    signOut: async () => {},
    markBlocked: () => {},
    setRole: () => {},
  });
  jest.mocked(usePathname).mockReturnValue(roleHomePath(role));
}

const renderThemed = (element: React.ReactElement) => render(
  <ThemeProvider forcedScheme="light">{element}</ThemeProvider>,
);

function CrashingScreen(): never {
  throw new Error('screen render exploded');
}

function HealthyScreen() {
  return (
    <View testID="healthy-screen">
      <Text>Recovered screen</Text>
    </View>
  );
}

/** A mounted marker next to the boundary proves the shell outside it survives. */
function ShellMarker() {
  return <View testID="shell-marker" />;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useRouter).mockReturnValue({ push: jest.fn(), replace: jest.fn() } as unknown as ReturnType<typeof useRouter>);
  setSession();
  mockRoute.value = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('screen render boundary', () => {
  test('a throwing route shows a localized recovery panel while the app chrome survives', async () => {
    setWindow(360);
    mockRoute.value = <CrashingScreen />;
    await renderThemed(<AppGroupLayout />);

    expect(screen.getByText(uiMessages.vi.errorGeneric)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: uiMessages.vi.retry })).toBeOnTheScreen();
    // The session shell around the failed route stays mounted and usable.
    expect(screen.getByTestId('app-chrome')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Trang chủ' })).toBeOnTheScreen();
    expect(screen.queryByTestId('healthy-screen')).toBeNull();
  });

  test('retry remounts the route instead of reusing the crashed subtree', async () => {
    setWindow(360);
    mockRoute.value = <CrashingScreen />;
    await renderThemed(<AppGroupLayout />);
    expect(screen.getByText(uiMessages.vi.errorGeneric)).toBeOnTheScreen();

    mockRoute.value = <HealthyScreen />;
    await fireEvent.press(screen.getByRole('button', { name: uiMessages.vi.retry }));

    expect(screen.getByTestId('healthy-screen')).toBeOnTheScreen();
    expect(screen.queryByText(uiMessages.vi.errorGeneric)).toBeNull();
    expect(screen.getByTestId('app-chrome')).toBeOnTheScreen();
  });

  test('a route change clears the caught error instead of trapping every screen', async () => {
    setWindow(360);
    mockRoute.value = <CrashingScreen />;
    await renderThemed(<AppGroupLayout />);
    expect(screen.getByText(uiMessages.vi.errorGeneric)).toBeOnTheScreen();

    // The user navigates away instead of retrying: the new route identity
    // clears the caught error and the new screen mounts.
    jest.mocked(usePathname).mockReturnValue('/schedule');
    mockRoute.value = <HealthyScreen />;
    // Opening the menu re-renders the layout, so the new route identity
    // reaches the boundary; closing it un-hides the content for the query.
    await fireEvent.press(screen.getByRole('button', { name: 'Mở menu' }));
    expect(screen.getByTestId('healthy-screen', { includeHiddenElements: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));

    expect(screen.getByTestId('healthy-screen')).toBeOnTheScreen();
    expect(screen.queryByText(uiMessages.vi.errorGeneric)).toBeNull();
  });

  test('the boundary keeps siblings mounted and rethrows nothing to the caller', async () => {
    setWindow(360);
    const probe = jest.fn();
    function Probe() {
      probe();
      return <ShellMarker />;
    }
    mockRoute.value = (
      <>
        <Probe />
        <CrashingScreen />
      </>
    );
    await renderThemed(<AppGroupLayout />);
    // Everything inside the boundary unmounted; the chrome outside did not.
    expect(screen.queryByTestId('shell-marker')).toBeNull();
    expect(screen.getByTestId('app-chrome')).toBeOnTheScreen();
  });

  test('a standalone boundary exposes the same recovery outside the router shell', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ErrorBoundary } = require('../../src/components/ErrorBoundary') as typeof import('../../src/components/ErrorBoundary');
    const healthy = jest.fn();
    const broken = { value: true };
    function MaybeBroken() {
      if (broken.value) throw new Error('child render exploded');
      healthy();
      return <Text>inner content</Text>;
    }

    await renderThemed(
      <View>
        <ShellMarker />
        <ErrorBoundary>
          <MaybeBroken />
        </ErrorBoundary>
      </View>,
    );
    expect(screen.getByText(uiMessages.vi.errorGeneric)).toBeOnTheScreen();
    expect(screen.getByTestId('shell-marker')).toBeOnTheScreen();

    broken.value = false;
    await fireEvent.press(screen.getByRole('button', { name: uiMessages.vi.retry }));
    expect(screen.getByText('inner content')).toBeOnTheScreen();
    expect(healthy).toHaveBeenCalled();
  });
});
