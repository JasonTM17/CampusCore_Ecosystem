import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

const mockProfile = { firstName: 'Đức Minh', lastName: 'Nguyễn', email: 'minh.nguyen@ute.edu.vn' };

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live' },
}));
jest.mock('../../src/session/SessionContext', () => ({ useOptionalSession: () => null }));
jest.mock('../../src/hooks/useScreenQuery', () => ({ useScreenQuery: () => ({ data: undefined }) }));

import { AppBar } from '../../src/components/AppBar';
import { BottomNavigation } from '../../src/components/BottomNavigation';
import { MenuPanel } from '../../src/components/MenuPanel';
import { NavigationRail } from '../../src/components/NavigationRail';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';

afterEach(() => {
  jest.clearAllMocks();
});

function wrap(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

function menu(onNavigate = jest.fn(), onSignOut = jest.fn()) {
  return wrap(
    <MenuPanel
      activeRoute="dashboard.student"
      role="student"
      onClose={() => {}}
      onNavigate={onNavigate}
      onSwitchRole={() => {}}
      allowRoleSwitch={false}
      identity={{ name: 'Nguyễn Đức Minh', email: mockProfile.email }}
      onSignOut={onSignOut}
    />,
  );
}

describe('web-aligned menu', () => {
  test('groups and orders every destination like the web sidebar and keeps the extra routes reachable', async () => {
    await render(menu());

    expect(screen.getAllByRole('header').map((header) => header.props.children)).toEqual([
      'Tất cả chức năng',
      'Tổng quan',
      'Hồ sơ học vụ',
      'Dịch vụ nhà trường',
      'Khác',
      'Trợ lý',
    ]);

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Đóng',
      'Tổng quan',
      'Đăng ký học phần',
      'Môn học của tôi',
      'Học liệu & bài tập',
      'Chương trình đào tạo',
      'Thời khóa biểu',
      'Điểm số',
      'Bảng điểm',
      'Điểm rèn luyện',
      'Điểm danh',
      'Đồ án – Khóa luận',
      'Giấy xác nhận điện tử',
      'Sự kiện & hoạt động Đoàn–Hội',
      'Thông báo Phòng Đào tạo',
      'Trung tâm thông báo',
      'Học phần',
      'Tiến độ luận văn',
      'Tuyển sinh',
      'Thư viện',
      'Việc làm',
      'Tin tức',
      'Tài liệu công khai',
      'Trợ lý CampusUTE',
      'Cài đặt hồ sơ',
      'Đăng xuất',
    ]);
  });

  test('shows the signed-in identity and routes the settings row', async () => {
    const onNavigate = jest.fn();
    await render(menu(onNavigate));

    expect(screen.getByText('Nguyễn Đức Minh')).toBeOnTheScreen();
    expect(screen.getByText('minh.nguyen@ute.edu.vn')).toBeOnTheScreen();
    expect(screen.getByText(shellMessages.vi.roles.student)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Cài đặt hồ sơ' }));
    expect(onNavigate).toHaveBeenCalledWith('profile');
  });

  test('confirms sign-out and calls the shared session-ending flow', async () => {
    const onSignOut = jest.fn();
    await render(menu(jest.fn(), onSignOut));

    await fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất' }));
    const confirmations = screen.getAllByRole('button', { name: 'Đăng xuất' });
    expect(confirmations).toHaveLength(2);
    await fireEvent.press(confirmations[1]);

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('web-aligned student tab bar', () => {
  test('shows Home, Schedule, Register, Grades and Menu with the web labels', async () => {
    await render(wrap(
      <BottomNavigation
        activeRoute="dashboard.student"
        role="student"
        onNavigate={() => {}}
        onMenu={() => {}}
        unreadCount={3}
      />,
    ));

    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Trang chủ',
      'TKB',
      'Đăng ký',
      'Điểm',
    ]);
    expect(screen.queryByRole('tab', { name: /Thông báo/ })).toBeNull();
    expect(screen.getByText('Menu')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mở danh mục, 3 Chưa đọc' })).toBeOnTheScreen();
    expect(screen.getByText('3', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  test('caps three-digit unread counts at 99+ on the bar and the rail', async () => {
    const bar = await render(wrap(
      <BottomNavigation
        activeRoute="dashboard.student"
        role="student"
        onNavigate={() => {}}
        onMenu={() => {}}
        unreadCount={120}
      />,
    ));
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mở danh mục, 120 Chưa đọc' })).toBeOnTheScreen();
    await bar.unmount();

    await render(wrap(
      <NavigationRail
        activeRoute="dashboard.student"
        role="student"
        onNavigate={() => {}}
        onMenu={() => {}}
        unreadCount={120}
      />,
    ));
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe('web-aligned header', () => {
  test('shows a notification bell with the unread count and opens the preview', async () => {
    const onNotifications = jest.fn();
    await render(wrap(
      <AppBar role="student" unreadCount={4} onNotifications={onNotifications} onProfile={() => {}} />,
    ));

    expect(screen.getByRole('button', { name: 'Thông báo, 4 Chưa đọc' })).toBeOnTheScreen();
    expect(screen.getByText('4', { includeHiddenElements: true })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Thông báo, 4 Chưa đọc' }));
    expect(onNotifications).toHaveBeenCalledTimes(1);
  });

  test('caps the bell badge at 99+', async () => {
    await render(wrap(
      <AppBar role="student" unreadCount={120} onNotifications={() => {}} onProfile={() => {}} />,
    ));
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  test('keeps the signed-in header to brand, role and account without language or theme buttons', async () => {
    await render(wrap(<AppBar role="student" onNotifications={() => {}} onProfile={() => {}} />));

    expect(screen.getByText(shellMessages.vi.roles.student)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: shellMessages.vi.screens.profile })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: shellMessages.vi.notifications.title })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: shellMessages.vi.language })).toBeNull();
    expect(screen.queryByRole('button', { name: /giao diện/i })).toBeNull();
  });

  test('switches the interface language from the signed-out header with the shared setter', async () => {
    await render(wrap(<AppBar onSignIn={() => {}} />));

    await fireEvent.press(screen.getByRole('button', { name: shellMessages.vi.language }));
    expect(screen.getByRole('button', { name: shellMessages.en.language })).toBeOnTheScreen();
  });
});
