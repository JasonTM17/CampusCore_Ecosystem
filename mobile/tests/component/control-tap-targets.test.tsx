import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { minTapTarget } from '../../src/design/tokens';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  campusApi: {},
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'preview', role: 'student', capabilities: [] }),
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({
    data: undefined,
    error: null,
    warning: null,
    isLoading: false,
    reload: jest.fn(),
    setData: jest.fn(),
  }),
}));
jest.mock('../../src/screens/account/account-api', () => ({
  accountApi: {
    twoFactorStatus: jest.fn(async () => ({ enabled: false })),
    beginTwoFactorEnable: jest.fn(),
    confirmTwoFactorEnable: jest.fn(),
    beginTwoFactorDisable: jest.fn(),
    confirmTwoFactorDisable: jest.fn(),
  },
}));

import { SecureField } from '../../src/screens/account/SecureField';
import { TwoFactorCard } from '../../src/screens/account/TwoFactorCard';
import { NotificationsScreen } from '../../src/screens/student/NotificationsScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

function flattened(style: unknown) {
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved);
}

describe('48dp controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('show-password control is at least 48dp', async () => {
    await render(wrap(
      <SecureField
        label="Mật khẩu"
        value=""
        onChangeText={() => {}}
        showLabel="Hiện mật khẩu"
        hideLabel="Ẩn mật khẩu"
        autoComplete="current-password"
      />,
    ));
    const style = flattened(screen.getByRole('button', { name: 'Hiện mật khẩu' }).props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
    expect(style.minHeight).toBeGreaterThanOrEqual(minTapTarget);
  });

  test('notification delete control is at least 48dp', async () => {
    await render(wrap(<NotificationsScreen {...props} />));
    const button = screen.getByRole('button', { name: /Xóa thông báo: Mở đăng ký đề tài luận văn/ });
    const style = flattened(button.props.style);
    expect(style.width).toBeGreaterThanOrEqual(minTapTarget);
    expect(style.height).toBeGreaterThanOrEqual(minTapTarget);
  });

  test('two-factor title keeps the full row and the status sits below it', async () => {
    await render(wrap(<TwoFactorCard email="student@campuscore.edu" onCompleted={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText('Chưa bật')).toBeOnTheScreen();
    });
    const title = screen.getByRole('header', { name: 'Xác thực hai yếu tố' });
    expect(flattened(title.props.style)?.flex).toBeUndefined();
    const titleRow = title.parent;
    const pill = screen.getByText('Chưa bật');
    expect(pill.parent).not.toBe(titleRow);
  });
});
