import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider, useLocale } from '../../src/i18n/locale-provider';

const mockApi = { mode: 'live' as 'preview' | 'live' };
const mockRequests = { announcements: jest.fn() };
const mockReload = jest.fn();
const mockKeys: string[] = [];
const mockPendingRequests = new Set<string>();
type QueryValue = {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  isLoading?: boolean;
  isStale?: boolean;
  errorStatus?: number | null;
  errorInput?: unknown;
};
const mockQueries: Record<string, QueryValue> = {};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
  campusApi: { announcements: (...args: unknown[]) => mockRequests.announcements(...args) },
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, _requestId: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string, request?: () => Promise<unknown>, options?: { mapError?: (error: unknown) => string }) => {
    mockKeys.push(key);
    if (mockPendingRequests.has(key) && request) void request();
    const { errorInput, ...query } = mockQueries[key] ?? {};
    return {
      data: undefined,
      warning: null,
      isLoading: false,
      errorStatus: null,
      ...query,
      error: errorInput === undefined ? query.error ?? null : options?.mapError?.(errorInput) ?? query.error ?? null,
      reload: () => mockReload(key),
      setData: jest.fn(),
    };
  },
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'signedIn', role: 'student', capabilities: [] }),
}));
// The check-in entry lane is owned by another worker — keep it out of this test.
jest.mock('../../src/screens/attendance-checkin/CheckinEntryCard', () => ({ CheckinEntryCard: () => null }));

import { StudentDashboardScreen } from '../../src/screens/student/StudentDashboardScreen';
import { ApiClientError } from '../../src/api/client';
import { academicMessages } from '../../src/i18n/academic-messages';
import { formatLongDate } from '../../src/i18n/locale';
import type { MobileScreenProps } from '../../src/navigation/types';

const semesterName = 'Học kỳ 1 năm học 2026-2027';

const dashboardValue = (
  enrollments: unknown[],
  options: { semesterId?: string; semesterName?: string; creditLimit?: number | null } = {},
) => ({
  semesterId: options.semesterId ?? 'sem-1',
  semester: {
    id: options.semesterId ?? 'sem-1',
    name: options.semesterName ?? semesterName,
    nameVi: options.semesterName ?? semesterName,
    status: 'IN_PROGRESS',
  },
  enrollments,
  creditLimit: options.creditLimit ?? null,
});

const enrollment = (
  id: string,
  status: string,
  course: { code: string; name: string; credits?: number },
  schedules?: Array<{ dayOfWeek: number; startTime: string; endTime: string; classroom?: { building?: string; roomNumber?: string } }>,
) => ({
  id,
  sectionId: `sec-${id}`,
  semesterId: 'sem-1',
  status,
  section: {
    id: `sec-${id}`,
    sectionNumber: 'N01',
    semesterId: 'sem-1',
    capacity: 40,
    enrolledCount: 1,
    status: 'OPEN',
    course,
    schedules,
  },
});

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
let changeDashboardLocale: (locale: 'vi' | 'en') => void = () => {};

function LocaleControl() {
  changeDashboardLocale = useLocale().setLocale;
  return null;
}

const screenElement = (locale: 'vi' | 'en' = 'vi') => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale={locale}>
      <LocaleControl />
      <StudentDashboardScreen {...props} />
    </LocaleProvider>
  </ThemeProvider>
);
const renderScreen = (locale: 'vi' | 'en' = 'vi') => render(screenElement(locale));

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockApi.mode = 'live';
  mockReload.mockClear();
  mockPendingRequests.clear();
  mockKeys.length = 0;
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
});

