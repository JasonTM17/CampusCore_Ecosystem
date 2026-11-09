import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { tokens } from '../../src/design/tokens';
import { ThemeProvider } from '../../src/design/theme';
import { formatDateTime } from '../../src/i18n/locale';

const mockApi = { mode: 'preview' as 'preview' | 'live' };
type QueryField<T> = T | ((key: string) => T);
type QueryValue = { data: QueryField<unknown>; error: QueryField<string | null>; warning: QueryField<string | null>; isLoading: QueryField<boolean> };
const mockQuery = {
  value: { data: undefined, error: null, warning: null, isLoading: false } as QueryValue,
};
const mockReloads: Record<string, ReturnType<typeof jest.fn>> = {};

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode, get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }; },
  campusApi: {},
  createAssistantClientRequestId: () => 'request-id',
  ApiClientError: class ApiClientError extends Error {},
}));

// The notification centre reads the session to resolve tap targets; preview is never a grant.
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'preview', role: 'student', capabilities: [] }),
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const value = mockQuery.value;
    const resolve = (field: unknown) => typeof field === 'function' ? (field as (key: string) => unknown)(key) : field;
    return {
      ...value,
      data: resolve(value.data),
      error: resolve(value.error),
      warning: resolve(value.warning),
      isLoading: resolve(value.isLoading),
      errorStatus: null,
      reload: mockReloads[key] ?? (mockReloads[key] = jest.fn(async () => {})),
      setData: jest.fn(),
    };
  },
}));

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { AdmissionsScreen } from '../../src/screens/student/AdmissionsScreen';
import { CareersScreen } from '../../src/screens/student/CareersScreen';
import { CertificatesScreen } from '../../src/screens/content/CertificatesScreen';
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
import { previewAdmissions } from '../../src/screens/content/preview-data';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

const renderThemed = (element: ReactElement) => render(<ThemeProvider forcedScheme="light">{element}</ThemeProvider>);

afterEach(() => {
  jest.restoreAllMocks();
  mockApi.mode = 'preview';
  mockQuery.value = { data: undefined, error: null, warning: null, isLoading: false };
  for (const key of Object.keys(mockReloads)) delete mockReloads[key];
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
    expect(screen.queryByText(contentMessages.vi.previewNotice)).toBeNull();
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
    expect(screen.getByText(admissionsMessages.vi.eyebrow)).toBeOnTheScreen();
    expect(screen.getByText(admissionsMessages.vi.description)).toBeOnTheScreen();
    expect(screen.getByText(admissionsMessages.vi.simulatedBanner)).toBeOnTheScreen();
    expect(screen.getByText('Nguyễn Văn A')).toBeOnTheScreen();
    expect(screen.getByText(`${admissionsMessages.vi.cycle}: 2026-Q1-DEMO`)).toBeOnTheScreen();
  });

  test('an admissions row shows the decision line under the status chip', async () => {
    mockApi.mode = 'live';
    const application = {
      ...previewAdmissions('vi')[0],
      status: 'ACCEPTED',
      decision: 'ACCEPTED' as const,
      decisionLabel: 'SIMULATED' as const,
    };
    mockQuery.value = {
      data: (key: string) => (key === 'content.admissions.mine' ? [application] : []),
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<AdmissionsScreen {...props} />);
    expect(screen.getByText(`${admissionsMessages.vi.decision}: ${admissionsMessages.vi.statusLabels.ACCEPTED} (SIMULATED)`)).toBeOnTheScreen();
  });

  test('admissions detail locks the preview actions and shows the review note', async () => {
    setWidth(360);
    await renderThemed(<AdmissionsScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: new RegExp('2026-Q1-DEMO') }));
    expect(screen.getByText(admissionsMessages.vi.returnedHint)).toBeOnTheScreen();
    expect(screen.getByText(admissionsMessages.vi.simulatedBanner)).toBeOnTheScreen();
    expect(screen.getByText('Bổ sung bảng điểm')).toBeOnTheScreen();
    const submit = screen.getByRole('button', { name: admissionsMessages.vi.resubmit });
    expect(submit.props.accessibilityState?.disabled).toBe(true);
  });

  test('learning lists the preview assignment and opens its detail', async () => {
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    expect(screen.getByRole('header', { name: learningMessages.vi.title })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: learningMessages.vi.assignments }));
    await fireEvent.press(screen.getByRole('button', { name: new RegExp('Bài thực hành 1') }));
    expect(screen.queryByText(contentMessages.vi.previewNotice)).toBeNull();
    expect(screen.queryByRole('button', { name: learningMessages.vi.startDraft })).toBeNull();
  });
});

