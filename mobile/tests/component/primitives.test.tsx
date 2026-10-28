import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { StyleSheet } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import {
  Toast,
  Notice,
  Skeleton,
  SearchBar,
  SegmentedControl,
  EmptyState,
  InlineError,
  FormField,
  Button,
} from '../../src/components/ui/index';

describe('Toast', () => {
  test('live region polite and dismiss works', async () => {
    const onDismiss = jest.fn();
    await render(<Toast visible message="Đã lưu" onDismiss={onDismiss} />);
    const toast = screen.getByText('Đã lưu');
    expect(toast).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(onDismiss).toHaveBeenCalled();
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
  test('typing and clear button', async () => {
    const onChangeText = jest.fn();
    await render(<SearchBar value="" onChangeText={onChangeText} placeholder="Tìm lớp" />);
    const input = screen.getByLabelText('Tìm lớp');
    fireEvent.changeText(input, 'Toán');
    expect(onChangeText).toHaveBeenCalledWith('Toán');
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
