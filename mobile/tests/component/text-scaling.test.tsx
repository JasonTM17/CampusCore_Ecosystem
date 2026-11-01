import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { Button, ListRow } from '../../src/components/Ui';
import { StatusPill } from '../../src/components/ui/institutional';
import { UiText } from '../../src/components/ui/UiText';
import { compactFontScaleCap } from '../../src/design/font-scale';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { civilKey, weekDates } from '../../src/screens/academic/academic-model';
import { WeekStrip } from '../../src/screens/academic/WeekStrip';

function setFontScale(fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
}

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

afterEach(() => { jest.restoreAllMocks(); });

describe('text scaling at 2.0', () => {
  test('UiText caps the multiplier at the token and honors a lower override', async () => {
    setFontScale(2);
    await render(wrap(
      <>
        <UiText>default</UiText>
        <UiText maxFontSizeMultiplier={1.3}>chrome</UiText>
        <UiText maxFontSizeMultiplier={3}>above cap</UiText>
      </>,
    ));
    expect(tokens.typography.maxFontScale).toBe(2);
    expect(screen.getByText('default').props.maxFontSizeMultiplier).toBe(2);
    expect(screen.getByText('chrome').props.maxFontSizeMultiplier).toBe(1.3);
    expect(screen.getByText('above cap').props.maxFontSizeMultiplier).toBe(2);
  });

  test('ListRow keeps the primary title untruncated and stacks meta at 2.0', async () => {
    setFontScale(2);
    await render(wrap(<ListRow title="Giải tích" subtitle="MA101" meta="07:00 – 09:00" />));
    expect(screen.getByText('Giải tích').props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId('list-row-copy')).toContainElement(screen.getByText('07:00 – 09:00'));
  });

  test('ListRow keeps meta in its own column below the 1.3 threshold', async () => {
    setFontScale(1);
    await render(wrap(<ListRow title="Giải tích" subtitle="MA101" meta="07:00 – 09:00" />));
    expect(screen.getByTestId('list-row-copy')).not.toContainElement(screen.getByText('07:00 – 09:00'));
  });

  test('Button grows from minHeight instead of a fixed height', async () => {
    setFontScale(2);
    await render(wrap(<Button label="Đăng ký học phần" onPress={() => {}} />));
    const style = StyleSheet.flatten(screen.getByRole('button').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
    expect(style.height).toBeUndefined();
  });

  test('StatusPill keeps compact chrome above the metadata and never a fixed height', async () => {
    setFontScale(2);
    await render(wrap(<StatusPill label="Đã hoàn thành" tone="success" />));
    const label = screen.getByText('Đã hoàn thành');
    expect(label.props.maxFontSizeMultiplier).toBe(compactFontScaleCap);
    const pill = label.parent;
    expect(pill).not.toBeNull();
    const style = StyleSheet.flatten(pill?.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(tokens.spacing.xl);
    expect(style.height).toBeUndefined();
  });

  test('the week strip wraps and keeps 44dp day cells at 2.0', async () => {
    setFontScale(2);
    const days = weekDates(new Date(2026, 10, 2));
    await render(wrap(
      <WeekStrip
        days={days}
        selectedIndex={2}
        todayKey={civilKey(days[0])}
        labels={['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']}
        onSelect={() => {}}
      />,
    ));
    expect(StyleSheet.flatten(screen.getByTestId('week-strip').props.style).flexWrap).toBe('wrap');
    const cells = screen.getAllByRole('button');
    expect(cells).toHaveLength(7);
    for (const cell of cells) {
      const style = StyleSheet.flatten(cell.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
      expect(style.height).toBeUndefined();
    }
    expect(screen.getByText('T2').props.numberOfLines).toBeUndefined();
  });
});
