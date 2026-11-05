import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactElement } from 'react';

import { tokens } from '../../src/design/tokens';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';
import { previewSections } from '../../src/screens/academic/academic-preview';

const mockPost = jest.fn<(path: string, body?: unknown, init?: { headers?: Record<string, string> }) => Promise<unknown>>();
let mockKeyCounter = 0;
jest.mock('../../src/api/client', () => ({
  apiClient: {
    mode: 'preview',
    post: (...args: unknown[]) => (mockPost as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
    get: jest.fn(async () => []),
  },
  createAssistantClientRequestId: () => `req-${++mockKeyCounter}`,
  campusApi: new Proxy({}, { get: () => jest.fn(async () => ({ data: [] })) }),
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

let mockFlags = { dean: false, staff: false, admin: false, checkin: false };
jest.mock('../../src/config/lane-flags', () => ({
  get LANE_FLAGS() {
    return mockFlags;
  },
}));

let mockSession = { kind: 'preview', role: 'student', capabilities: [] as string[] };
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => mockSession,
}));
jest.mock('../../src/auth/oidc-session', () => ({ signInWithOidc: jest.fn() }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: {} }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ isConnected: true }) }));

const mockQueries: Record<string, { data?: unknown; warning?: string | null; error?: string | null; errorStatus?: number; isLoading?: boolean }> = {};
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => ({
    data: undefined,
    error: null,
    warning: null,
    isLoading: false,
    reload: jest.fn(async () => {}),
    setData: jest.fn(),
    ...mockQueries[key],
  }),
}));

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useLocalSearchParams: () => ({}),
    usePathname: () => '/dashboard',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

import { apiClient } from '../../src/api/client';
import { ProfileScreen } from '../../src/screens/student/ProfileScreen';
import { RegistrationScreen } from '../../src/screens/student/RegistrationScreen';
import { AttendanceScreen } from '../../src/screens/student/AttendanceScreen';
import { ScheduleScreen } from '../../src/screens/student/ScheduleScreen';
import { EnrollmentsScreen } from '../../src/screens/academic/EnrollmentsScreen';
import { NotificationsScreen } from '../../src/screens/student/NotificationsScreen';

const navigation = {
  navigate: jest.fn(),
  navigateLane: jest.fn(),
  goBack: jest.fn(),
  signOut: jest.fn(),
} as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

type Host = {
  type: string;
  props: {
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessible?: boolean;
  };
  children?: (Host | string)[] | null;
};
const style = (node: Host): ViewStyle => StyleSheet.flatten(node.props.style) ?? {};
const children = (node: Host) => (node.children ?? []).filter((child): child is Host => typeof child !== 'string');
const number = (value: unknown) => (typeof value === 'number' ? value : 0);
const margin = (node: Host, edge: 'Top' | 'Bottom') => {
  const s = style(node);
  return number(s[`margin${edge}`] ?? s.marginVertical ?? s.margin);
};
const padding = (node: Host, edge: 'Top' | 'Bottom') => {
  const s = style(node);
  return number(s[`padding${edge}`] ?? s.paddingVertical ?? s.padding);
};
const label = (node: Host): string =>
  node.props.accessibilityLabel ??
  (node.children ?? []).map((child) => (typeof child === 'string' ? child : label(child))).join(' ').slice(0, 75);
function hasInput(node: Host): boolean {
  return node.type.includes('TextInput') || children(node).some(hasInput);
}
function atomic(node: Host): boolean {
  const s = style(node);
  const items = children(node);
  const field = items.length <= 3 && items[0]?.type === 'Text' && items[1] && hasInput(items[1]);
  return (
    (node.type !== 'View' && !node.type.includes('Cell')) ||
    Boolean(
      s.backgroundColor ||
        s.borderWidth ||
        s.flexDirection?.startsWith('row') ||
        node.props.accessibilityRole ||
        node.props.accessible ||
        field,
    )
  );
}
function empty(node: Host): boolean {
  const s = style(node);
  return (
    !(node.children?.length) &&
    !s.height &&
    !s.backgroundColor &&
    !s.borderWidth &&
    !margin(node, 'Top') &&
    !margin(node, 'Bottom')
  );
}
function edgeSpace(node: Host, edge: 'Top' | 'Bottom'): number {
  const s = style(node);
  const own = margin(node, edge);
  const items = children(node).filter((child) => !empty(child));
  if (atomic(node) && !(items.length === 1 && !s.backgroundColor && !s.borderWidth && !s.flexDirection)) return own;
  if (!items.length) return own + number(s.height);
  return own + padding(node, edge) + edgeSpace(edge === 'Top' ? items[0] : items[items.length - 1], edge);
}
function joinedCard(first: Host, second: Host): boolean {
  while (children(first).length === 1 && !style(first).backgroundColor) first = children(first)[0];
  while (children(second).length === 1 && !style(second).backgroundColor) second = children(second)[0];
  const a = style(first),
    b = style(second);
  return a.borderBottomWidth === 0 && b.borderTopWidth === 0 && Boolean(a.backgroundColor && b.backgroundColor);
}
function auditColumn(node: Host, problems: string[]) {
  if (atomic(node)) return;
  const items = children(node).filter((child) => !empty(child));
  const s = style(node);
  for (let i = 1; i < items.length; i++) {
    const first = items[i - 1],
      second = items[i];
    const space = edgeSpace(first, 'Bottom') + edgeSpace(second, 'Top') + number(s.rowGap ?? s.gap);
    const overlap = edgeSpace(second, 'Top');
    const paddedOverlap = overlap < 0 && padding(first, 'Bottom') + overlap >= tokens.spacing.xs;
    if (space < tokens.spacing.xs && !joinedCard(first, second) && !paddedOverlap) {
      problems.push(`${label(first)} -> ${label(second)}: ${space} dp`);
    }
  }
  items.forEach((child) => auditColumn(child, problems));
}
function auditScrolls(node: Host, problems: string[]): number {
  if (node.type.includes('ScrollView')) {
    const content = { ...node, type: 'View', props: { style: node.props.contentContainerStyle } };
    auditColumn(content, problems);
    return 1;
  }
  return children(node).reduce((count, child) => count + auditScrolls(child, problems), 0);
}