describe('student dashboard live mode', () => {
  test('an unreachable dashboard read shows retry and recovers without a blank shell', async () => {
    mockQueries['academic.dashboard'] = { error: 'Không có kết nối.' };
    mockQueries.announcements = { data: { data: [] } };
    const view = await renderScreen();

    expect(screen.getByText('Không có kết nối.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
    expect(screen.queryByText('0 lớp đang học')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReload).toHaveBeenCalledWith('academic.dashboard');

    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    await view.rerender(screenElement());
    expect(screen.queryByText('Không có kết nối.')).toBeNull();
    expect(screen.getByText('0 lớp đang học')).toBeOnTheScreen();
  });

  test('the dashboard reads its own term-scoped overview entry, not the unscoped enrollment list', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen();
    expect(mockKeys).toContain('academic.dashboard');
    expect(mockKeys).not.toContain('academic.enrollments');
    expect(mockKeys).not.toContain('enrollments');
  });

  test('a sparse enrollment never renders its raw sectionId as the course code (ux-m1-05)', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([{ id: 'enr-1', sectionId: '9f8b2c-section-uuid', semesterId: 'sem-1', status: 'ENROLLED' }]),
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen();
    expect(screen.queryByText('9f8b2c-section-uuid')).toBeNull();
    expect(screen.getByText(/^Học phần - /)).toBeOnTheScreen();
  });

  test('a section number still shows when no course code exists (ux-m1-05)', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([{
        id: 'enr-2',
        sectionId: 'sec-x',
        semesterId: 'sem-1',
        status: 'ENROLLED',
        section: { id: 'sec-x', sectionNumber: 'N02', semesterId: 'sem-1', capacity: 40, enrolledCount: 10, status: 'OPEN' },
      }]),
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen();
    expect(screen.getByText(/^N02 - /)).toBeOnTheScreen();
  });

  test('a failed announcements fetch shows the neutral error copy, not a fabricated zero (ux-m1-06)', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { error: 'Không tải được thông báo.' };
    const view = await renderScreen();
    expect(screen.getAllByText('Không tải được thông báo.')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReload).toHaveBeenCalledWith('announcements');
    expect(screen.queryByText('0 thông báo của trường')).toBeNull();

    mockQueries.announcements = { data: { data: [{ id: 'recovered' }], meta: { total: 1 } } };
    await view.rerender(screenElement());
    expect(screen.getByText('1 thông báo của trường')).toBeOnTheScreen();
    expect(screen.queryByText('Không tải được thông báo.')).toBeNull();
  });

  test('a widget-level 401 shows retry copy instead of session-expired copy', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = {
      errorInput: new ApiClientError('unauthorized', 401, 'req-1', 'HTTP_401'),
    };
    await renderScreen();

    expect(screen.getByText('Không tải được thông báo.')).toBeOnTheScreen();
    expect(screen.queryByText('Vui lòng đăng nhập lại để tiếp tục.')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReload).toHaveBeenCalledWith('announcements');
  });

  test('a healthy announcements fetch still shows the real count', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { data: { data: [{ id: 'a' }, { id: 'b' }], meta: { total: 2 } } };
    await renderScreen();
    expect(screen.getByText('2 thông báo của trường')).toBeOnTheScreen();
  });

  test('the hero counts every announcement, not just the first page', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = {
      data: { data: Array.from({ length: 20 }, (_, index) => ({ id: `a${index}` })), meta: { total: 45 } },
    };
    await renderScreen('en');
    expect(screen.getByText('45 campus announcements')).toBeOnTheScreen();
    expect(screen.queryByText('20 campus announcements')).toBeNull();
  });

  test('hides an initial zero while announcements load and keeps cached count during revalidation', async () => {
    const pending = new Promise<{ data: unknown[] }>(() => {});
    mockRequests.announcements.mockReturnValue(pending);
    mockPendingRequests.add('announcements');
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { isLoading: true };

    const view = await renderScreen('en');
    expect(mockRequests.announcements).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0 campus announcements')).toBeNull();

    mockQueries.announcements = { data: { data: [{ id: 'a' }, { id: 'b' }], meta: { total: 2 } }, isLoading: false, isStale: true };
    await view.rerender(screenElement('en'));
    expect(mockRequests.announcements).toHaveBeenCalledTimes(2);
    expect(screen.getByText('2 campus announcements')).toBeOnTheScreen();
  });

  test('selects the course name for the active locale with academic fallback order', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([
        {
          id: 'enr-bilingual',
          sectionId: 'sec-bilingual',
          semesterId: 'sem-1',
          status: 'ENROLLED',
          section: {
            id: 'sec-bilingual',
            sectionNumber: 'N01',
            semesterId: 'sem-1',
            capacity: 40,
            enrolledCount: 1,
            status: 'OPEN',
            course: { code: 'CS101', name: 'Generic course name', nameEn: 'Introduction to Computing', nameVi: 'Nhập môn máy tính' },
          },
        },
        {
          id: 'enr-fallback',
          sectionId: 'sec-fallback',
          semesterId: 'sem-1',
          status: 'ENROLLED',
          section: {
            id: 'sec-fallback',
            sectionNumber: 'N02',
            semesterId: 'sem-1',
            capacity: 40,
            enrolledCount: 1,
            status: 'OPEN',
            course: { code: 'CS102', name: 'Generic fallback name', nameVi: 'Tên Việt dự phòng' },
          },
        },
      ]),
    };
    mockQueries.announcements = { data: { data: [] } };

    const english = await renderScreen('en');
    expect(screen.getByText(/Introduction to Computing/)).toBeOnTheScreen();
    expect(screen.getByText(/Tên Việt dự phòng/)).toBeOnTheScreen();
    await act(async () => changeDashboardLocale('vi'));
    expect(screen.getByText(/Nhập môn máy tính/)).toBeOnTheScreen();
    english.unmount();
  });

  test('preview mode leaves the preview disclosure to the app bar', async () => {
    mockApi.mode = 'preview';
    await renderScreen();
    expect(screen.queryByText('Xem thử')).toBeNull();
    expect(screen.queryByText('Học kỳ xem thử')).toBeNull();
    expect(screen.getByText('3 lớp đang học')).toBeOnTheScreen();
  });

  test('a single section and a single announcement use the singular English count', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([{
        id: 'enr-one',
        sectionId: 'sec-one',
        semesterId: 'sem-1',
        status: 'ENROLLED',
        section: {
          id: 'sec-one',
          sectionNumber: 'N01',
          semesterId: 'sem-1',
          capacity: 40,
          enrolledCount: 1,
          status: 'OPEN',
          course: { code: 'PE101', name: 'Physical Education', credits: 1 },
        },
      }]),
    };
    mockQueries.announcements = { data: { data: [{ id: 'a' }], meta: { total: 1 } } };
    await renderScreen('en');
    expect(screen.getByText('1 active section')).toBeOnTheScreen();
    expect(screen.getByText('1 campus announcement')).toBeOnTheScreen();
    expect(screen.queryByText('1 active sections')).toBeNull();
    expect(screen.queryByText('1 campus announcements')).toBeNull();
  });

  test('PENDING and CONFIRMED active enrollments count and keep their meetings', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([
        {
          id: 'enr-pending',
          sectionId: 'sec-pending',
          semesterId: 'sem-1',
          status: 'PENDING',
          section: {
            id: 'sec-pending',
            sectionNumber: 'N01',
            semesterId: 'sem-1',
            capacity: 40,
            enrolledCount: 1,
            status: 'OPEN',
            course: { code: 'CS201', name: 'Pending course' },
            schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '08:30' }],
          },
        },
        {
          id: 'enr-confirmed',
          sectionId: 'sec-confirmed',
          semesterId: 'sem-1',
          status: 'CONFIRMED',
          section: {
            id: 'sec-confirmed',
            sectionNumber: 'N02',
            semesterId: 'sem-1',
            capacity: 40,
            enrolledCount: 1,
            status: 'OPEN',
            course: { code: 'CS202', name: 'Confirmed course' },
            schedules: [{ dayOfWeek: 3, startTime: '09:00', endTime: '10:30' }],
          },
        },
      ], { creditLimit: 20 }),
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');
    expect(screen.getByText('2 lớp đang học')).toBeOnTheScreen();
    expect(screen.getAllByText(/CS201/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CS202/).length).toBeGreaterThan(0);
  });

  test('the Vietnamese count copy keeps its single form', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([{
        id: 'enr-one',
        sectionId: 'sec-one',
        semesterId: 'sem-1',
        status: 'ENROLLED',
        section: {
          id: 'sec-one',
          sectionNumber: 'N01',
          semesterId: 'sem-1',
          capacity: 40,
          enrolledCount: 1,
          status: 'OPEN',
          course: { code: 'PE101', name: 'Giáo dục thể chất', credits: 1 },
        },
      }]),
    };
    mockQueries.announcements = { data: { data: [{ id: 'a' }], meta: { total: 1 } } };
    await renderScreen('vi');
    expect(screen.getByText('1 lớp đang học')).toBeOnTheScreen();
    expect(screen.getByText('1 thông báo của trường')).toBeOnTheScreen();
  });

  test('the four web stat chips show the term counts and the semester name', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([
        enrollment('e1', 'ENROLLED', { code: 'CS101', name: 'Nhập môn', credits: 3 }),
        enrollment('e2', 'ENROLLED', { code: 'CS102', name: 'Kiến trúc', credits: 3 }),
        enrollment('e3', 'PENDING', { code: 'CS103', name: 'Phân tích', credits: 2 }),
        enrollment('e4', 'DROPPED', { code: 'CS104', name: 'Đã rút', credits: 3 }),
      ]),
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');

    expect(screen.getByLabelText('Môn học kỳ này: 3')).toBeOnTheScreen();
    expect(screen.getByLabelText('Đang học: 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Chờ xử lý: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText(`Học kỳ hiện tại: ${semesterName}`)).toBeOnTheScreen();
  });

  test('the study progress panel mirrors the web credits, cap and pending pill', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([
        enrollment('e1', 'ENROLLED', { code: 'CS101', name: 'Nhập môn', credits: 3 }),
        enrollment('e2', 'ENROLLED', { code: 'CS102', name: 'Kiến trúc', credits: 3 }),
        enrollment('e3', 'PENDING', { code: 'CS103', name: 'Phân tích', credits: 2 }),
      ], { creditLimit: 20 }),
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');

    expect(screen.getByText('8 / 20')).toBeOnTheScreen();
    expect(screen.getByText('Đã đạt 40% chỉ tiêu học kỳ')).toBeOnTheScreen();
    expect(screen.getByText('Còn có thể đăng ký thêm 12 tín chỉ')).toBeOnTheScreen();
    expect(screen.getByText('1 đăng ký chờ xử lý')).toBeOnTheScreen();
  });

  test('the current courses panel lists at most three active enrollments with status and footer links', async () => {
    mockQueries['academic.dashboard'] = {
      data: dashboardValue([
        enrollment('e1', 'ENROLLED', { code: 'CS101', name: 'Nhập môn', credits: 3 }),
        enrollment('e2', 'ENROLLED', { code: 'CS102', name: 'Kiến trúc', credits: 3 }),
        enrollment('e3', 'ENROLLED', { code: 'CS103', name: 'Phân tích', credits: 2 }),
        enrollment('e4', 'ENROLLED', { code: 'CS104', name: 'Thứ tư', credits: 2 }),
      ]),
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');

    expect(screen.getByText('4 môn')).toBeOnTheScreen();
    expect(screen.getByText('CS101 - Nhập môn')).toBeOnTheScreen();
    expect(screen.getByText('CS103 - Phân tích')).toBeOnTheScreen();
    expect(screen.queryByText('CS104 - Thứ tư')).toBeNull();
    expect(screen.getAllByText(academicMessages.vi.status.ENROLLED).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Môn học của tôi' }));
    expect(navigation.navigate).toHaveBeenCalledWith('enrollments');
    const scheduleLinks = screen.getAllByRole('button', { name: 'Thời khóa biểu' });
    await fireEvent.press(scheduleLinks[0]);
    expect(navigation.navigate).toHaveBeenCalledWith('schedule');
  });

  test('the empty current-courses panel uses the web copy and opens registration', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');

    expect(screen.getByText('Chưa có môn học đang hoạt động')).toBeOnTheScreen();
    expect(screen.getByText('Khi bạn có đăng ký đang hoạt động, các môn hiện tại sẽ xuất hiện tại đây.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Xem lớp học phần' }));
    expect(navigation.navigate).toHaveBeenCalledWith('registration');
  });

  test('quick access mirrors the six web shortcuts in order and maps each target', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');

    const labels = [
      'Đăng ký học phần',
      'Thời khóa biểu',
      'Điểm số',
      'Bảng điểm',
      'Đồ án – Khóa luận',
      'Thông báo Phòng Đào tạo',
    ];
    const tiles = within(screen.getByTestId('quick-access')).getAllByRole('button');
    expect(tiles.map((tile) => tile.props.accessibilityLabel)).toEqual(labels);

    const quickAccess = within(screen.getByTestId('quick-access'));
    const targets = ['registration', 'schedule', 'grades', 'transcript', 'thesis.topics', 'announcements'];
    for (let index = 0; index < labels.length; index += 1) {
      await fireEvent.press(quickAccess.getByRole('button', { name: labels[index] }));
      expect(navigation.navigate).toHaveBeenLastCalledWith(targets[index]);
    }
  });

  test('the header keeps registration beside the date chip without wrapping at 360dp and fontScale 1.3', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 800, scale: 2, fontScale: 1.3 } as ReturnType<typeof Dimensions.get>);
    jest.useFakeTimers({
      now: new Date('2026-11-09T02:00:00Z'),
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
    });
    try {
      mockApi.mode = 'live';
      mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
      mockQueries.announcements = { data: { data: [] } };
      await renderScreen('vi');
      const headerActions = screen.getByTestId('dashboard-header-actions');
      expect(StyleSheet.flatten(headerActions.props.style)?.flexWrap).toBe('nowrap');
      expect(within(headerActions).getByRole('button', { name: 'Đăng ký học phần' })).toBeOnTheScreen();
      expect(screen.getByText('Thứ Hai, 9 tháng 11, 2026')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  test('the heading uses the web eyebrow and the long-format date chip', async () => {
    jest.useFakeTimers({
      now: new Date('2026-11-09T02:00:00Z'),
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
    });
    try {
      mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
      mockQueries.announcements = { data: { data: [] } };
      await renderScreen('vi');

      expect(screen.getByText('CỔNG SINH VIÊN')).toBeOnTheScreen();
      expect(screen.getByText(formatLongDate(new Date(), 'vi'))).toBeOnTheScreen();
      expect(screen.getByText('Thứ Hai, 9 tháng 11, 2026')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  test('next-class rows keep the day badge, today/tomorrow badge, shift and room', async () => {
    jest.useFakeTimers({
      now: new Date('2026-11-09T02:00:00Z'),
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
    });
    try {
      mockQueries['academic.dashboard'] = {
        data: dashboardValue([
          enrollment('e1', 'ENROLLED', { code: 'CS101', name: 'Nhập môn', credits: 3 }, [
            { dayOfWeek: 2, startTime: '10:00', endTime: '11:30', classroom: { building: 'A2', roomNumber: '204' } },
          ]),
          enrollment('e2', 'ENROLLED', { code: 'CS102', name: 'Kiến trúc', credits: 3 }, [
            { dayOfWeek: 3, startTime: '13:00', endTime: '14:30', classroom: { building: 'B1', roomNumber: '108' } },
          ]),
        ]),
      };
      mockQueries.announcements = { data: { data: [] } };
      await renderScreen('vi');

      expect(screen.getByText('T2')).toBeOnTheScreen();
      expect(screen.getByText('T3')).toBeOnTheScreen();
      expect(screen.getByText('Hôm nay')).toBeOnTheScreen();
      expect(screen.getByText('Ngày mai')).toBeOnTheScreen();
      expect(screen.getByText('Ca Sáng')).toBeOnTheScreen();
      expect(screen.getByText('Ca Chiều')).toBeOnTheScreen();
      expect(screen.getByText('CS101 — Nhập môn')).toBeOnTheScreen();
      expect(screen.getByText('10:00–11:30')).toBeOnTheScreen();
      expect(screen.getByText('Phòng A2-204')).toBeOnTheScreen();
      expect(screen.getByText('Phòng B1-108')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  test('an unscheduled section is not listed as an upcoming class', async () => {
    jest.useFakeTimers({
      now: new Date('2026-11-09T02:00:00Z'),
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'nextTick', 'queueMicrotask'],
    });
    try {
      mockQueries['academic.dashboard'] = {
        data: dashboardValue([
          enrollment('e1', 'ENROLLED', { code: 'CS101', name: 'Nhập môn', credits: 3 }, [
            { dayOfWeek: 2, startTime: '10:00', endTime: '11:30' },
          ]),
          enrollment('e2', 'ENROLLED', { code: 'CS999', name: 'Chưa xếp lịch', credits: 2 }),
        ]),
      };
      mockQueries.announcements = { data: { data: [] } };
      await renderScreen('vi');

      expect(screen.queryByText('Chưa có lịch')).toBeNull();
      expect(screen.getAllByText('CS999 - Chưa xếp lịch')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the agenda uses the web section title and drops the mobile-only weekly stat', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');

    expect(screen.getByText('Lịch học hôm nay & sắp tới')).toBeOnTheScreen();
    expect(screen.queryByText('Buổi học mỗi tuần')).toBeNull();
    expect(screen.getByText('Chưa có buổi học nào được xếp lịch.')).toBeOnTheScreen();
    expect(screen.getByText('Truy cập nhanh')).toBeOnTheScreen();
  });

  test('the English dashboard uses the web labels for the new panels and shortcuts', async () => {
    mockQueries['academic.dashboard'] = { data: dashboardValue([]) };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('en');

    expect(screen.getByText('STUDENT AREA')).toBeOnTheScreen();
    expect(screen.getByLabelText('Courses this term: 0')).toBeOnTheScreen();
    expect(screen.getByText('Study progress')).toBeOnTheScreen();
    expect(screen.getByText('Current courses')).toBeOnTheScreen();
    expect(screen.getByText('Quick access')).toBeOnTheScreen();
    expect(screen.getByText('Today & upcoming classes')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Thesis area' })).toBeOnTheScreen();
  });
});
