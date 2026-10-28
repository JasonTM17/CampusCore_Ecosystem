import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  Sheet,
  Dialog,
  Button,
} from '../../src/components/ui/index';

describe('Sheet', () => {
  test('renders title when visible and close calls onClose', async () => {
    const onClose = jest.fn();
    await render(<Sheet visible onClose={onClose} title="Chọn môn" />);
    expect(screen.getByText('Chọn môn')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng bảng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  test('renders nothing when hidden', async () => {
    await render(<Sheet visible={false} onClose={() => {}} title="Ẩn" />);
    expect(screen.queryByText('Ẩn')).toBeNull();
  });
});

describe('Dialog', () => {
  test('confirm and cancel callbacks fire', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(
      <Dialog visible title="Xóa?" description="Không thể hoàn tác" confirmLabel="Xóa" cancelLabel="Hủy" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Xóa' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Hủy' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