async function renderScreen(element: ReactElement) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 393, height: 852, scale: 2, fontScale: 1 });
  return render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: 16, left: 0, right: 0 }}>
      <ThemeProvider forcedScheme="light">
        <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
      </ThemeProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  Object.defineProperty(apiClient, 'mode', { value: 'preview', configurable: true });
  mockSession = { kind: 'preview', role: 'student', capabilities: [] };
  mockFlags = { dean: false, staff: false, admin: false, checkin: false };
  mockPost.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('vertical rhythm in student transient states and notices', () => {
  test('profile cached warning maintains spacing before identity hero', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries.profile = {
      data: {
        id: 'usr-minh',
        email: 'minh.nguyen@ute.edu.vn',
        firstName: 'Minh',
        lastName: 'Nguyen',
        studentId: '2022SE0417',
        role: 'student',
      },
      warning: 'Dữ liệu có thể đã cũ do chưa kết nối được máy chủ.',
    };
    const view = await renderScreen(<ProfileScreen {...props} />);
    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('registration drop notice maintains spacing before basket hero', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries['academic.registration'] = {
      data: {
        sections: [previewSections[0]],
        enrollments: [{ id: 'enr-drop-1', sectionId: previewSections[0].id, semesterId: 's1', status: 'ENROLLED' }],
        roundOpen: true,
        eligibility: { eligible: true, creditLimit: 20, creditsUsed: 3, creditsRemaining: 17 },
        closedReason: null,
      },
    };
    mockPost.mockResolvedValueOnce({ message: 'ok' });
    const view = await renderScreen(<RegistrationScreen {...props} />);
    const dropBtn = await screen.findByRole('button', { name: `Rút lớp: ${previewSections[0].courseCode}` });
    await fireEvent.press(dropBtn);
    const confirmBtn = await screen.findByRole('button', { name: 'Rút lớp' });
    await fireEvent.press(confirmBtn);
    expect(await screen.findByText('Đã rút lớp')).toBeTruthy();

    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('registration failed action notice maintains spacing before basket hero', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries['academic.registration'] = {
      data: {
        sections: [previewSections[0]],
        enrollments: [],
        roundOpen: true,
        eligibility: { eligible: true, creditLimit: 20, creditsUsed: 3, creditsRemaining: 17 },
        closedReason: null,
      },
    };
    mockPost.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    const view = await renderScreen(<RegistrationScreen {...props} />);
    const selectBtn = await screen.findByRole('button', { name: new RegExp(`^Chọn.*${previewSections[0].courseCode}`) });
    await fireEvent.press(selectBtn);
    const registerBtn = await screen.findByRole('button', { name: new RegExp('^Đăng ký') });
    await fireEvent.press(registerBtn);
    expect(await screen.findByText('Không có kết nối. Chưa thể đăng ký hoặc rút lớp.')).toBeTruthy();

    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('registration eligibility error maintains spacing before controls', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries['academic.registration'] = {
      data: {
        sections: previewSections,
        enrollments: [],
        roundOpen: true,
        eligibility: null,
        eligibilityError: { status: 500 },
        closedReason: null,
      },
    };
    const view = await renderScreen(<RegistrationScreen {...props} />);
    expect(await screen.findByText('Có lỗi xảy ra. Vui lòng thử lại.')).toBeTruthy();

    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('attendance checkin card maintains spacing before filters and subsequent blocks', async () => {
    mockFlags = { dean: false, staff: false, admin: false, checkin: true };
    mockSession = { kind: 'authenticated', role: 'student', capabilities: ['student.checkin'] };
    const view = await renderScreen(<AttendanceScreen {...props} />);
    expect(await screen.findByTestId('checkin-entry')).toBeTruthy();

    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('attendance semester failure maintains spacing before empty state', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries['academic.semesters'] = { error: 'Không thể tải danh sách học kỳ.', errorStatus: 500 };
    mockQueries['academic.attendance.summary.'] = { data: [] };
    const view = await renderScreen(<AttendanceScreen {...props} />);
    expect(await screen.findByText('Không thể tải danh sách học kỳ.')).toBeTruthy();

    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('schedule semester failure maintains spacing before term and view controls', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries['academic.semesters'] = { error: 'Không thể tải danh sách học kỳ.', errorStatus: 500 };
    const view = await renderScreen(<ScheduleScreen {...props} />);
    expect(await screen.findByText('Không thể tải danh sách học kỳ.')).toBeTruthy();

    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('enrollments semester failure maintains spacing before tabs', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries['academic.semesters'] = { error: 'Không thể tải danh sách học kỳ.', errorStatus: 500 };
    const view = await renderScreen(<EnrollmentsScreen {...props} />);
    expect(await screen.findByText('Không thể tải danh sách học kỳ.')).toBeTruthy();

    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });

  test('notifications offline and push cards maintain regular gap in header', async () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    const view = await renderScreen(<NotificationsScreen {...props} />);
    const problems: string[] = [];
    const root = view.toJSON() as Host;
    expect(root).toBeTruthy();
    expect(auditScrolls(root, problems)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    await view.unmount();
  });
});
