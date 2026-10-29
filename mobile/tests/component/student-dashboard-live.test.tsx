import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockApi = { mode: 'live' as 'preview' | 'live' };
type QueryValue = {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  isLoading?: boolean;
  errorStatus?: number | null;
};
const mockQueries: Record<string, QueryValue> = {};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
  campusApi: {},
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => ({
    data: undefined,
    error: null,
    warning: null,
    isLoading: false,
    errorStatus: null,
    ...(mockQueries[key] ?? {}),
    reload: jest.fn(),
    setData: jest.fn(),
  }),
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'signedIn', role: 'student', capabilities: [] }),
}));
import { StudentDashboardScreen } from '../../src/screens/student/StudentDashboardScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

const renderScreen = (locale: 'vi' | 'en' = 'vi') =>
  render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>
        <StudentDashboardScreen {...props} />
      </LocaleProvider>
    </ThemeProvider>,
  );

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
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
});
