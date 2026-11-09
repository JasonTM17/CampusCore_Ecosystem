import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

const mockPush = jest.fn();
const mockRedirect = jest.fn();
const mockSession = {
  kind: 'signedOut' as 'signedOut' | 'authenticated' | 'preview',
  role: 'student' as 'student' | 'lecturer' | 'admin',
  capabilities: [] as string[],
  signingOut: false,
  accountId: null as string | null,
};

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    dismissAll: jest.fn(),
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
  }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => mockSession,
}));
// The public teasers read the anonymous feed; the route contract is unrelated.
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: { news: jest.fn(), docs: jest.fn() },
}));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: () => ({
    items: [],
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
    warning: null,
    loadMoreError: null,
    errorStatus: null,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    reload: jest.fn(async () => {}),
    patch: jest.fn(),
    preview: false,
  }),
}));

import Index from '../../app/index';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';

const tree = (locale: 'vi' | 'en' = 'vi'): ReactElement => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale={locale}>
      <Index />
    </LocaleProvider>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.kind = 'signedOut';
  mockSession.role = 'student';
  mockSession.capabilities = [];
  mockSession.signingOut = false;
  mockSession.accountId = null;
});

test('a guest at / sees the landing instead of a redirect', async () => {
  await render(tree());

  expect(mockRedirect).not.toHaveBeenCalled();
  expect(screen.getByRole('header', { name: 'Cổng Thông Tin Đào Tạo & Học Vụ Trực Tuyến' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Trung tâm trường học' })).toBeOnTheScreen();
});

test('an authenticated session at / still lands on its role home', async () => {
  mockSession.kind = 'authenticated';
  mockSession.role = 'lecturer';

  await render(tree());

  expect(mockRedirect).toHaveBeenLastCalledWith('/lecturer/dashboard');
  expect(screen.queryByText('Cổng Thông Tin Đào Tạo & Học Vụ Trực Tuyến')).toBeNull();
});

test('the hero sign-in action opens /sign-in', async () => {
  await render(tree());

  await fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập' }));

  expect(mockPush).toHaveBeenCalledWith('/sign-in');
});

test('a module card that needs a session sends the guest to /sign-in', async () => {
  await render(tree());

  expect(screen.getAllByText('Cần đăng nhập').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByTestId('guest-hub-dashboard'));

  expect(mockPush).toHaveBeenLastCalledWith('/sign-in');
});

test('a public module card opens its existing guest route', async () => {
  await render(tree());

  await fireEvent.press(screen.getByTestId('guest-hub-news'));

  expect(mockPush).toHaveBeenLastCalledWith('/news');
});

test('the English landing keeps the web hub wording', async () => {
  await render(tree('en'));

  expect(screen.getByRole('header', { name: 'Academic Portal & Student Management' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Campus hub' })).toBeOnTheScreen();
  expect(screen.getAllByText('Planned').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Sign in required').length).toBeGreaterThan(0);
});

test('a guest can switch the landing language from its header', async () => {
  await render(tree());

  const toggle = screen.getByRole('button', { name: shellMessages.vi.language });
  const toggleStyle = StyleSheet.flatten(toggle.props.style);
  expect(toggleStyle.minHeight).toBeGreaterThanOrEqual(48);
  expect(toggleStyle.minWidth).toBeGreaterThanOrEqual(48);

  await fireEvent.press(toggle);

  expect(screen.getByText('Campus academic portal')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: shellMessages.en.language })).toBeOnTheScreen();
});

test('the Vietnamese landing has the selectable role capability board and portal actions', async () => {
  await render(tree());

  const tablist = screen.getByTestId('guest-identity-tabs');
  expect(tablist.props.accessibilityRole).toBe('tablist');
  expect(tablist.props.accessibilityLabel).toBe('Truy cập học vụ trực tiếp');
  const roles = [
    {
      tab: 'Sinh viên',
      rows: [
        ['Đăng ký học phần trong đợt mở', 'Chọn lớp theo chương trình đào tạo của bạn.'],
        ['Thời khóa biểu, điểm và bảng điểm', 'Theo dõi kết quả từng học kỳ đã công bố.'],
        ['Tiến độ đồ án – khóa luận', 'Nhóm, đề tài và các mốc cần lưu ý.'],
      ],
      action: 'Vào Cổng Sinh viên',
    },
    {
      tab: 'Giảng viên',
      rows: [
        ['Lớp học phần đang giảng dạy', 'Danh sách lớp và lịch dạy theo học kỳ.'],
        ['Nhập điểm và công bố', 'Cập nhật điểm thành phần rồi công bố cho sinh viên.'],
        ['Nhóm hướng dẫn', 'Theo dõi nhóm đồ án và tiến độ thực hiện.'],
      ],
      action: 'Vào Cổng Giảng viên',
    },
    {
      tab: 'Quản trị',
      rows: [
        ['Người dùng và danh mục', 'Tài khoản, môn học, lớp học phần, học kỳ.'],
        ['Thông báo chính thức', 'Đăng và lưu hành thông báo của nhà trường, khoa.'],
        ['Đợt luận văn', 'Khởi tạo đợt, hội đồng và công bố kết quả.'],
      ],
      action: 'Vào Cổng Quản trị',
    },
  ];

  for (const role of roles) {
    const tab = screen.getByRole('tab', { name: role.tab });
    await fireEvent.press(tab);
    expect(tab.props.accessibilityState.selected).toBe(true);
    for (const [title, description] of role.rows) {
      expect(screen.getByText(title)).toBeOnTheScreen();
      expect(screen.getByText(description)).toBeOnTheScreen();
    }
    expect(screen.getByRole('button', { name: role.action })).toBeOnTheScreen();
  }

  await fireEvent.press(screen.getByRole('tab', { name: 'Giảng viên' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Vào Cổng Giảng viên' }));
  expect(mockPush).toHaveBeenLastCalledWith('/sign-in');
});

test('the English landing uses the web role tabs, capability rows and portal actions', async () => {
  await render(tree('en'));

  const tablist = screen.getByTestId('guest-identity-tabs');
  expect(tablist.props.accessibilityRole).toBe('tablist');
  expect(tablist.props.accessibilityLabel).toBe('Direct campus access');
  const roles = [
    {
      tab: 'Student',
      rows: [
        ['Course registration in open rounds', 'Pick classes that follow your curriculum.'],
        ['Timetable, grades and transcript', 'Track published results for every term.'],
        ['Thesis and capstone progress', 'Your group, topic and the milestones ahead.'],
      ],
      action: 'Enter Student Portal',
    },
    {
      tab: 'Lecturer',
      rows: [
        ['Classes you teach', 'Section rosters and the teaching timetable.'],
        ['Enter and publish grades', 'Update components, then publish to students.'],
        ['Supervised groups', 'Follow each thesis group and its progress.'],
      ],
      action: 'Enter Lecturer Portal',
    },
    {
      tab: 'Admin',
      rows: [
        ['People and catalog', 'Accounts, courses, sections and terms.'],
        ['Official announcements', 'Publish university and faculty notices.'],
        ['Thesis rounds', 'Open rounds, councils and published results.'],
      ],
      action: 'Enter Admin Portal',
    },
  ];

  for (const role of roles) {
    const tab = screen.getByRole('tab', { name: role.tab });
    await fireEvent.press(tab);
    expect(tab.props.accessibilityState.selected).toBe(true);
    for (const [title, description] of role.rows) {
      expect(screen.getByText(title)).toBeOnTheScreen();
      expect(screen.getByText(description)).toBeOnTheScreen();
    }
    expect(screen.getByRole('button', { name: role.action })).toBeOnTheScreen();
  }
});
