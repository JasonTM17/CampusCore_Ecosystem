import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { auditTree } from '../a11y/audit';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', baseUrl: 'http://api.test/api/v1' },
  createApiClient: jest.fn(),
  campusApi: {
    profile: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({
    data: { id: 'u1', email: 'minh.nguyen@ute.edu.vn', firstName: 'Minh', lastName: 'Nguyen', studentId: '2022SE0417', phone: '', address: '' },
    error: null,
    warning: null,
    isLoading: false,
    reload: jest.fn(),
    setData: jest.fn(),
  }),
}));
jest.mock('../../src/screens/account/account-api', () => ({
  accountApi: {
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    twoFactorStatus: jest.fn(),
    beginTwoFactorEnable: jest.fn(),
    confirmTwoFactorEnable: jest.fn(),
    beginTwoFactorDisable: jest.fn(),
    confirmTwoFactorDisable: jest.fn(),
  },
}));

import { campusApi } from '../../src/api/client';
import { accountApi } from '../../src/screens/account/account-api';
import { ForgotPasswordScreen } from '../../src/screens/account/ForgotPasswordScreen';
import { LoggedOutScreen } from '../../src/screens/account/LoggedOutScreen';
import { ResetPasswordScreen } from '../../src/screens/account/ResetPasswordScreen';
import { TwoFactorCard } from '../../src/screens/account/TwoFactorCard';
import { setExitNotice } from '../../src/screens/account/exit-notice';
import { ProfileScreen } from '../../src/screens/student/ProfileScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

// Obviously fake, test-only values.
const FAKE_TOKEN = 'fake-reset-token_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FAKE_PASSWORD = 'Fake-pass-1234';
const mocked = <T,>(fn: unknown) => fn as jest.Mock<(...args: unknown[]) => Promise<T>>;

const navigation = {
  navigate: jest.fn(),
  signOut: jest.fn(),
} as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const renderApp = (element: ReactElement, locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{element}</LocaleProvider>
    </ThemeProvider>,
  );

const expectAccessible = () => {
  const result = auditTree(screen.toJSON() as Parameters<typeof auditTree>[0]);
  expect(result.violations).toEqual([]);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('forgot password', () => {
  test('rejects an invalid address locally without calling the API', async () => {
    await renderApp(<ForgotPasswordScreen {...props} />);
    expect(screen.getByRole('header', { name: 'Quên mật khẩu' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));
    expect(screen.getByText('Địa chỉ email chưa hợp lệ.')).toBeOnTheScreen();
    expect(accountApi.forgotPassword).not.toHaveBeenCalled();
    expectAccessible();
  });

  test('shows the same neutral banner and masks the address', async () => {
    mocked(accountApi.forgotPassword).mockResolvedValue({ message: 'ok' });
    await renderApp(<ForgotPasswordScreen {...props} />, 'en');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'student@example.edu');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(screen.getByText('Check your inbox')).toBeOnTheScreen());
    expect(accountApi.forgotPassword).toHaveBeenCalledWith('student@example.edu');
    expect(screen.getByText(/s\*\*\*@example\.edu/)).toBeOnTheScreen();
    expect(screen.queryByText(/student@example\.edu/)).toBeNull();
    expectAccessible();
  });

  test('maps 429 and offline failures to localized messages', async () => {
    mocked(accountApi.forgotPassword).mockRejectedValueOnce({ status: 429, code: 'RATE_LIMIT_EXCEEDED' });
    await renderApp(<ForgotPasswordScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'student@example.edu');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
    expect(screen.getByText('Bạn thao tác quá nhanh. Hãy chờ một lát rồi thử lại.')).toBeOnTheScreen();

    mocked(accountApi.forgotPassword).mockRejectedValueOnce(new TypeError('Network request failed'));
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));
    await waitFor(() =>
      expect(screen.getByText('Không có kết nối. Kiểm tra mạng rồi thử lại.')).toBeOnTheScreen());
  });
});

