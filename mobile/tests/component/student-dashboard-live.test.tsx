import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

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
import type { MobileScreenProps } from '../../src/navigation/types';

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
    mockQueries['academic.enrollments'] = { error: 'Không có kết nối.' };
    mockQueries.announcements = { data: { data: [] } };
    const view = await renderScreen();

    expect(screen.getByText('Không có kết nối.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
    expect(screen.queryByText('0 lớp đang học')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReload).toHaveBeenCalledWith('academic.enrollments');

    mockQueries['academic.enrollments'] = { data: [] };
    await view.rerender(screenElement());
    expect(screen.queryByText('Không có kết nối.')).toBeNull();
    expect(screen.getByText('0 lớp đang học')).toBeOnTheScreen();
  });

  test('the enrollment read shares the academic cache entry the dashboard prefetch fills', async () => {
    mockQueries['academic.enrollments'] = { data: [] };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen();
    expect(mockKeys).toContain('academic.enrollments');
    expect(mockKeys).not.toContain('enrollments');
  });

  test('a sparse enrollment never renders its raw sectionId as the course code (ux-m1-05)', async () => {
    mockQueries['academic.enrollments'] = {
      data: [{ id: 'enr-1', sectionId: '9f8b2c-section-uuid', semesterId: 'sem-1', status: 'ENROLLED' }],
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen();
    expect(screen.queryByText('9f8b2c-section-uuid')).toBeNull();
    expect(screen.getByText('Học phần')).toBeOnTheScreen();
  });

  test('a section number still shows when no course code exists (ux-m1-05)', async () => {
    mockQueries['academic.enrollments'] = {
      data: [{
        id: 'enr-2',
        sectionId: 'sec-x',
        semesterId: 'sem-1',
        status: 'ENROLLED',
        section: { id: 'sec-x', sectionNumber: 'N02', semesterId: 'sem-1', capacity: 40, enrolledCount: 10, status: 'OPEN' },
      }],
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen();
    expect(screen.getByText('N02')).toBeOnTheScreen();
  });

  test('a failed announcements fetch shows the neutral error copy, not a fabricated zero (ux-m1-06)', async () => {
    mockQueries['academic.enrollments'] = { data: [] };
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
    mockQueries['academic.enrollments'] = { data: [] };
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
    mockQueries['academic.enrollments'] = { data: [] };
    mockQueries.announcements = { data: { data: [{ id: 'a' }, { id: 'b' }], meta: { total: 2 } } };
    await renderScreen();
    expect(screen.getByText('2 thông báo của trường')).toBeOnTheScreen();
  });

  test('the hero counts every announcement, not just the first page', async () => {
    mockQueries['academic.enrollments'] = { data: [] };
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
    mockQueries['academic.enrollments'] = { data: [] };
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
    mockQueries['academic.enrollments'] = {
      data: [
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
      ],
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
    mockQueries['academic.enrollments'] = {
      data: [{
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
      }],
    };
    mockQueries.announcements = { data: { data: [{ id: 'a' }], meta: { total: 1 } } };
    await renderScreen('en');
    expect(screen.getByText('1 active section')).toBeOnTheScreen();
    expect(screen.getByText('1 campus announcement')).toBeOnTheScreen();
    expect(screen.queryByText('1 active sections')).toBeNull();
    expect(screen.queryByText('1 campus announcements')).toBeNull();
  });

  test('PENDING and CONFIRMED active enrollments count and keep their meetings', async () => {
    mockQueries['academic.enrollments'] = {
      data: [
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
      ],
    };
    mockQueries.announcements = { data: { data: [] } };
    await renderScreen('vi');
    expect(screen.getByText('2 lớp đang học')).toBeOnTheScreen();
    expect(screen.getByText('CS201')).toBeOnTheScreen();
    expect(screen.getByText('CS202')).toBeOnTheScreen();
  });

  test('the Vietnamese count copy keeps its single form', async () => {
    mockQueries['academic.enrollments'] = {
      data: [{
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
      }],
    };
    mockQueries.announcements = { data: { data: [{ id: 'a' }], meta: { total: 1 } } };
    await renderScreen('vi');
    expect(screen.getByText('1 lớp đang học')).toBeOnTheScreen();
    expect(screen.getByText('1 thông báo của trường')).toBeOnTheScreen();
  });
});