describe('service screens in live mode', () => {
  test('learning shows a stale section warning while keeping tabs available', async () => {
    mockApi.mode = 'live';
    mockQuery.value = {
      data: (key: string) => key === 'content.learning.sections'
        ? [{ sectionId: 'section-1', courseCode: 'CS101', courseName: 'Introduction' }]
        : [],
      error: null,
      warning: (key: string) => key === 'content.learning.sections' ? 'Showing cached sections.' : null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    expect(screen.getByText('Showing cached sections.')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: learningMessages.vi.assignments })).toBeOnTheScreen();
  });

  test('certificates keep partial curriculum data visible and retry only the failed source', async () => {
    mockApi.mode = 'live';
    mockQuery.value = {
      data: (key: string) => key === 'content.certificates.curriculum' ? {
        curriculum: { id: 'program-1', code: 'CNTT', name: 'Information Technology', nameVi: 'Công nghệ thông tin', nameEn: 'Information Technology', totalCredits: 130 },
        courses: [{ courseId: 'course-1', code: 'CS101', name: 'Intro', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' }],
      } : undefined,
      error: (key: string) => key === 'content.certificates.conduct' ? 'Conduct data is unavailable.' : null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<CertificatesScreen {...props} />);
    expect(screen.getByText('Conduct data is unavailable.')).toBeOnTheScreen();
    expect(screen.getByText('Công nghệ thông tin')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReloads['content.certificates.conduct']).toHaveBeenCalledTimes(1);
    expect(mockReloads['content.certificates.curriculum']).toHaveBeenCalledTimes(0);
  });

  test('certificates with null conduct average shows missing-value copy', async () => {
    mockApi.mode = 'live';
    mockQuery.value = {
      data: (key: string) => key === 'content.certificates.conduct' ? {
        studentCode: '22110001',
        fullName: 'Nguyễn Tiến Sơn',
        cumulativeAverageScore: null,
        cumulativeClassificationVi: null,
        currentSemester: null,
        history: [],
      } : key === 'content.certificates.curriculum' ? {
        curriculum: { id: 'program-1', code: 'CNTT', name: 'Công nghệ thông tin', totalCredits: 130 },
        courses: [{ courseId: 'course-1', code: 'CS101', name: 'Intro', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' }],
      } : undefined,
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<CertificatesScreen {...props} />);
    expect(screen.getByText(recordsMessages.vi.missing)).toBeOnTheScreen();
  });

  test('a failed load shows an error state with retry, never an empty list', async () => {
    mockApi.mode = 'live';
    mockQuery.value = { data: undefined, error: 'Không thể tải dữ liệu', warning: null, isLoading: false };
    setWidth(360);
    await renderThemed(<LibraryScreen {...props} />);
    expect(screen.getAllByText('Không thể tải dữ liệu').length).toBeGreaterThan(0);
    expect(screen.queryByText(libraryMessages.vi.emptyCatalogue)).toBeNull();
    expect(screen.getByText(libraryMessages.vi.simulatedBanner)).toBeOnTheScreen();
  });

  test('a failed admissions read is a retryable error with no simulated banner', async () => {
    mockApi.mode = 'live';
    mockQuery.value = {
      data: (key: string) => (key === 'content.admissions.mine' ? undefined : []),
      error: (key: string) => (key === 'content.admissions.mine' ? 'Không thể tải dữ liệu' : null),
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<AdmissionsScreen {...props} />);
    expect(screen.getAllByText('Không thể tải dữ liệu').length).toBeGreaterThan(0);
    expect(screen.queryByText(admissionsMessages.vi.emptyApplications)).toBeNull();
    expect(screen.queryByText(admissionsMessages.vi.simulatedBanner)).toBeNull();
  });

  test('a live admissions detail shows no simulated banner', async () => {
    mockApi.mode = 'live';
    const application = previewAdmissions('vi')[0];
    mockQuery.value = {
      data: (key: string) => (key === 'content.admissions.mine' ? [application] : []),
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<AdmissionsScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(application.cycle) }));
    expect(screen.getByText(admissionsMessages.vi.returnedHint)).toBeOnTheScreen();
    expect(screen.queryByText(admissionsMessages.vi.simulatedBanner)).toBeNull();
  });

  test('a simulated decision is labelled in the live list and detail', async () => {
    mockApi.mode = 'live';
    const application = { ...previewAdmissions('vi')[0], decisionLabel: 'SIMULATED' as const };
    mockQuery.value = {
      data: (key: string) => (key === 'content.admissions.mine' ? [application] : []),
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<AdmissionsScreen {...props} />);
    expect(screen.getByText(admissionsMessages.vi.simulatedBanner)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: new RegExp(application.cycle) }));
    expect(screen.getByText(admissionsMessages.vi.simulatedBanner)).toBeOnTheScreen();
  });

  test('learning shows its own error state when sections cannot be read', async () => {
    mockApi.mode = 'live';
    mockQuery.value = { data: undefined, error: 'Không thể tải dữ liệu', warning: null, isLoading: false };
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    expect(screen.getByText(learningMessages.vi.errorTitle)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: learningMessages.vi.retry })).toBeOnTheScreen();
    expect(screen.queryByText(contentMessages.vi.previewNotice)).toBeNull();
  });

  test('learning section picker shows the course code and section number', async () => {
    mockApi.mode = 'live';
    mockQuery.value = {
      data: (key: string) => key === 'content.learning.sections'
        ? [{ sectionId: 'section-1', sectionNumber: '01', courseCode: 'CS101', courseName: 'Introduction' }]
        : [],
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    expect(screen.getByRole('tab', { name: /CS101 · 01/ })).toBeOnTheScreen();
  });

  test('learning opens on materials and lists materials before assignments', async () => {
    mockApi.mode = 'live';
    mockQuery.value = {
      data: (key: string) => key === 'content.learning.sections'
        ? [{ sectionId: 'section-1', sectionNumber: '01', courseCode: 'CS101', courseName: 'Introduction' }]
        : [],
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);

    const names = screen.getAllByRole('tab').map((tab) => String(tab.props.accessibilityLabel ?? ''));
    expect(names.indexOf(learningMessages.vi.materials)).toBeLessThan(names.indexOf(learningMessages.vi.assignments));
    expect(screen.getByRole('tab', { name: learningMessages.vi.materials }).props.accessibilityState?.selected).toBe(true);
    expect(screen.getByRole('tab', { name: learningMessages.vi.assignments }).props.accessibilityState?.selected).toBe(false);
  });

  test('learning keeps the assignment lifecycle chip beside the submission chip', async () => {
    mockApi.mode = 'live';
    const assignment = {
      id: 'assignment-1', sectionId: 'section-1', title: 'Lab report', status: 'CLOSED',
      mySubmissionStatus: 'SUBMITTED', version: 1, deadlineAt: '2026-12-01T00:00:00Z',
    };
    mockQuery.value = {
      data: (key: string) => key === 'content.learning.sections'
        ? [{ sectionId: 'section-1', sectionNumber: '01', courseCode: 'CS101', courseName: 'Introduction' }]
        : key.startsWith('content.learning.assignments.') ? [assignment] : [],
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: learningMessages.vi.assignments }));

    expect(screen.getByText(learningMessages.vi.statusLabels.CLOSED)).toBeOnTheScreen();
    expect(screen.getByText(learningMessages.vi.statusLabels.SUBMITTED)).toBeOnTheScreen();
  });

  test('learning shows the assignment description and a muted deadline', async () => {
    mockApi.mode = 'live';
    const assignment = {
      id: 'assignment-1', sectionId: 'section-1', title: 'Lab report', status: 'PUBLISHED',
      mySubmissionStatus: null, version: 1, deadlineAt: '2026-12-01T00:00:00Z',
      description: 'Write the lab report',
    };
    mockQuery.value = {
      data: (key: string) => key === 'content.learning.sections'
        ? [{ sectionId: 'section-1', sectionNumber: '01', courseCode: 'CS101', courseName: 'Introduction' }]
        : key.startsWith('content.learning.assignments.') ? [assignment] : [],
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<LearningScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: learningMessages.vi.assignments }));

    expect(screen.getByText('Write the lab report')).toBeOnTheScreen();
    const deadline = screen.getByText(formatDateTime(assignment.deadlineAt, 'vi'));
    expect(StyleSheet.flatten(deadline.props.style).color).toBe(tokens.colors.textMuted);
  });

  test('an empty live list shows the empty state', async () => {
    mockApi.mode = 'live';
    // The board is a paged first page; the application list is a plain array.
    mockQuery.value = { data: (key: string) => (key.includes('applications') ? [] : { items: [], hasMore: false }), error: null, warning: null, isLoading: false };
    setWidth(360);
    await renderThemed(<CareersScreen {...props} />);
    expect(screen.getByText(careersMessages.vi.emptyBoard)).toBeOnTheScreen();
    expect(screen.getByText(careersMessages.vi.simulatedBanner)).toBeOnTheScreen();
  });

  test('a career posting announces its employment type, salary, status and application', async () => {
    mockApi.mode = 'live';
    const opportunity = {
      id: 'opp-1',
      title: 'Backend Developer',
      organizationName: 'Công ty A',
      location: 'TP. Hồ Chí Minh',
      employmentType: 'INTERNSHIP',
      salaryText: '15.000.000 ₫',
      status: 'PUBLISHED',
    };
    mockQuery.value = {
      data: (key: string) => key.startsWith('content.careers.board.')
        ? { items: [opportunity], hasMore: false }
        : key === 'content.careers.applications'
          ? [{ id: 'app-1', opportunityId: opportunity.id, status: 'SUBMITTED', version: 1 }]
          : [],
      error: null,
      warning: null,
      isLoading: false,
    };
    await renderThemed(<CareersScreen {...props} />);

    expect(screen.getByText(careersMessages.vi.simulatedBanner)).toBeOnTheScreen();
    expect(screen.getByText(careersMessages.vi.opportunityStatusLabels.PUBLISHED)).toBeOnTheScreen();
    const row = screen.getAllByRole('button').find((button) =>
      typeof button.props.accessibilityLabel === 'string' && button.props.accessibilityLabel.startsWith(`${opportunity.title} ·`),
    );
    expect(row).toBeDefined();
    const label = String(row?.props.accessibilityLabel ?? '');
    const missing = [
      careersMessages.vi.employmentTypeLabels.INTERNSHIP,
      opportunity.salaryText,
      careersMessages.vi.opportunityStatusLabels.PUBLISHED,
      careersMessages.vi.appliedBadge,
    ].filter((value) => !label.includes(value));
    expect(missing).toEqual([]);
  });

  test('a submitted career application uses the web amber role', async () => {
    mockApi.mode = 'live';
    const application = {
      id: 'app-1', opportunityId: 'opp-1', opportunityTitle: 'Thực tập sinh Backend',
      organizationName: 'Công ty A', status: 'SUBMITTED', version: 1,
      submittedAt: '2026-10-01T00:00:00Z', attachments: [],
    };
    mockQuery.value = {
      data: (key: string) => key.startsWith('content.careers.board.')
        ? { items: [], hasMore: false }
        : key === 'content.careers.applications' ? [application] : [],
      error: null,
      warning: null,
      isLoading: false,
    };
    setWidth(360);
    await renderThemed(<CareersScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: careersMessages.vi.myApplications }));

    const pill = screen.getByText(careersMessages.vi.statusLabels.SUBMITTED).parent;
    expect(pill).toHaveStyle({ backgroundColor: tokens.colors.warningFixed });
  });
});
