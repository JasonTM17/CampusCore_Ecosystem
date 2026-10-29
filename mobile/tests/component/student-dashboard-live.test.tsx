import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider, useLocale } from '../../src/i18n/locale-provider';

const mockApi = { mode: 'live' as 'preview' | 'live' };
const mockRequests = { announcements: jest.fn() };
const mockPendingRequests = new Set<string>();
type QueryValue = {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  isLoading?: boolean;
  isStale?: boolean;
  errorStatus?: number | null;
};
const mockQueries: Record<string, QueryValue> = {};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
  campusApi: { announcements: (...args: unknown[]) => mockRequests.announcements(...args) },
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string, request?: () => Promise<unknown>) => {
    if (mockPendingRequests.has(key) && request) void request();
    return {
      data: undefined,
      error: null,
      warning: null,
      isLoading: false,
      errorStatus: null,
      ...(mockQueries[key] ?? {}),
      reload: jest.fn(),
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
  mockPendingRequests.clear();
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
});

describe('student dashboard live mode', () => {
  test('a sparse enrollment never renders its raw sectionId as the course code (ux-m1-05)', async () => {
    mockQueries.enrollments = {
      data: [{ id: 'enr-1', sectionId: '9f8b2c-section-uuid', semesterId: 'sem-1', status: 'ENROLLED' }],
    };
    mockQueries.announcements = { data: [] };
    await renderScreen();
    expect(screen.queryByText('9f8b2c-section-uuid')).toBeNull();
    expect(screen.getByText('Học phần')).toBeOnTheScreen();
  });

  test('a section number still shows when no course code exists (ux-m1-05)', async () => {
    mockQueries.enrollments = {
      data: [{
        id: 'enr-2',
        sectionId: 'sec-x',
        semesterId: 'sem-1',
        status: 'ENROLLED',
        section: { id: 'sec-x', sectionNumber: 'N02', semesterId: 'sem-1', capacity: 40, enrolledCount: 10, status: 'OPEN' },
      }],
    };
    mockQueries.announcements = { data: [] };
    await renderScreen();
    expect(screen.getByText('N02')).toBeOnTheScreen();
  });

  test('a failed announcements fetch shows the neutral error copy, not a fabricated zero (ux-m1-06)', async () => {
    mockQueries.enrollments = { data: [] };
    mockQueries.announcements = { error: 'Không tải được thông báo.' };
    await renderScreen();
    expect(screen.getByText('Không tải được thông báo.')).toBeOnTheScreen();
    expect(screen.queryByText('0 thông báo của trường')).toBeNull();
  });

  test('a healthy announcements fetch still shows the real count', async () => {
    mockQueries.enrollments = { data: [] };
    mockQueries.announcements = { data: [{ id: 'a' }, { id: 'b' }] };
    await renderScreen();
    expect(screen.getByText('2 thông báo của trường')).toBeOnTheScreen();
  });

  test('hides an initial zero while announcements load and keeps cached count during revalidation', async () => {
    const pending = new Promise<{ data: unknown[] }>(() => {});
    mockRequests.announcements.mockReturnValue(pending);
    mockPendingRequests.add('announcements');
    mockQueries.enrollments = { data: [] };
    mockQueries.announcements = { isLoading: true };

    const view = await renderScreen('en');
    expect(mockRequests.announcements).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0 campus announcements')).toBeNull();

    mockQueries.announcements = { data: [{ id: 'a' }, { id: 'b' }], isLoading: false, isStale: true };
    await view.rerender(screenElement('en'));
    expect(mockRequests.announcements).toHaveBeenCalledTimes(2);
    expect(screen.getByText('2 campus announcements')).toBeOnTheScreen();
  });

  test('selects the course name for the active locale with academic fallback order', async () => {
    mockQueries.enrollments = {
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
    mockQueries.announcements = { data: [] };

    const english = await renderScreen('en');
    expect(screen.getByText(/Introduction to Computing/)).toBeOnTheScreen();
    expect(screen.getByText(/Tên Việt dự phòng/)).toBeOnTheScreen();
    await act(async () => changeDashboardLocale('vi'));
    expect(screen.getByText(/Nhập môn máy tính/)).toBeOnTheScreen();
    english.unmount();
  });
});
