import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

const mockApi = { mode: 'preview' as 'preview' | 'live' };
const mockQuery = {
  value: { data: undefined as unknown, error: null as string | null, warning: null as string | null, isLoading: false },
};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode, get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }; },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => ({
    ...mockQuery.value,
    data: typeof mockQuery.value.data === 'function' ? (mockQuery.value.data as (key: string) => unknown)(key) : mockQuery.value.data,
    errorStatus: null,
    reload: jest.fn(async () => {}),
    setData: jest.fn(),
  }),
}));

jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { AdmissionsScreen } from '../../src/screens/student/AdmissionsScreen';
import { CareersScreen } from '../../src/screens/student/CareersScreen';
import { DocsScreen } from '../../src/screens/student/DocsScreen';
import { EventsScreen } from '../../src/screens/student/EventsScreen';
import { LearningScreen } from '../../src/screens/student/LearningScreen';
import { LibraryScreen } from '../../src/screens/student/LibraryScreen';
import { NewsScreen } from '../../src/screens/student/NewsScreen';
import { NotificationsScreen } from '../../src/screens/student/NotificationsScreen';
import type { MobileScreenProps } from '../../src/navigation/types';
import { admissionsMessages } from '../../src/i18n/admissions-messages';
import { careersMessages } from '../../src/i18n/careers-messages';
import { campusMessages } from '../../src/i18n/campus-messages';
import { eventsMessages } from '../../src/i18n/events-messages';
import { learningMessages } from '../../src/i18n/learning-messages';
import { libraryMessages } from '../../src/i18n/library-messages';
import { recordsMessages } from '../../src/i18n/records-messages';
import { contentMessages } from '../../src/i18n/content-messages';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

const renderThemed = (element: ReactElement) => render(<ThemeProvider forcedScheme="light">{element}</ThemeProvider>);

afterEach(() => {
  jest.restoreAllMocks();
  mockApi.mode = 'preview';
  mockQuery.value = { data: undefined, error: null, warning: null, isLoading: false };
});

function setWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}

describe('service screens in preview mode (Vietnamese by default)', () => {
  test('news lists preview items under a labelled header', async () => {
    setWidth(360);
    await renderThemed(<NewsScreen {...props} />);
    expect(screen.getByRole('header', { name: campusMessages.vi.newsTitle })).toBeOnTheScreen();
    expect(screen.getByText('Lịch thi cuối kỳ')).toBeOnTheScreen();
    expect(screen.getByText(contentMessages.vi.previewNotice)).toBeOnTheScreen();
  });

  test('docs shows the preview document', async () => {
    setWidth(360);
    await renderThemed(<DocsScreen {...props} />);
    expect(screen.getByRole('header', { name: campusMessages.vi.docsTitle })).toBeOnTheScreen();
    expect(screen.getByText('Quy chế đào tạo tín chỉ')).toBeOnTheScreen();
  });

  test('events shows catalogue tabs and a preview event', async () => {
    setWidth(360);
    await renderThemed(<EventsScreen {...props} />);
    expect(screen.getByRole('header', { name: eventsMessages.vi.title })).toBeOnTheScreen();
    expect(screen.getByText('Ngày hội tình nguyện')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: eventsMessages.vi.mine })).toBeOnTheScreen();
  });

  test('notifications renders the unread tab and rows', async () => {
    setWidth(360);
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.getByRole('header', { name: recordsMessages.vi.notificationsTitle })).toBeOnTheScreen();
    expect(screen.getByText('Mở đăng ký đề tài luận văn')).toBeOnTheScreen();
  });

  test('library always carries the simulated banner and offers the loans tab', async () => {
    setWidth(360);
    await renderThemed(<LibraryScreen {...props} />);
    expect(screen.getByRole('header', { name: libraryMessages.vi.title })).toBeOnTheScreen();
    expect(screen.getByText(libraryMessages.vi.simulatedBanner)).toBeOnTheScreen();
    expect(screen.getByText('Nhập môn cấu trúc dữ liệu')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: libraryMessages.vi.myLoans }));
    expect(screen.getByText(libraryMessages.vi.loansActive)).toBeOnTheScreen();
  });

  test('careers shows the simulated banner and the preview posting', async () => {
    setWidth(360);
    await renderThemed(<CareersScreen {...props} />);
    expect(screen.getByRole('header', { name: careersMessages.vi.title })).toBeOnTheScreen();
    expect(screen.getByText(careersMessages.vi.simulatedBanner)).toBeOnTheScreen();
    expect(screen.getByText('Thực tập sinh Backend')).toBeOnTheScreen();
  });

  test('admissions shows the simulated banner and the returned application', async () => {
    setWidth(360);
    await renderThemed(<AdmissionsScreen {...props} />);
    expect(screen.getByRole('header', { name: admissionsMessages.vi.title })).toBeOnTheScreen();
    expect(screen.getByText(admissionsMessages.vi.simulatedBanner)).toBeOnTheScreen();
    expect(screen.getByText('2026-Q1-DEMO')).toBeOnTheScreen();
  });

  test('admissions detail locks the preview actions and shows the review note', async () => {
    setWidth(360);
    await renderThemed(<AdmissionsScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: new RegExp('2026-Q1-DEMO') }));
    expect(screen.getByText(admissionsMessages.vi.returnedHint)).toBeOnTheScreen();
    expect(screen.getByText('Bổ sung bảng điểm')).toBeOnTheScreen();
    const submit = screen.getByRole('button', { name: admissionsMessages.vi.resubmit });
    expect(submit.props.accessibilityState?.disabled).toBe(true);
  });

  test('learning lists the preview assignment and opens its detail', async () => {
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    expect(screen.getByRole('header', { name: learningMessages.vi.title })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: new RegExp('Bài thực hành 1') }));
    expect(screen.getByText(contentMessages.vi.previewNotice)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: learningMessages.vi.startDraft })).toBeNull();
  });
});

describe('service screens in live mode', () => {
  test('a failed load shows an error state with retry, never an empty list', async () => {
    mockApi.mode = 'live';
    mockQuery.value = { data: undefined, error: 'Không thể tải dữ liệu', warning: null, isLoading: false };
    setWidth(360);
    await renderThemed(<LibraryScreen {...props} />);
    expect(screen.getAllByText('Không thể tải dữ liệu').length).toBeGreaterThan(0);
    expect(screen.queryByText(libraryMessages.vi.emptyCatalogue)).toBeNull();
  });

  test('learning shows its own error state when sections cannot be read', async () => {
    mockApi.mode = 'live';
    mockQuery.value = { data: undefined, error: 'Không thể tải dữ liệu', warning: null, isLoading: false };
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    expect(screen.getByText(learningMessages.vi.errorTitle)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: learningMessages.vi.retry })).toBeOnTheScreen();
  });

  test('an empty live list shows the empty state', async () => {
    mockApi.mode = 'live';
    // The board is a paged first page; the application list is a plain array.
    mockQuery.value = { data: (key: string) => (key.includes('applications') ? [] : { items: [], hasMore: false }), error: null, warning: null, isLoading: false };
    setWidth(360);
    await renderThemed(<CareersScreen {...props} />);
    expect(screen.getByText(careersMessages.vi.emptyBoard)).toBeOnTheScreen();
  });
});
