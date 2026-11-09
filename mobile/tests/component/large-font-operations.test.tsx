import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { operationsMessages } from '../../src/i18n/operations-messages';
import { AttendanceRosterRow } from '../../src/screens/operations/AttendanceRosterRow';
import { GradeRowCard } from '../../src/screens/operations/GradeRowCard';
import type { GradeRowLike, RosterRow } from '../../src/screens/operations/lecturer-model';

function setWindow(width: number, fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({
    width,
    height: 800,
    scale: 2,
    fontScale,
  } as ReturnType<typeof Dimensions.get>);
}

function renderThemed(element: ReactElement) {
  return render(
    <LocaleProvider initialLocale="en">
      <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
    </LocaleProvider>,
  );
}

afterEach(() => { jest.restoreAllMocks(); });

describe('lecturer rows at large text sizes', () => {
  test('attendance choices and the clear action remain reachable at 360dp / 2x text', async () => {
    setWindow(360, 2);
    const onChange = jest.fn();
    const row: RosterRow = {
      studentId: 'student-1',
      studentCode: '2110001',
      name: 'An Nguyen',
      status: null,
      notes: '',
      stored: false,
    };

    await renderThemed(<AttendanceRosterRow row={row} copy={operationsMessages.en} onChange={onChange} />);

    const choices = screen.getAllByRole('radio');
    expect(choices).toHaveLength(4);
    const clearAction = screen.getByRole('button', { name: /An Nguyen/ });
    const rowStyle = StyleSheet.flatten(choices[0].parent?.props.style);
    expect(rowStyle.flexWrap).toBe('wrap');
    expect(rowStyle.gap).toBe(tokens.spacing.xs);
    for (const choice of choices) {
      const style = StyleSheet.flatten(choice.props.style);
      expect(style.flexGrow).toBe(0);
      expect(style.flexShrink).toBe(1);
      expect(style.minWidth).toBeGreaterThanOrEqual(48);
      expect(style.maxWidth).toBe('100%');
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
      expect(choice.props.accessibilityLabel).toContain('An Nguyen');
    }
    const clearStyle = StyleSheet.flatten(clearAction.props.style);
    expect(clearStyle.minWidth).toBeGreaterThanOrEqual(48);
    expect(clearStyle.minHeight).toBeGreaterThanOrEqual(48);
    expect(clearAction.props.accessibilityLabel).toContain('An Nguyen');
    expect(StyleSheet.flatten(screen.getByText('Present').props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 });

    await fireEvent.press(choices[0]);
    expect(onChange).toHaveBeenCalledWith('student-1', 'PRESENT');
  });

  test('score fields wrap to full-width rows while retaining their accessible names at 360dp / 2x text', async () => {
    setWindow(360, 2);
    const onEdit = jest.fn();
    const row: GradeRowLike = {
      enrollmentId: 'enrollment-1',
      studentCode: '2110001',
      studentName: 'An Nguyen',
      processScore: null,
      finalExamScore: null,
    };

    await renderThemed(
      <GradeRowCard row={row} edit={undefined} problems={undefined} copy={operationsMessages.en} onEdit={onEdit} />,
    );

    const fields = [
      screen.getByLabelText(/Coursework/),
      screen.getByLabelText(/Final \(50%\)/),
    ];
    const rowStyle = StyleSheet.flatten(fields[0].parent?.parent?.props.style);
    expect(rowStyle.flexWrap).toBe('wrap');

    for (const field of fields) {
      const fieldStyle = StyleSheet.flatten(field.parent?.props.style);
      expect(fieldStyle.flexBasis).toBe('100%');
      expect(fieldStyle.flexShrink).toBe(1);
      expect(fieldStyle.minWidth).toBe(0);
      expect(field.props.accessibilityLabel).toContain('An Nguyen');
      expect(StyleSheet.flatten(field.props.style).minHeight).toBeGreaterThanOrEqual(tokens.layout.touchTarget);
    }

    await fireEvent.changeText(fields[0], '8.5');
    expect(onEdit).toHaveBeenCalledWith('enrollment-1', 'processScore', '8.5');
  });

  test('base-size attendance chips keep their 390dp layout', async () => {
    setWindow(390, 1);
    const rosterRow: RosterRow = {
      studentId: 'student-1',
      studentCode: '2110001',
      name: 'An Nguyen',
      status: null,
      notes: '',
      stored: false,
    };
    await renderThemed(
      <AttendanceRosterRow row={rosterRow} copy={operationsMessages.en} onChange={jest.fn()} />,
    );
    expect(StyleSheet.flatten(screen.getAllByRole('radio')[0].props.style).flexGrow).toBe(1);
  });

  test('base-size score fields keep their 390dp layout', async () => {
    setWindow(390, 1);
    const row: GradeRowLike = {
      enrollmentId: 'enrollment-1',
      studentCode: '2110001',
      studentName: 'An Nguyen',
      processScore: null,
      finalExamScore: null,
    };
    await renderThemed(
      <GradeRowCard row={row} edit={undefined} problems={undefined} copy={operationsMessages.en} onEdit={jest.fn()} />,
    );
    const field = screen.getByLabelText(/Coursework/);
    expect(StyleSheet.flatten(field.parent?.parent?.props.style).flexWrap).toBeUndefined();
    expect(StyleSheet.flatten(field.parent?.props.style).flexBasis).toBeUndefined();
  });
});
