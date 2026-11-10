import { describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { StyleSheet } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import {
  Toast,
  Notice,
  Skeleton,
  SearchBar,
  SegmentedControl,
  EmptyState,
  InlineError,
  FormField,
  Sheet,
  Button,
} from '../../src/components/ui/index';

describe('Toast', () => {
  test('auto-dismisses after its duration', async () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    await render(<Toast visible message="Đã lưu" onDismiss={onDismiss} />);
    expect(screen.getByText('Đã lưu')).toBeOnTheScreen();
    await act(async () => { jest.advanceTimersByTime(4000); });
    expect(onDismiss).toHaveBeenCalled();
    jest.useRealTimers();
  });
  test('error tone uses assertive alert', async () => {
    await render(<Toast visible message="Lỗi mạng" tone="error" />);
    expect(screen.getByRole('alert')).toBeOnTheScreen();
  });
});

describe('Notice', () => {
  test('renders message and action', async () => {
    const onAction = jest.fn();
    await render(<Notice message="Dữ liệu có thể cũ" tone="warning" actionLabel="Tải lại" onAction={onAction} />);
    expect(screen.getByText('Dữ liệu có thể cũ')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Tải lại' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('Skeleton', () => {
  test('reduced motion renders static opacity', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await render(<Skeleton testID="skel" height={20} />);
    const el = screen.getByTestId('skel');
    const flat = StyleSheet.flatten(el.props.style);
    expect(flat.opacity).toBe(1);
    jest.restoreAllMocks();
  });
});

describe('SearchBar', () => {
  test('input meets the 48dp minimum height', async () => {
    await render(<SearchBar value="" onChangeText={() => {}} placeholder="Tìm lớp" />);
    const input = screen.getByLabelText('Tìm lớp');
    const style = StyleSheet.flatten(input.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });

  test('typing and clear button', async () => {
    const onChangeText = jest.fn();
    await render(<SearchBar value="" onChangeText={onChangeText} placeholder="Tìm lớp" />);
    const input = screen.getByLabelText('Tìm lớp');
    expect(input.props.multiline).toBe(false);
    fireEvent.changeText(input, 'Toán');
    expect(onChangeText).toHaveBeenCalledWith('Toán');
  });

  test('submits from the keyboard', async () => {
    const onSubmitEditing = jest.fn();
    await render(<SearchBar value="" onChangeText={() => {}} onSubmitEditing={onSubmitEditing} placeholder="Tìm lớp" />);
    const input = screen.getByLabelText('Tìm lớp');
    fireEvent(input, 'submitEditing');
    expect(onSubmitEditing).toHaveBeenCalledTimes(1);
  });
  test('hides the placeholder once typed', async () => {
    await render(<SearchBar value="Toán" onChangeText={() => {}} placeholder="Tìm lớp" />);
    expect(screen.queryByText('Tìm lớp')).toBeNull();
  });
  test('clear calls onClear', async () => {
    const onClear = jest.fn();
    await render(<SearchBar value="abc" onChangeText={() => {}} onClear={onClear} />);
    fireEvent.press(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('SegmentedControl', () => {
  test('selected state and onChange', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        accessibilityLabel="Chọn kỳ"
        options={[{ value: 'a', label: 'Kỳ 1' }, { value: 'b', label: 'Kỳ 2' }]}
        value="a"
        onChange={onChange}
      />,
    );
    const a = screen.getByRole('tab', { name: 'Kỳ 1' });
    const b = screen.getByRole('tab', { name: 'Kỳ 2' });
    expect(a).toBeSelected();
    expect(b).not.toBeSelected();
    fireEvent.press(b);
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('EmptyState', () => {
  test('title, description and action', async () => {
    const onAction = jest.fn();
    await render(<EmptyState title="Chưa có dữ liệu" description="Kéo để tải lại" actionLabel="Thử lại" onAction={onAction} />);
    expect(screen.getByRole('header', { name: 'Chưa có dữ liệu' })).toBeOnTheScreen();
    expect(screen.getByText('Kéo để tải lại')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test('matches the shared state panel empty geometry', async () => {
    await render(<EmptyState title="Chưa có dữ liệu" description="Kéo để tải lại" />);
    const title = screen.getByRole('header', { name: 'Chưa có dữ liệu' });
    const container = title.parent?.parent;
    const style = StyleSheet.flatten(container?.props.style);
    expect(style.borderStyle).toBe('dashed');
    expect(style.minHeight).toBe(220);
    expect(style.flexDirection).toBe('column');
    expect(style.justifyContent).toBe('center');
    expect(style.backgroundColor).toBe(tokens.colors.background);
    expect(JSON.stringify(screen.toJSON())).toContain('"width":40,"height":40');
  });
});

describe('InlineError', () => {
  test('alert role and retry', async () => {
    const onRetry = jest.fn();
    await render(<InlineError message="Không tải được" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Thử lại'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('FormField', () => {
  test('address value wraps without changing the stored text', async () => {
    const value = 'Phường Buôn Ma Thuột, Tỉnh Đắk Lắk';
    await render(<FormField label="Địa chỉ" value={value} multiline />);
    const input = screen.getByLabelText('Địa chỉ');
    expect(input.props.value).toBe(value);
    expect(input.props.multiline).toBe(true);
  });

  test('label, hint and error states', async () => {
    await render(<FormField label="Email" hint="Dùng email trường" />);
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
    expect(screen.getByText('Dùng email trường')).toBeOnTheScreen();
  });
  test('error shows alert', async () => {
    await render(<FormField label="Email" error="Sai định dạng" />);
    expect(screen.getByRole('alert', { name: 'Sai định dạng' })).toBeOnTheScreen();
  });
});

describe('localized chrome strings (ux-m1-02)', () => {
  test('Sheet close button localizes to english', async () => {
    await render(
      <LocaleProvider initialLocale="en">
        <Sheet visible onClose={() => {}} title="Pick a course" />
      </LocaleProvider>,
    );
    expect(screen.getByRole('button', { name: 'Close sheet' })).toBeOnTheScreen();
    expect(screen.getByText('Close')).toBeOnTheScreen();
  });

  test('explicit Sheet labels still win over the locale', async () => {
    await render(
      <LocaleProvider initialLocale="en">
        <Sheet visible onClose={() => {}} title="Chọn" closeLabel="Đóng nhanh" closeAccessibilityLabel="Đóng bảng nhanh" />
      </LocaleProvider>,
    );
    expect(screen.getByRole('button', { name: 'Đóng bảng nhanh' })).toBeOnTheScreen();
    expect(screen.getByText('Đóng nhanh')).toBeOnTheScreen();
  });

  test('Toast shows its message in english', async () => {
    await render(
      <LocaleProvider initialLocale="en">
        <Toast visible message="Saved" onDismiss={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.getByText('Saved')).toBeOnTheScreen();
  });

  test('SearchBar input fallback and clear button localize to english', async () => {
    await render(
      <LocaleProvider initialLocale="en">
        <SearchBar value="abc" onChangeText={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText('Search')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeOnTheScreen();
  });

  test('InlineError retry fallback localizes to english', async () => {
    await render(
      <LocaleProvider initialLocale="en">
        <InlineError message="Could not load" onRetry={() => {}} />
      </LocaleProvider>,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  test('FormField required hint stays vietnamese by default', async () => {
    await render(<FormField label="Email" required />);
    expect(screen.getByLabelText('Email').props.accessibilityHint).toBe('bắt buộc');
  });

  test('FormField required hint localizes to english', async () => {
    await render(
      <LocaleProvider initialLocale="en">
        <FormField label="Student code" required />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText('Student code').props.accessibilityHint).toBe('required');
  });
});

describe('theme', () => {
  test('dark scheme switches Button primary color', async () => {
    await render(
      <ThemeProvider forcedScheme="dark">
        <Button label="Lưu" onPress={() => {}} />
      </ThemeProvider>,
    );
    const btn = screen.getByRole('button', { name: 'Lưu' });
    const raw = btn.props.style;
    const flat = StyleSheet.flatten(typeof raw === 'function' ? raw({ pressed: false }) : raw);
    expect(flat.backgroundColor).toBe(tokens.colorsDark.primary);
  });
  test('light scheme keeps light primary', async () => {
    await render(
      <ThemeProvider forcedScheme="light">
        <Button label="Lưu" onPress={() => {}} />
      </ThemeProvider>,
    );
    const btn = screen.getByRole('button', { name: 'Lưu' });
    const raw = btn.props.style;
    const flat = StyleSheet.flatten(typeof raw === 'function' ? raw({ pressed: false }) : raw);
    expect(flat.backgroundColor).toBe(tokens.colors.primary);
  });
});