describe('reset password', () => {
  test('a missing token shows the safe terminal state', async () => {
    await renderApp(<ResetPasswordScreen {...props} initialToken={null} />);
    expect(screen.getByRole('header', { name: 'Liên kết không còn hợp lệ' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Mật khẩu mới')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Yêu cầu liên kết mới' }));
    expect(navigation.navigate).toHaveBeenCalledWith('auth.forgotPassword');
    expectAccessible();
  });

  test('validates locally, toggles visibility and never renders the token', async () => {
    await renderApp(<ResetPasswordScreen {...props} initialToken={FAKE_TOKEN} />);
    const field = screen.getByLabelText('Mật khẩu mới');
    expect(field.props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Hiện mật khẩu' })[0]);
    expect(screen.getByLabelText('Mật khẩu mới').props.secureTextEntry).toBe(false);

    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu'), 'Different-1234');
    await fireEvent.press(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    expect(screen.getByText('Mật khẩu mới và phần xác nhận phải trùng nhau.')).toBeOnTheScreen();
    expect(accountApi.resetPassword).not.toHaveBeenCalled();
    expect(JSON.stringify(screen.toJSON())).not.toContain(FAKE_TOKEN);
    expectAccessible();
  });

  test('success ends in a done state and clears the entered passwords', async () => {
    mocked(accountApi.resetPassword).mockResolvedValue({ message: 'ok' });
    await renderApp(<ResetPasswordScreen {...props} initialToken={FAKE_TOKEN} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    await waitFor(() => expect(screen.getByRole('header', { name: 'Đã đặt lại mật khẩu' })).toBeOnTheScreen());
    expect(accountApi.resetPassword).toHaveBeenCalledWith(FAKE_TOKEN, FAKE_PASSWORD);
    expect(JSON.stringify(screen.toJSON())).not.toContain(FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Đến màn hình đăng nhập' }));
    expect(navigation.navigate).toHaveBeenCalledWith('auth.signIn');
  });

  test('a rejected token falls back to the invalid state', async () => {
    mocked(accountApi.resetPassword).mockRejectedValue({ status: 400, code: 'RESET_TOKEN_INVALID' });
    await renderApp(<ResetPasswordScreen {...props} initialToken={FAKE_TOKEN} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    await waitFor(() => expect(screen.getByRole('header', { name: 'Liên kết không còn hợp lệ' })).toBeOnTheScreen());
  });
});

describe('logged out', () => {
  test('shows why the session ended once, then the plain message', async () => {
    setExitNotice('passwordChanged');
    await renderApp(<LoggedOutScreen {...props} />);
    expect(screen.getByText('Mật khẩu đã được đổi. Hãy đăng nhập lại.')).toBeOnTheScreen();
    expectAccessible();
    await fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(navigation.navigate).toHaveBeenCalledWith('auth.signIn');
  });
});

describe('two-factor card', () => {
  test('enable flow confirms the code, clears secrets and hands off the sign-out', async () => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: false });
    mocked(accountApi.beginTwoFactorEnable).mockResolvedValue({ challengeId: 'fake-challenge' });
    mocked(accountApi.confirmTwoFactorEnable).mockResolvedValue({ enabled: true });
    const onCompleted = jest.fn();
    await renderApp(<TwoFactorCard email="student@example.edu" onCompleted={onCompleted} />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Bật xác thực hai yếu tố' }));
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu của bạn'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi mã' }));
    await screen.findByText('Mã 6 chữ số đã được gửi tới s***@example.edu.');
    expect(accountApi.beginTwoFactorEnable).toHaveBeenCalledWith(FAKE_PASSWORD);
    expect(JSON.stringify(screen.toJSON())).not.toContain(FAKE_PASSWORD);

    await fireEvent.changeText(screen.getByLabelText('Mã xác thực'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(screen.getByText('Mã gồm đúng 6 chữ số.')).toBeOnTheScreen();
    expect(accountApi.confirmTwoFactorEnable).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Mã xác thực'), '123 456');
    await fireEvent.press(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith('enable'));
    expect(accountApi.confirmTwoFactorEnable).toHaveBeenCalledWith('fake-challenge', '123456');
  });

  test('a wrong password and a locked code show distinct, localized errors', async () => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: false });
    mocked(accountApi.beginTwoFactorEnable)
      .mockRejectedValueOnce({ status: 400 })
      .mockResolvedValueOnce({ challengeId: 'fake-challenge' });
    mocked(accountApi.confirmTwoFactorEnable).mockRejectedValue({ status: 400, code: 'TWO_FACTOR_CODE_LOCKED' });
    await renderApp(<TwoFactorCard email="student@example.edu" onCompleted={jest.fn()} />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Bật xác thực hai yếu tố' }));
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu của bạn'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi mã' }));
    await screen.findByText('Mật khẩu không đúng.');

    await fireEvent.changeText(screen.getByLabelText('Mật khẩu của bạn'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi mã' }));
    await fireEvent.changeText(await screen.findByLabelText('Mã xác thực'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Xác nhận' }));
    await screen.findByText('Bạn đã thử quá nhiều lần. Hãy bắt đầu lại để nhận mã mới.');
    expect(screen.getByRole('button', { name: 'Bật xác thực hai yếu tố' })).toBeOnTheScreen();
  });

  test('turning 2FA off asks for confirmation before any request', async () => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: true });
    await renderApp(<TwoFactorCard email="student@example.edu" onCompleted={jest.fn()} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Tắt xác thực hai yếu tố' }));
    expect(screen.getByText('Tắt xác thực hai yếu tố?')).toBeOnTheScreen();
    expect(accountApi.beginTwoFactorDisable).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByText('Tắt xác thực hai yếu tố?')).toBeNull();
  });

  test('an unavailable status offers a retry instead of the actions', async () => {
    mocked(accountApi.twoFactorStatus).mockRejectedValueOnce({ status: 500 });
    mocked(accountApi.twoFactorStatus).mockResolvedValueOnce({ enabled: false });
    await renderApp(<TwoFactorCard email="student@example.edu" onCompleted={jest.fn()} />);
    expect(await screen.findByText('Chưa thể tải trạng thái.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Bật xác thực hai yếu tố' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: 'Bật xác thực hai yếu tố' })).toBeOnTheScreen();
  });
});

