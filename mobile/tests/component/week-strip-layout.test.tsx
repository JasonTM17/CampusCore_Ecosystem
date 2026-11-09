import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { civilKey, weekDates } from '../../src/screens/academic/academic-model';
import { WeekStrip } from '../../src/screens/academic/WeekStrip';

const weekStripFontScaleCap = 1.2;

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

describe('week strip layout', () => {
  test('keeps seven equal flex cells on one row with single-line capped labels', async () => {
    const days = weekDates(new Date(2026, 10, 2));
    await render(wrap(
      <WeekStrip
        days={days}
        selectedIndex={0}
        todayKey={civilKey(days[0])}
        labels={['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']}
        todayLabel="HÔM NAY"
        onSelect={() => {}}
      />,
    ));

    const stripStyle = StyleSheet.flatten(screen.getByTestId('week-strip').props.style);
    expect(stripStyle.flexWrap).toBe('nowrap');
    expect(stripStyle.flexDirection).toBe('row');

    const cells = screen.getAllByRole('button');
    expect(cells).toHaveLength(7);
    for (const cell of cells) {
      const style = StyleSheet.flatten(cell.props.style);
      expect(style.flex).toBe(1);
      expect(style.minWidth).toBe(0);
      expect(style.flexShrink).toBe(1);
    }

    const dayLabel = screen.getByText('CN');
    expect(dayLabel.props.numberOfLines).toBe(1);
    expect(dayLabel.props.adjustsFontSizeToFit).toBe(true);
    expect(dayLabel.props.maxFontSizeMultiplier).toBe(weekStripFontScaleCap);

    const todayBadge = screen.getByText('HÔM NAY');
    expect(todayBadge.props.numberOfLines).toBe(1);
    expect(todayBadge.props.adjustsFontSizeToFit).toBe(true);
    expect(todayBadge.props.maxFontSizeMultiplier).toBe(weekStripFontScaleCap);
    expect(StyleSheet.flatten(cells[0].props.style).minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
  });
});
