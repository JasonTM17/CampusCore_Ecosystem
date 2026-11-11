import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, Pressable, StyleSheet, Text } from 'react-native';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
}));
jest.mock('../../src/session/SessionContext', () => ({ useOptionalSession: () => null }));
jest.mock('../../src/hooks/useScreenQuery', () => ({ useScreenQuery: () => ({ data: undefined }) }));

import { AppBar } from '../../src/components/AppBar';
import { ThemeProvider, useTheme } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { ThemeSetting } from '../../src/screens/account/ThemeSetting';

const THEME_KEY = 'campusute.theme';

function storageWith(saved: string | null) {
  return {
    getItem: jest.fn(async (_key: string): Promise<string | null> => saved),
    setItem: jest.fn(async (_key: string, _value: string): Promise<void> => undefined),
  };
}

function ThemeProbe() {
  const { preference, scheme } = useTheme();
  return (
    <>
      <Text testID="preference">{preference}</Text>
      <Text testID="scheme">{scheme}</Text>
    </>
  );
}

function PreferenceSetter() {
  const { preference, setPreference } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`to-dark-${preference}`} onPress={() => setPreference('dark')}>
      <Text>dark</Text>
    </Pressable>
  );
}

function appBar(storage = storageWith(null), preference?: 'system' | 'light' | 'dark', locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider storage={storage} initialPreference={preference}>
      <LocaleProvider initialLocale={locale}>
        <AppBar onSignIn={() => {}} />
        <ThemeProbe />
      </LocaleProvider>
    </ThemeProvider>
  );
}

describe('theme preference', () => {
  test('reads the stored preference and applies it', async () => {
    const storage = storageWith('dark');
    await render(
      <ThemeProvider storage={storage}>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(storage.getItem).toHaveBeenCalledWith(THEME_KEY);
    expect(screen.getByTestId('preference').props.children).toBe('dark');
    expect(screen.getByTestId('scheme').props.children).toBe('dark');
  });

  test('defaults to the system preference when nothing is stored', async () => {
    await render(
      <ThemeProvider storage={storageWith(null)}>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('preference').props.children).toBe('system');
  });

  test('falls back to system and still renders when storage rejects', async () => {
    const storage = {
      getItem: jest.fn(async (_key: string): Promise<string | null> => {
        throw new Error('storage unavailable');
      }),
      setItem: jest.fn(async (_key: string, _value: string): Promise<void> => undefined),
    };
    await render(
      <ThemeProvider storage={storage}>
        <ThemeProbe />
        <Text>shell</Text>
      </ThemeProvider>,
    );

    expect(screen.getByTestId('preference').props.children).toBe('system');
    expect(screen.getByText('shell')).toBeOnTheScreen();
  });

  test('setPreference changes the scheme and persists the choice', async () => {
    const storage = storageWith('light');
    await render(
      <ThemeProvider storage={storage}>
        <ThemeProbe />
        <PreferenceSetter />
      </ThemeProvider>,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'to-dark-light' }));

    expect(screen.getByTestId('preference').props.children).toBe('dark');
    expect(screen.getByTestId('scheme').props.children).toBe('dark');
    expect(storage.setItem).toHaveBeenCalledWith(THEME_KEY, 'dark');
  });

  test('keeps the forced scheme ahead of the stored preference', async () => {
    await render(
      <ThemeProvider forcedScheme="light" storage={storageWith('dark')}>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('preference').props.children).toBe('dark');
    expect(screen.getByTestId('scheme').props.children).toBe('light');
  });
});

describe('AppBar theme control', () => {
  test('cycles light, dark and system and changes the effective scheme', async () => {
    await render(appBar(storageWith(null), 'light'));

    await fireEvent.press(screen.getByRole('button', { name: 'Giao diện sáng, Chuyển sang giao diện tối' }));

    expect(screen.getByTestId('preference').props.children).toBe('dark');
    expect(screen.getByTestId('scheme').props.children).toBe('dark');

    await fireEvent.press(screen.getByRole('button', { name: 'Giao diện tối, Chuyển sang giao diện hệ thống' }));

    expect(screen.getByTestId('preference').props.children).toBe('system');
    expect(screen.getByRole('button', { name: 'Theo hệ thống, Chuyển sang giao diện sáng' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Theo hệ thống, Chuyển sang giao diện sáng' }));

    expect(screen.getByTestId('preference').props.children).toBe('light');
    expect(screen.getByTestId('scheme').props.children).toBe('light');
  });

  test('uses the web labels in English', async () => {
    await render(appBar(storageWith(null), 'light', 'en'));

    expect(screen.getByRole('button', { name: 'Light theme, Switch to dark theme' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Light theme, Switch to dark theme' }));
    expect(screen.getByRole('button', { name: 'Dark theme, Switch to system theme' })).toBeOnTheScreen();
  });

  test('keeps a 48dp target at fontScale 1.3', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 800, scale: 2, fontScale: 1.3 } as ReturnType<typeof Dimensions.get>);
    try {
      await render(appBar(storageWith(null), 'system'));

      const control = screen.getByRole('button', { name: 'Theo hệ thống, Chuyển sang giao diện sáng' });
      const style = StyleSheet.flatten(typeof control.props.style === 'function' ? control.props.style({ pressed: false }) : control.props.style) ?? {};
      expect(style.height ?? style.minHeight).toBeGreaterThanOrEqual(48);
      expect(style.width ?? style.minWidth).toBeGreaterThanOrEqual(48);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('Profile appearance setting', () => {
  test('offers light, dark and system in Vietnamese and saves the choice', async () => {
    const storage = storageWith(null);
    await render(
      <ThemeProvider storage={storage} initialPreference="system">
        <LocaleProvider initialLocale="vi">
          <ThemeSetting />
          <ThemeProbe />
        </LocaleProvider>
      </ThemeProvider>,
    );
    expect(screen.getByText('Giao diện')).toBeOnTheScreen();
    expect(screen.getByText('Sáng')).toBeOnTheScreen();
    expect(screen.getByText('Hệ thống')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Tối'));
    expect(screen.getByTestId('preference').props.children).toBe('dark');
    expect(storage.setItem).toHaveBeenCalledWith(THEME_KEY, 'dark');
  });

  test('uses English labels', async () => {
    await render(
      <ThemeProvider storage={storageWith(null)} initialPreference="light">
        <LocaleProvider initialLocale="en">
          <ThemeSetting />
        </LocaleProvider>
      </ThemeProvider>,
    );
    expect(screen.getByText('Appearance')).toBeOnTheScreen();
    expect(screen.getByText('Light')).toBeOnTheScreen();
    expect(screen.getByText('Dark')).toBeOnTheScreen();
    expect(screen.getByText('System')).toBeOnTheScreen();
  });
});