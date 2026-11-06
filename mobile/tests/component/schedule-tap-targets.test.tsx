import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { minTapTarget } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { civilKey, weekDates } from '../../src/screens/academic/academic-model';
import { WeekStrip } from '../../src/screens/academic/WeekStrip';
import { ScheduleScreen } from '../../src/screens/student/ScheduleScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'preview' }, campusApi: {} }));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({
    data: undefined,
    error: null,
    warning: null,
    errorStatus: null,
    isLoading: false,
    isStale: false,
    reload: jest.fn(async () => {}),
    setData: jest.fn(),
  }),
}));

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

afterEach(() => { jest.restoreAllMocks(); });

describe('schedule tap targets', () => {
  test('week arrows keep a 48dp minimum width and height', async () => {
    await render(wrap(<ScheduleScreen {...props} />));
    for (const name of ['Tuần trước', 'Tuần sau']) {
      const style = StyleSheet.flatten(screen.getByRole('button', { name }).props.style);
      expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
      expect(style.minHeight).toBeGreaterThanOrEqual(minTapTarget);
    }
  });

  test('week strip day cells keep a 48dp minimum width and height', async () => {
    const days = weekDates(new Date(2026, 10, 2));
    await render(wrap(
      <WeekStrip
        days={days}
        selectedIndex={0}
        todayKey={civilKey(days[0])}
        labels={['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']}
        onSelect={() => {}}
      />,
    ));
    const cell = screen.getAllByRole('button')[0];
    const style = StyleSheet.flatten(cell.props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
    expect(style.minHeight).toBeGreaterThanOrEqual(minTapTarget);
  });
});