describe('profile account security', () => {
  beforeEach(() => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: false });
  });

  test('sign-out needs confirmation and then ends the session', async () => {
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(navigation.signOut).not.toHaveBeenCalled();
    expect(screen.getByText('Đăng xuất khỏi thiết bị này?')).toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Đăng xuất' }).at(-1)!);
    expect(navigation.signOut).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });

  test('change password validates, confirms, then signs out on success', async () => {
    mocked(campusApi.changePassword).mockResolvedValue({ message: 'ok' });
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu hiện tại'), 'Old-pass-1234');
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), 'short1');
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), 'short1');
    await fireEvent.press(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(screen.getByText('Mật khẩu cần có ít nhất 8 ký tự.')).toBeOnTheScreen();
    expect(campusApi.changePassword).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(screen.getByText('Đổi mật khẩu?')).toBeOnTheScreen();
    expect(campusApi.changePassword).not.toHaveBeenCalled();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Đổi mật khẩu' }).at(-1)!);
    await waitFor(() => expect(navigation.signOut).toHaveBeenCalledTimes(1));
    expect(campusApi.changePassword).toHaveBeenCalledWith('Old-pass-1234', FAKE_PASSWORD);
  });

  test('a wrong current password stays on the form with a localized error', async () => {
    mocked(campusApi.changePassword).mockRejectedValue({ status: 400, code: 'INVALID_OLD_PASSWORD' });
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu hiện tại'), 'Wrong-pass-1');
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    await fireEvent.press(screen.getAllByRole('button', { name: 'Đổi mật khẩu' }).at(-1)!);
    await screen.findByText('Mật khẩu hiện tại không đúng.');
    expect(navigation.signOut).not.toHaveBeenCalled();
  });

  test('the profile form meets the accessibility contract', async () => {
    await renderApp(<ProfileScreen {...props} />);
    expectAccessible();
  });
});
