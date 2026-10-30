import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { operationsMessages } from '../../src/i18n/operations-messages';
import { UiText } from '../../src/components/Ui';
import { Sheet } from '../../src/components/ui/primitives';

const mockApi = { mode: 'live' as 'live' | 'preview' };

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
  campusApi: {},
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'preview', role: 'lecturer', capabilities: [] }),
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({
    data: undefined,
    error: null,
    warning: null,
    errorStatus: null,
    isLoading: false,
    isStale: false,
    reload: jest.fn(async () => {}),
    setData: jest.fn(),
  }),
}));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (callback: () => void) => useEffect(callback, [callback]), useLocalSearchParams: () => ({}) };
});

import { AdminDashboardScreen, AdminLecturersScreen, AdminStudentsScreen } from '../../src/screens/operations/AdminScreens';
import { AttendanceRosterRow } from '../../src/screens/operations/AttendanceRosterRow';
import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';

const renderThemed = async (element: ReactElement) =>
  render(<ThemeProvider forcedScheme="light">{element}</ThemeProvider>);
const renderEnglish = async (element: ReactElement) =>
  render(
    <LocaleProvider initialLocale="en">
      <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
    </LocaleProvider>,
  );

const nav = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() } as never;

beforeEach(() => {
  mockApi.mode = 'live';
  jest.clearAllMocks();
});

describe('admin surfaces never fabricate live records', () => {
  test('live students directory shows the web handoff and no fixture rows', async () => {
    await renderThemed(<AdminStudentsScreen />);
    expect(screen.queryByText('Nguyễn Đức Minh')).toBeNull();
    expect(screen.queryByLabelText('Tìm sinh viên')).toBeNull();
    expect(screen.getAllByText('Mở trên web').length).toBeGreaterThan(0);
  });

  test('live lecturers directory shows the web handoff and no fixture rows', async () => {
    await renderThemed(<AdminLecturersScreen />);
    expect(screen.queryByText(/Nguyễn Văn A/)).toBeNull();
    expect(screen.getAllByText('Mở trên web').length).toBeGreaterThan(0);
  });

  test('live dashboard renders no fabricated metrics or fixture counts', async () => {
    await renderThemed(
      <AdminDashboardScreen navigation={nav} role="admin" selectedThesisTopicId={null} />,
    );
    expect(screen.queryByText('18,420')).toBeNull();
    expect(screen.queryByText(/sinh viên · Tra cứu/)).toBeNull();
    expect(screen.queryByText(/940 giảng viên/)).toBeNull();
  });

  test('preview labels the directory fixtures and shows a localized no-match state', async () => {
    mockApi.mode = 'preview';
    await renderThemed(<AdminStudentsScreen />);
    expect(screen.getByText('Dữ liệu xem trước, không phải hồ sơ thật.')).toBeTruthy();
    expect(screen.getByText('Nguyễn Đức Minh')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Tìm sinh viên'), 'zzz-no-match');
    expect(screen.getByText('Không có kết quả phù hợp')).toBeTruthy();
  });
});

describe('directory handoff', () => {
  test('detail sheet open-on-web calls the portal route and reports a failed handoff', async () => {
    mockApi.mode = 'preview';
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler') as never);
    await renderThemed(<AdminStudentsScreen />);
    await fireEvent.press(screen.getByText('Nguyễn Đức Minh'));
    await waitFor(() => expect(screen.getByText('Chi tiết sinh viên')).toBeTruthy());
    await fireEvent.press(screen.getAllByText('Mở trên web').at(-1)!);
    await waitFor(() => expect(openURL).toHaveBeenCalled());
    expect(String(openURL.mock.calls[0]?.[0])).toContain('/admin/users');
    await waitFor(() =>
      expect(screen.getAllByText('Không mở được liên kết.').length).toBeGreaterThan(0),
    );
    openURL.mockRestore();
  });
});

describe('staff literals follow the locale', () => {
  test('english locale shows no vietnamese literals in the lecturer directory', async () => {
    mockApi.mode = 'preview';
    await renderEnglish(<AdminLecturersScreen />);
    expect(screen.queryByText(/Đủ chỉ tiêu|nhóm|Nghiên cứu| SV$/)).toBeNull();
    await fireEvent.press(screen.getByText(/Lê Hoàng C/));
    await waitFor(() => expect(screen.getByText('Lecturer details')).toBeTruthy());
    expect(screen.getByText('Research')).toBeTruthy();
    expect(screen.getAllByText('Full').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 groups · 20\/20 students/).length).toBeGreaterThan(0);
  });
});

describe('attendance bulk and clear actions', () => {
  test('a filtered roster discloses the mark-all scope with the affected count', async () => {
    mockApi.mode = 'preview';
    await renderThemed(
      <LecturerAttendanceScreen navigation={nav} role="lecturer" selectedThesisTopicId={null} />,
    );
    await waitFor(() => expect(screen.getByText('Tất cả có mặt')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Tìm sinh viên'), 'duc');
    expect(screen.getByText('Tất cả có mặt (1 đang lọc)')).toBeTruthy();
  });

  test('the clear control clears a marked status', async () => {
    const onChange = jest.fn();
    const row = { studentId: 's1', studentCode: '2110001', name: 'An', status: 'PRESENT' as const, notes: '', stored: true };
    await renderThemed(<AttendanceRosterRow row={row} copy={operationsMessages.vi} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Bỏ điểm danh của An' }));
    expect(onChange).toHaveBeenCalledWith('s1', null);
  });

  test('the clear control is disabled while nothing is marked', async () => {
    const row = { studentId: 's2', studentCode: '2110002', name: 'Binh', status: null, notes: '', stored: false };
    await renderThemed(<AttendanceRosterRow row={row} copy={operationsMessages.vi} onChange={jest.fn()} />);
    const clear = screen.getByRole('button', { name: 'Bỏ điểm danh của Binh' });
    expect(clear.props.accessibilityState?.disabled).toBe(true);
  });
});

describe('shared sheet scroll contract', () => {
  test('a long body scrolls while the footer stays outside the scrollable region', async () => {
    const long = 'x'.repeat(4000);
    await renderThemed(
      <Sheet visible scroll onClose={() => {}} title="Preview" footer={<UiText variant="label">Actions</UiText>}>
        <UiText variant="bodyMedium">{long}</UiText>
      </Sheet>,
    );
    const insideScroll = (start: { parent: unknown; type: string }) => {
      let node: { parent: unknown; type: string } | null = start;
      while (node) {
        if (node.type.includes('ScrollView')) return true;
        node = node.parent as typeof node;
      }
      return false;
    };
    expect(insideScroll(screen.getByText(long))).toBe(true);
    expect(insideScroll(screen.getByText('Actions'))).toBe(false);
  });
});
