import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { auditTree } from '../a11y/audit';

const mockProfileQuery = {
  value: {
    data: { id: 'u1', email: 'minh.nguyen@ute.edu.vn', firstName: 'Minh', lastName: 'Nguyen', studentId: '2022SE0417', phone: '', address: '', dateOfBirth: '2002-05-17' },
    error: null as string | null,
    warning: null as string | null,
    isLoading: false,
    reload: jest.fn(),
    setData: jest.fn(),
  },
  calls: [] as unknown[][],
};

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
  useScreenQuery: (...args: unknown[]) => {
    mockProfileQuery.calls.push(args);
    return mockProfileQuery.value;
  },
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
jest.mock('../../src/session/SessionContext', () => ({ useOptionalSession: () => null }));

import { apiClient, campusApi } from '../../src/api/client';
import { accountApi } from '../../src/screens/account/account-api';
import { ForgotPasswordScreen } from '../../src/screens/account/ForgotPasswordScreen';
import { LoggedOutScreen } from '../../src/screens/account/LoggedOutScreen';
import { ResetPasswordScreen } from '../../src/screens/account/ResetPasswordScreen';
import { TwoFactorCard } from '../../src/screens/account/TwoFactorCard';
import { setExitNotice } from '../../src/screens/account/exit-notice';
import { ProfileScreen } from '../../src/screens/student/ProfileScreen';
import { accountMessages } from '../../src/i18n/account-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

// Obviously fake, test-only values.
const FAKE_TOKEN = 'fake-reset-token_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FAKE_PASSWORD = 'Fake-pass-1234';
const mocked = <T,>(fn: unknown) => fn as jest.Mock<(...args: unknown[]) => Promise<T>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function pressTwiceBeforeCommit(button: unknown): Promise<void> {
  const originalError = console.error;
  const warning = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('overlapping act() calls')) return;
    originalError(message, ...args);
  });
  try {
    await act(async () => {
      fireEvent.press(button as never);
      fireEvent.press(button as never);
    });
  } finally {
    warning.mockRestore();
  }
}

const navigation = {
  navigate: jest.fn(),
  signOut: jest.fn(),
} as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as MobileScreenProps;

const appTree = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale={locale}>{element}</LocaleProvider>
  </ThemeProvider>
);
const renderApp = (element: ReactElement, locale: 'vi' | 'en' = 'vi') => render(appTree(element, locale));

const expectAccessible = () => {
  const result = auditTree(screen.toJSON() as Parameters<typeof auditTree>[0]);
  expect(result.violations).toEqual([]);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProfileQuery.value = {
    data: { id: 'u1', email: 'minh.nguyen@ute.edu.vn', firstName: 'Minh', lastName: 'Nguyen', studentId: '2022SE0417', phone: '', address: '', dateOfBirth: '2002-05-17' },
    error: null,
    warning: null,
    isLoading: false,
    reload: jest.fn(),
    setData: jest.fn(),
  };
  mockProfileQuery.calls = [];
});

