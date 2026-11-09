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
  test('week arrows use hit slop instead of widening the picker row', async () => {
    await render(wrap(<ScheduleScreen {...props} />));
    for (const name of ['Tuần trước', 'Tuần sau']) {
      const control = screen.getByRole('button', { name });
      const style = StyleSheet.flatten(control.props.style);
      expect(style.minWidth).toBeUndefined();
      const hitSlop = control.props.hitSlop;
      expect(hitSlop).toMatchObject({
        top: expect.any(Number),
        bottom: expect.any(Number),
        left: expect.any(Number),
        right: expect.any(Number),
      });
    }
  });

  test('week strip day cells flex equally but keep a 48dp minimum height', async () => {
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
    expect(style.flex).toBe(1);
    expect(style.minWidth).toBe(0);
    expect(style.minHeight).toBeGreaterThanOrEqual(minTapTarget);
  });
});
