import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, TextInput, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';

import { Button } from '../../src/components/Ui';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'live' }, campusApi: {} }));
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => ({ kind: 'signedOut' }) }));
jest.mock('../../src/auth/oidc-session', () => ({ signInWithOidc: jest.fn() }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: {} }));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: () => ({ items: [], loading: false, error: null, warning: null }),
}));

import { AccountFrame } from '../../src/screens/account/AccountFrame';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;
const insets = { top: 24, bottom: 16, left: 32, right: 20 };

function setWindow(width: number, height: number, fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height, scale: 2, fontScale });
}

function show(element: ReactElement) {
  return render(
    <SafeAreaInsetsContext.Provider value={insets}>
      <LocaleProvider initialLocale="vi"><ThemeProvider forcedScheme="light">{element}</ThemeProvider></LocaleProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

function scrollAncestor(node: ReturnType<typeof screen.getByText>) {
  let parent = node.parent;
  while (parent && !parent.props.keyboardShouldPersistTaps) parent = parent.parent;
  return parent;
}

afterEach(() => { jest.restoreAllMocks(); });

describe('signed-out responsive frames', () => {
  test('the shared account frame lets guests switch language from its header', async () => {
    await show(<AccountFrame title="Khôi phục"><TextInput /></AccountFrame>);

    await fireEvent.press(screen.getByRole('button', { name: 'Ngôn ngữ' }));

    expect(screen.getByText('Campus academic portal')).toBeOnTheScreen();
  });

  test.each<[string, number]>([['account', 1], ['account', 1.3], ['account', 2], ['sign-in', 1], ['sign-in', 1.3], ['sign-in', 2]])('keeps the %s frame inside landscape side insets at font scale %s', async (frame, fontScale) => {
    setWindow(839, 393, fontScale);
    const element = frame === 'account' ? <AccountFrame title="Khôi phục"><TextInput /></AccountFrame> : <SignInScreen {...props} />;
    const result = await show(element);
    const rootStyle = StyleSheet.flatten(screen.toJSON()?.props.style) as ViewStyle;
    expect(rootStyle.paddingLeft).toBe(insets.left);
    expect(rootStyle.paddingRight).toBe(insets.right);
    result.unmount();
  });

  test.each([[360, 640, 2], [640, 360, 1.3], [839, 393, 2]])(
    'allows the entire recovery frame to scroll above the keyboard at %s x %s and font %s',
    async (width, height, fontScale) => {
      setWindow(width, height, fontScale);
      await show(<AccountFrame title="Đặt lại mật khẩu"><TextInput accessibilityLabel="Mật khẩu" /><Button label="Lưu" onPress={() => {}} /></AccountFrame>);
      const scroll = scrollAncestor(screen.getByLabelText('Mật khẩu'));
      const brandScroll = scrollAncestor(screen.getByLabelText('HCMUTE'));
      expect(brandScroll !== null).toBe(true);
      expect(brandScroll).toBe(scroll);
      expect(scroll).toBeTruthy();
      expect(scroll!.props.keyboardShouldPersistTaps).toBe('handled');
      expect(StyleSheet.flatten(scroll!.props.contentContainerStyle).paddingBottom).toBeGreaterThanOrEqual(insets.bottom + tokens.spacing.xl);
    },
  );

  test.each([[360, 640, 2], [393, 360, 1.3], [600, 839, 1], [839, 600, 2], [1000, 600, 1]])(
    'lets the sign-in body grow beyond the scroll viewport at %s x %s and font %s',
    async (width, height, fontScale) => {
      setWindow(width, height, fontScale);
      await show(<SignInScreen {...props} />);
      const body = screen.getByTestId('signin-body');
      const style = StyleSheet.flatten(body?.props.style);
      expect(style.flex).toBeUndefined();
      expect(style.flexGrow).toBe(1);
      expect(style.width).toBe('100%');
      expect(style.maxWidth).toBe(tokens.windowClasses.contentMaxWidth.medium);
      expect(scrollAncestor(screen.getByRole('button', { name: 'Đăng nhập bằng tài khoản nhà trường để tiếp tục.' }))).toBeTruthy();
    },
  );
});