describe('forgot password', () => {
  test('the email field is single-line like the web input', async () => {
    await renderApp(<ForgotPasswordScreen {...props} />);
    expect(screen.getByLabelText('Email').props.multiline).toBe(false);
  });

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

  test('a same-frame repeat tap sends only one recovery request', async () => {
    const request = deferred<{ message: string }>();
    mocked(accountApi.forgotPassword).mockReturnValue(request.promise);
    await renderApp(<ForgotPasswordScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'student@example.edu');
    await pressTwiceBeforeCommit(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    expect(accountApi.forgotPassword).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.resolve({ message: 'ok' });
      await request.promise;
    });
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

  test('a same-frame repeat tap cannot let a duplicate stale-token error win', async () => {
    const accepted = deferred<{ message: string }>();
    let calls = 0;
    mocked(accountApi.resetPassword).mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? accepted.promise
        : Promise.reject({ status: 400, code: 'RESET_TOKEN_INVALID' });
    });
    await renderApp(<ResetPasswordScreen {...props} initialToken={FAKE_TOKEN} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu'), FAKE_PASSWORD);
    await pressTwiceBeforeCommit(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByRole('header', { name: 'Liên kết không còn hợp lệ' })).toBeNull();
    expect(accountApi.resetPassword).toHaveBeenCalledTimes(1);
    await act(async () => {
      accepted.resolve({ message: 'ok' });
      await accepted.promise;
    });
    await waitFor(() => expect(screen.getByRole('header', { name: 'Đã đặt lại mật khẩu' })).toBeOnTheScreen());
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
  test('guards the awaited status response after unmount', () => {
    const source = readFileSync(resolve(__dirname, '../../src/screens/account/TwoFactorCard.tsx'), 'utf8');
    expect(source).toMatch(/const mounted = useRef\(false\);/);
    expect(source).toMatch(/if \(!mounted\.current \|\| request !== statusRequest\.current\) return;/);
    expect(source).toMatch(/return \(\) => \{\s*mounted\.current = false;\s*statusRequest\.current \+= 1;\s*\};/);
  });

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

  test('a confirmation that resolves after unmount still completes the sign-out handoff', async () => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: false });
    mocked(accountApi.beginTwoFactorEnable).mockResolvedValue({ challengeId: 'fake-challenge' });
    const pending = deferred<{ enabled: boolean }>();
    mocked(accountApi.confirmTwoFactorEnable).mockImplementationOnce(() => pending.promise);
    const onCompleted = jest.fn();
    const view = await renderApp(<TwoFactorCard email="student@example.edu" onCompleted={onCompleted} />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Bật xác thực hai yếu tố' }));
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu của bạn'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi mã' }));
    await fireEvent.changeText(await screen.findByLabelText('Mã xác thực'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(accountApi.confirmTwoFactorEnable).toHaveBeenCalled());
    await view.unmount();

    await act(async () => {
      pending.resolve({ enabled: true });
      await pending.promise;
    });
    expect(onCompleted).toHaveBeenCalledWith('enable');
  });

  test('a confirmed change does not leave a dead enable/disable button behind', async () => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: false });
    mocked(accountApi.beginTwoFactorEnable).mockResolvedValue({ challengeId: 'fake-challenge' });
    mocked(accountApi.confirmTwoFactorEnable).mockResolvedValue({ enabled: true });
    const onCompleted = jest.fn();
    await renderApp(<TwoFactorCard email="student@example.edu" onCompleted={onCompleted} />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Bật xác thực hai yếu tố' }));
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu của bạn'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi mã' }));
    await fireEvent.changeText(await screen.findByLabelText('Mã xác thực'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith('enable'));

    expect(screen.queryByRole('button', { name: 'Tắt xác thực hai yếu tố' })).toBeNull();
  });

  test('a same-frame repeat tap requests only one two-factor challenge', async () => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: false });
    const request = deferred<{ challengeId: string }>();
    mocked(accountApi.beginTwoFactorEnable).mockReturnValue(request.promise);
    await renderApp(<TwoFactorCard email="student@example.edu" onCompleted={jest.fn()} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Bật xác thực hai yếu tố' }));
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu của bạn'), FAKE_PASSWORD);
    await pressTwiceBeforeCommit(screen.getByRole('button', { name: 'Gửi mã' }));

    expect(accountApi.beginTwoFactorEnable).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.resolve({ challengeId: 'fake-challenge' });
      await request.promise;
    });
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
  test('profile phone and address stay disabled during a save and keep server limits', async () => {
    const pending = deferred<unknown>();
    mocked(campusApi.updateProfile).mockImplementationOnce(() => pending.promise);
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText(accountMessages.vi.profile.phone), '0901234567');
    await fireEvent.changeText(screen.getByLabelText(accountMessages.vi.profile.address), 'Khu phố 1');
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.profile.save }));
    await waitFor(() => expect(campusApi.updateProfile).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText(accountMessages.vi.profile.phone).props).toMatchObject({ editable: false, maxLength: 80 });
    expect(screen.getByLabelText(accountMessages.vi.profile.address).props).toMatchObject({ editable: false, maxLength: 500 });
    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
  });

  test('profile validation and request failures are accessible errors and clear on edit', async () => {
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText(accountMessages.vi.profile.phone), 'not a phone');
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.profile.save }));

    const invalidPhoneAlert = screen.getByRole('alert');
    expect(invalidPhoneAlert).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByText(accountMessages.vi.profile.phoneInvalid).props.style)?.color).toBe(tokens.colors.error);

    mocked(campusApi.updateProfile).mockRejectedValueOnce(new TypeError('Network request failed'));
    await fireEvent.changeText(screen.getByLabelText(accountMessages.vi.profile.phone), '0901234567');
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.profile.save }));

    const networkAlert = await screen.findByRole('alert');
    expect(networkAlert).toBeOnTheScreen();
    expect(screen.getByText(accountMessages.vi.errors.network)).toBeOnTheScreen();
    expect(screen.queryByText('Network request failed')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText(accountMessages.vi.profile.address), 'Địa chỉ mới');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('an overlong address gets localized feedback and save success is polite', async () => {
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText(accountMessages.vi.profile.address), 'A'.repeat(501));
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.profile.save }));
    expect(screen.getByText(accountMessages.vi.profile.addressTooLong)).toBeOnTheScreen();
    expect(campusApi.updateProfile).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(accountMessages.vi.profile.address), 'A'.repeat(500));
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.profile.save }));
    const saved = await screen.findByText(accountMessages.vi.profile.saved);
    expect(saved.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('profile data, language setting and sign-out stay visible across an offline locale change', async () => {
    mockProfileQuery.value = {
      ...mockProfileQuery.value,
      warning: 'Offline; showing the saved profile.',
    };
    const view = await renderApp(<ProfileScreen {...props} />);
    await fireEvent.press(screen.getByText('English'));
    expect(screen.getByText('Offline; showing the saved profile.')).toBeOnTheScreen();
    expect(screen.getByText('Language')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: accountMessages.en.signOut.button })).toBeOnTheScreen();
    const options = mockProfileQuery.calls.at(-1)?.[2] as { scope?: { locale?: string } } | undefined;
    expect(options?.scope?.locale).toBe('neutral');
    await view.unmount();
  });

  beforeEach(() => {
    mocked(accountApi.twoFactorStatus).mockResolvedValue({ enabled: false });
  });

  test('keeps sign-out and language controls available while the profile is loading', async () => {
    mockProfileQuery.value = { ...mockProfileQuery.value, isLoading: true };
    await renderApp(<ProfileScreen {...props} />);

    const signOut = screen.getByRole('button', { name: 'Đăng xuất' });
    expect(screen.getByText('Ngôn ngữ')).toBeOnTheScreen();
    await fireEvent.press(signOut);
    expect(screen.getByText('Đăng xuất khỏi thiết bị này?')).toBeOnTheScreen();
  });

  test('keeps sign-out and language controls available when the profile fails', async () => {
    mockProfileQuery.value = { ...mockProfileQuery.value, error: 'Không tải được hồ sơ' };
    await renderApp(<ProfileScreen {...props} />);

    const signOut = screen.getByRole('button', { name: 'Đăng xuất' });
    expect(screen.getByText('Ngôn ngữ')).toBeOnTheScreen();
    await fireEvent.press(signOut);
    expect(screen.getByText('Đăng xuất khỏi thiết bị này?')).toBeOnTheScreen();
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

  test('same-frame repeated sign-out confirmation ends the session once', async () => {
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));

    const confirm = screen.getAllByRole('button', { name: 'Đăng xuất' }).at(-1)!;
    await pressTwiceBeforeCommit(confirm);

    expect(navigation.signOut).toHaveBeenCalledTimes(1);
  });

  test('change password validates, confirms, then signs out on success', async () => {
    mocked(campusApi.changePassword).mockResolvedValue({ message: 'ok' });
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu hiện tại'), 'Old-pass-1234');
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), 'short1');
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), 'short1');
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.password.submit }));
    expect(screen.getByText('Mật khẩu cần có ít nhất 8 ký tự.')).toBeOnTheScreen();
    expect(campusApi.changePassword).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.password.submit }));
    expect(screen.getByText(accountMessages.vi.password.confirmTitle)).toBeOnTheScreen();
    expect(campusApi.changePassword).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.password.confirmAction }));
    await waitFor(() => expect(navigation.signOut).toHaveBeenCalledTimes(1));
    expect(campusApi.changePassword).toHaveBeenCalledWith('Old-pass-1234', FAKE_PASSWORD);
  });

  test('same-frame double confirmation sends one password change', async () => {
    const pending = deferred<unknown>();
    mocked(campusApi.changePassword).mockImplementation(() => pending.promise);
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu hiện tại'), 'Old-pass-1234');
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.password.submit }));

    const confirm = screen.getByRole('button', { name: accountMessages.vi.password.confirmAction });
    try {
      await pressTwiceBeforeCommit(confirm);
      expect(campusApi.changePassword).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        pending.resolve({ message: 'ok' });
        await pending.promise;
      });
      mocked(campusApi.changePassword).mockReset();
    }
  });

  test('a wrong current password stays on the form with a localized error', async () => {
    mocked(campusApi.changePassword).mockRejectedValue({ status: 400, code: 'INVALID_OLD_PASSWORD' });
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu hiện tại'), 'Wrong-pass-1');
    await fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), FAKE_PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.password.submit }));
    await fireEvent.press(screen.getByRole('button', { name: accountMessages.vi.password.confirmAction }));
    await screen.findByText('Mật khẩu hiện tại không đúng.');
    expect(navigation.signOut).not.toHaveBeenCalled();
  });

  test('the profile form meets the accessibility contract', async () => {
    await renderApp(<ProfileScreen {...props} />);
    expectAccessible();
  });

  test('same-frame repeated profile save sends one update', async () => {
    const request = deferred<unknown>();
    mocked(campusApi.updateProfile).mockImplementation(() => request.promise);
    await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Số điện thoại'), '0901234567');

    try {
      await pressTwiceBeforeCommit(screen.getByRole('button', { name: accountMessages.vi.profile.save }));
      expect(campusApi.updateProfile).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        request.resolve({});
        await request.promise;
      });
    }
  });

  test('the profile detail card does not repeat the identity header name and ID', async () => {
    await renderApp(<ProfileScreen {...props} />);
    expect(screen.getAllByText('Nguyen Minh')).toHaveLength(1);
    expect(screen.getAllByText('2022SE0417')).toHaveLength(1);
  });

  test('the profile displays Vietnamese names in family-name-first order', async () => {
    mockProfileQuery.value = {
      ...mockProfileQuery.value,
      data: { ...mockProfileQuery.value.data, firstName: 'Đức Minh', lastName: 'Nguyễn' },
    };
    await renderApp(<ProfileScreen {...props} />);
    expect(screen.getByText('Nguyễn Đức Minh')).toBeOnTheScreen();
  });

  test('the profile shows the date of birth in a disabled field', async () => {
    await renderApp(<ProfileScreen {...props} />);
    const birthday = screen.getByLabelText(accountMessages.vi.profile.dateOfBirth);
    expect(birthday.props.value).toBe('17/05/2002');
    expect(birthday.props.editable).toBe(false);
  });

  test('first and last name render as labelled read-only fields', async () => {
    await renderApp(<ProfileScreen {...props} />);
    const lastName = screen.getByLabelText(accountMessages.vi.profile.lastName);
    const firstName = screen.getByLabelText(accountMessages.vi.profile.firstName);
    expect(lastName.props.value).toBe('Nguyen');
    expect(firstName.props.value).toBe('Minh');
    expect(lastName.props.editable).toBe(false);
    expect(firstName.props.editable).toBe(false);
  });

  test('the profile heading, eyebrow and description use the web copy', async () => {
    await renderApp(<ProfileScreen {...props} />);
    expect(screen.getByRole('header', { name: accountMessages.vi.profile.title })).toBeOnTheScreen();
    expect(screen.getByText(accountMessages.vi.profile.eyebrow.toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText(accountMessages.vi.profile.description)).toBeOnTheScreen();
  });

  test('the password card carries the web title, description and policy hint', async () => {
    await renderApp(<ProfileScreen {...props} />);
    expect(screen.getByRole('header', { name: accountMessages.vi.password.title })).toBeOnTheScreen();
    expect(screen.getByText(accountMessages.vi.password.description)).toBeOnTheScreen();
    expect(screen.getByText(accountMessages.vi.password.hint)).toBeOnTheScreen();
  });

  test('the what-changes card explains school-managed fields', async () => {
    await renderApp(<ProfileScreen {...props} />);
    expect(screen.getByRole('header', { name: accountMessages.vi.profile.whatChangesTitle })).toBeOnTheScreen();
    for (const paragraph of accountMessages.vi.profile.whatChanges) {
      expect(screen.getByText(paragraph)).toBeOnTheScreen();
    }
  });

  test('profile revalidation keeps an in-progress phone edit', async () => {
    const view = await renderApp(<ProfileScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Số điện thoại'), '0901234567');
    await fireEvent.changeText(screen.getByLabelText('Địa chỉ'), 'Địa chỉ đang chỉnh sửa');

    mockProfileQuery.value = {
      ...mockProfileQuery.value,
      data: { ...mockProfileQuery.value.data, phone: '0907654321', address: 'Server refresh' },
    };
    await act(async () => {
      view.rerender(appTree(<ProfileScreen {...props} />));
    });

    expect(screen.getByLabelText('Số điện thoại').props.value).toBe('0901234567');
    expect(screen.getByLabelText('Địa chỉ').props.value).toBe('Địa chỉ đang chỉnh sửa');
  });

  test('profile revalidation adopts newer server phone and address when unedited', async () => {
    mockProfileQuery.value = {
      ...mockProfileQuery.value,
      data: { ...mockProfileQuery.value.data, phone: '0901111111', address: 'Initial Address' },
    };
    const view = await renderApp(<ProfileScreen {...props} />);
    expect(screen.getByLabelText('Số điện thoại').props.value).toBe('0901111111');
    expect(screen.getByLabelText('Địa chỉ').props.value).toBe('Initial Address');

    mockProfileQuery.value = {
      ...mockProfileQuery.value,
      data: { ...mockProfileQuery.value.data, phone: '0902222222', address: 'Updated Address' },
    };
    await act(async () => {
      view.rerender(appTree(<ProfileScreen {...props} />));
    });

    expect(screen.getByLabelText('Số điện thoại').props.value).toBe('0902222222');
    expect(screen.getByLabelText('Địa chỉ').props.value).toBe('Updated Address');
  });

  test('Vietnamese preview identity keeps its name diacritics', async () => {
    const originalMode = apiClient.mode;
    Object.defineProperty(apiClient, 'mode', { configurable: true, value: 'preview' });
    try {
      await renderApp(<ProfileScreen {...props} />);
      expect(screen.getByText('Nguyễn Đức Minh')).toBeOnTheScreen();
    } finally {
      Object.defineProperty(apiClient, 'mode', { configurable: true, value: originalMode });
    }
  });
});
