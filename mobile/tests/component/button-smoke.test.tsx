import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Badge, Button } from '../../src/components/Ui';

describe('Button (Ui.tsx)', () => {
  test('renders label with button role and calls onPress', async () => {
    const onPress = jest.fn();
    await render(<Button label="Lưu thay đổi" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Lưu thay đổi' });
    expect(button).toBeOnTheScreen();
    expect(screen.getByText('Lưu thay đổi')).toBeOnTheScreen();

    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Gửi" onPress={onPress} disabled />);

    const button = screen.getByRole('button', { name: 'Gửi' });
    expect(button).toBeDisabled();

    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Badge (Ui.tsx)', () => {
  test('renders label text', async () => {
    await render(<Badge label="Beta" tone="primary" />);
    expect(screen.getByText('Beta')).toBeOnTheScreen();
  });
});
