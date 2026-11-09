import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { RefreshControl, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactElement } from 'react';

import { apiClient, ApiClientError } from '../../src/api/client';
import * as registrationBrowse from '../../src/screens/academic/registration-browse';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { setFileAdapter } from '../../src/files/file-adapter';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { academicMessages } from '../../src/i18n/academic-messages';
import { auditTree } from '../a11y/audit';
import { shareTimetable } from '../../src/screens/academic/academic-api';
import { SlipRow } from '../../src/screens/academic/SlipRow';

type QueryState = { data?: unknown; error?: string | null; errorInput?: unknown; warning?: string | null; errorStatus?: number | null; isLoading?: boolean; isStale?: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const mockQueries: Record<string, QueryState> = {};
const mockReload = jest.fn(async () => {});
const mockPost = jest.fn<(path: string, body?: unknown, init?: { headers?: Record<string, string> }) => Promise<unknown>>();
let mockConnected = true;
let mockKeyCounter = 0;

jest.mock('../../src/api/client', () => ({
  apiClient: {
    mode: 'live',
    get: jest.fn(async () => []),
    post: (...args: unknown[]) => (mockPost as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
    download: jest.fn(),
  },
  campusApi: {
    enrollments: jest.fn(async () => []),
    grades: jest.fn(async () => []),
    transcript: jest.fn(async () => ({})),
    attendanceSummary: jest.fn(async () => []),
    registrationRounds: jest.fn(async () => []),
    registrationSections: jest.fn(async () => []),
  },
  createAssistantClientRequestId: () => `key-${++mockKeyCounter}`,
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
  useScreenQuery: (key: string, _request: () => Promise<unknown>, options?: { mapError?: (error: unknown) => string }) => {
    const match = Object.keys(mockQueries).find((name) => key === name || key.startsWith(`${name}.`));
    const state = (match ? mockQueries[match] : {}) as QueryState;
    return {
      data: state.data,
      error: state.errorInput === undefined ? state.error ?? null : options?.mapError?.(state.errorInput) ?? state.error ?? null,
      warning: state.warning ?? null,
      errorStatus: state.errorStatus ?? null,
      isLoading: state.isLoading ?? false,
      isStale: state.isStale ?? false,
      reload: mockReload,
      setData: jest.fn(),
    };
  },
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: mockConnected }),
}));

import { CoursesScreen } from '../../src/screens/student/CoursesScreen';
import { GradesScreen } from '../../src/screens/student/GradesScreen';
import { RegistrationScreen } from '../../src/screens/student/RegistrationScreen';
import { ScheduleScreen } from '../../src/screens/student/ScheduleScreen';
import { AttendanceScreen, overallRate } from '../../src/screens/student/AttendanceScreen';
import { TranscriptScreen } from '../../src/screens/academic/TranscriptScreen';
import { parseTranscript } from '../../src/screens/academic/gpa';
import { CurriculumScreen } from '../../src/screens/academic/CurriculumScreen';
import { EnrollmentsScreen } from '../../src/screens/academic/EnrollmentsScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigate = jest.fn();
const props = { navigation: { navigate }, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;

function wrap(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

type RenderTree = { props?: Record<string, unknown>; children?: unknown[] } | null;

function refreshControlOf(tree: unknown): { props: { refreshing: boolean; onRefresh: () => void } } | null {
  if (!tree || typeof tree !== 'object') return null;
  const node = tree as RenderTree;
  const control = node?.props?.refreshControl as { props?: { refreshing?: unknown; onRefresh?: unknown } } | undefined;
  if (control?.props && typeof control.props.onRefresh === 'function' && typeof control.props.refreshing === 'boolean') {
    return control as { props: { refreshing: boolean; onRefresh: () => void } };
  }
  for (const child of node?.children ?? []) {
    const found = refreshControlOf(child);
    if (found) return found;
  }
  return null;
}

function pullControl(): { refreshing: boolean; onRefresh: () => void } {
  const found = refreshControlOf(screen.toJSON());
  if (!found) throw new Error('refresh control not found');
  return found.props;
}

async function pressTwiceBeforeCommit(button: unknown) {
  const originalError = console.error;
  const warning = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('overlapping act() calls')) return;
    originalError(message, ...args);
  });
  try {
    await act(async () => {
      fireEvent.press(button as never);
      fireEvent.press(button as never);
    });
  } finally {
    warning.mockRestore();
  }
}

const course = (code: string, name: string) => ({ code, name, nameVi: name, nameEn: name, credits: 3 });
const enrollments = [
  { id: 'e1', sectionId: 's1', semesterId: 't2', status: 'ENROLLED', section: { sectionNumber: '01', course: course('CS101', 'Nhập môn lập trình'), schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:00' }] } },
  { id: 'e2', sectionId: 's2', semesterId: 't1', status: 'COMPLETED', gradeStatus: 'PUBLISHED', finalGrade: 8.2, letterGrade: 'B+', section: { sectionNumber: '01', course: course('MA101', 'Giải tích') } },
  { id: 'e3', sectionId: 's3', semesterId: 't2', status: 'DROPPED', section: { sectionNumber: '02', course: course('PH101', 'Vật lý') } },
];
const semesters = [
  { id: 't1', name: 'HK1', startDate: '2026-01-05', endDate: '2026-05-30' },
  { id: 't2', name: 'HK2', startDate: '2026-09-01', endDate: '2026-12-31', status: 'IN_PROGRESS' },
];

const section = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, sectionNumber: '01', courseId: `c-${id}`, courseCode: `CS${id}`, courseName: `Môn ${id}`, credits: 3,
  capacity: 40, enrolledCount: 10, remainingSeats: 30, status: 'OPEN', scheduleConflict: false, alreadyEnrolled: false, ...overrides,
});
const registrationData = (sections: unknown[], roundOpen = true) => ({ sections, enrollments: [], roundOpen, eligibility: { eligible: true, creditLimit: 20, creditsUsed: 3, creditsRemaining: 17 }, closedReason: null });

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  Object.defineProperty(apiClient, 'mode', { configurable: true, value: 'live' });
  mockConnected = true;
  mockPost.mockReset();
  mockReload.mockClear();
  navigate.mockClear();
});
afterEach(() => { jest.restoreAllMocks(); });

describe('transcript', () => {
  const transcript = {
    summary: { cumulativeGpa: 3.42, totalCreditsEarned: 14, totalCreditsAttempted: 16 },
    semesters: [
      { semesterId: 't1', semesterName: 'HK1', gpa: 3.4, creditsEarned: 14, creditsAttempted: 16, records: [{ id: 'r1', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'PUBLISHED' }] },
    ],
  };

  test('shows the cumulative GPA, the web KPI set, the term record and the grade scale', async () => {
    mockQueries['academic.transcript'] = { data: transcript };
    mockQueries['academic.curriculum'] = {
      data: {
        curriculum: { id: 'c', code: 'SE2026', name: 'Kỹ thuật phần mềm', totalCredits: 120 },
        courses: [
          { courseId: 'a', code: 'MA101', name: 'Giải tích', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' },
          { courseId: 'b', code: 'CS101', name: 'Nhập môn', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' },
          { courseId: 'c', code: 'CS102', name: 'Cấu trúc dữ liệu', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' },
          { courseId: 'd', code: 'CS103', name: 'Hệ điều hành', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'IN_PROGRESS' },
          { courseId: 'e', code: 'CS104', name: 'Mạng máy tính', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'IN_PROGRESS' },
        ],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getByRole('header', { name: 'Bảng điểm' })).toBeOnTheScreen();
    expect(screen.getAllByText('3,42').length).toBeGreaterThan(0);
    expect(screen.getByText('GPA hệ 4 tích lũy toàn khóa')).toBeOnTheScreen();
    expect(screen.getByText('Tín chỉ đã đạt')).toBeOnTheScreen();
    expect(screen.getByText('14 / 120')).toBeOnTheScreen();
    expect(screen.getByText('Môn đã hoàn tất')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.getByText('Môn đang học')).toBeOnTheScreen();
    expect(screen.getByText('2')).toBeOnTheScreen();
    expect(screen.getByText('MA101')).toBeOnTheScreen();
    expect(screen.getByLabelText('A+, 9,0 - 10,0, 4,0')).toBeOnTheScreen();
    expect(screen.getByText('F (<4.0): chưa tích lũy, phải học lại.')).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('follows the English locale', async () => {
    mockQueries['academic.transcript'] = { data: transcript };
    await render(wrap(<TranscriptScreen {...props} />, 'en'));
    expect(screen.getByRole('header', { name: 'Transcript' })).toBeOnTheScreen();
    expect(screen.getAllByText('3.42').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('A+, 9.0 - 10.0, 4.0')).toBeOnTheScreen();
    expect(screen.getByText('F (<4.0): not earned — the course must be retaken.')).toBeOnTheScreen();
  });

  test('an API error is an error state, never data', async () => {
    mockQueries['academic.transcript'] = { error: 'Không có kết nối.', errorStatus: 0 };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getByText('Không có kết nối.')).toBeOnTheScreen();
    expect(screen.queryByText('3,42')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  test('accessible transcript rows announce credits and appealed grade status', async () => {
    mockQueries['academic.transcript'] = {
      data: {
        summary: { cumulativeGpa: 3.42, totalCreditsEarned: 3, totalCreditsAttempted: 3 },
        semesters: [{
          semesterId: 't1', semesterName: 'HK1', gpa: 3.42, creditsEarned: 3, creditsAttempted: 3,
          records: [{ id: 'r1', courseCode: 'CS101', courseName: 'Nhập môn lập trình', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'APPEALED' }],
        }],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));

    const row = screen.getByLabelText(/CS101 Nhập môn lập trình/);
    const label = row.props.accessibilityLabel as string;
    expect(label).toContain('3 tín chỉ');
    expect(label).toContain('Đang phúc khảo');
  });

  test('shows a failing transcript grade with the error tone', async () => {
    mockQueries['academic.transcript'] = {
      data: {
        summary: { cumulativeGpa: 0, totalCreditsEarned: 0, totalCreditsAttempted: 3 },
        semesters: [{
          semesterId: 't1', semesterName: 'HK1', gpa: 0, creditsEarned: 0, creditsAttempted: 3,
          records: [{ id: 'r1', courseCode: 'CS101', courseName: 'Nhập môn lập trình', credits: 3, finalGrade: 3, letterGrade: 'F', gradeStatus: 'PUBLISHED' }],
        }],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));

    const pillColors = screen.getAllByText('F').map((pill) =>
      StyleSheet.flatten(pill.parent?.props.style as StyleProp<ViewStyle>)?.backgroundColor,
    );
    expect(pillColors).toContain(tokens.colors.errorFixed);
  });

  test('shows a published non-numeric transcript grade as its letter', async () => {
    mockQueries['academic.transcript'] = {
      data: {
        summary: { cumulativeGpa: null, totalCreditsEarned: 3, totalCreditsAttempted: 3 },
        semesters: [{
          semesterId: 't1', semesterName: 'HK1', gpa: null, creditsEarned: 3, creditsAttempted: 3,
          records: [{ id: 'r1', courseCode: 'CS101', courseName: 'Nhập môn lập trình', credits: 3, finalGrade: null, letterGrade: 'P', gradeStatus: 'PUBLISHED' }],
        }],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));

    expect(screen.getAllByText('P').length).toBeGreaterThan(0);
    expect(screen.queryByText('Đã công bố')).toBeNull();
  });

  test('an explicit null transcript GPA stays null and renders the unavailable marker', async () => {
    const payload = {
      summary: { cumulativeGpa: null, totalCreditsEarned: 2, totalCreditsAttempted: 2 },
      semesters: [{
        semesterId: 't1', semesterName: 'HK1', gpa: null, creditsEarned: 2, creditsAttempted: 2,
        records: [{ id: 'r1', courseCode: 'PE101', courseName: 'Giáo dục thể chất', credits: 2, finalGrade: 8, letterGrade: null, gradeStatus: 'PUBLISHED', enrollmentStatus: 'COMPLETED' }],
      }],
    };

    const parsed = parseTranscript(payload, 'vi');
    expect(parsed?.cumulativeGpa).toBeNull();
    expect(parsed?.terms[0].gpa).toBeNull();

    mockQueries['academic.transcript'] = { data: payload };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('3,50')).toBeNull();
    expect(screen.queryByText('0,00')).toBeNull();
    expect(screen.getAllByText('Chưa có số liệu').length).toBeGreaterThan(0);
  });

  test('a payload that is not a transcript is not rendered', async () => {
    mockQueries['academic.transcript'] = { data: { unexpected: true } };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getByText('Có lỗi xảy ra. Vui lòng thử lại.')).toBeOnTheScreen();
  });

  test('renders appealed grades with score and appeal status on transcript', async () => {
    mockQueries['academic.transcript'] = {
      data: {
        ...transcript,
        semesters: [
          {
            semesterId: 't1',
            semesterName: 'HK1',
            gpa: 3.5,
            creditsEarned: 3,
            creditsAttempted: 3,
            records: [
              { id: 'r1', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 8.5, letterGrade: 'A', gradeStatus: 'APPEALED' },
            ],
          },
        ],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getByText('8,5')).toBeOnTheScreen();
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.getByText('Đang phúc khảo')).toBeOnTheScreen();
  });

  test('letter chips use the web tone bands for B and D grades', async () => {
    mockQueries['academic.transcript'] = {
      data: {
        summary: { cumulativeGpa: 2.5, totalCreditsEarned: 6, totalCreditsAttempted: 6 },
        semesters: [{
          semesterId: 't1', semesterName: 'HK1', gpa: 2.5, creditsEarned: 6, creditsAttempted: 6,
          records: [
            { id: 'r1', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 7.5, letterGrade: 'B', gradeStatus: 'PUBLISHED' },
            { id: 'r2', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 4.5, letterGrade: 'D', gradeStatus: 'PUBLISHED' },
          ],
        }],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));

    const toneOf = (letter: string) => screen.getAllByText(letter).map((pill) =>
      StyleSheet.flatten(pill.parent?.props.style as StyleProp<ViewStyle>)?.backgroundColor,
    );
    expect(toneOf('B')).toContain(tokens.colors.primaryFixed);
    expect(toneOf('B')).not.toContain(tokens.colors.successFixed);
    expect(toneOf('D')).toContain(tokens.colors.warningFixed);
    expect(toneOf('D')).not.toContain(tokens.colors.errorFixed);
  });

  test('shows the term count line, the detail hint and the grade distribution', async () => {
    mockQueries['academic.transcript'] = {
      data: {
        summary: { cumulativeGpa: 3.42, totalCreditsEarned: 6, totalCreditsAttempted: 6 },
        semesters: [{
          semesterId: 't1', semesterName: 'HK1', gpa: 3.42, creditsEarned: 6, creditsAttempted: 6,
          records: [
            { id: 'r1', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 9, letterGrade: 'A', gradeStatus: 'PUBLISHED' },
            { id: 'r2', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 7.5, letterGrade: 'B+', gradeStatus: 'PUBLISHED' },
          ],
        }],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));

    expect(screen.getByText('2 môn - 6 tín chỉ đã đăng ký - GPA 3,42')).toBeOnTheScreen();
    expect(screen.getByText('Chi tiết GK/CK')).toBeOnTheScreen();
    expect(screen.getByText('Phân bố xếp loại')).toBeOnTheScreen();
    expect(screen.getByLabelText('Phân bố xếp loại: A 1, B+ 1')).toBeOnTheScreen();
  });

  test('opens the summary breakdown from a transcript row', async () => {
    mockQueries['academic.transcript'] = {
      data: {
        summary: { cumulativeGpa: 3.42, totalCreditsEarned: 3, totalCreditsAttempted: 3 },
        semesters: [{
          semesterId: 't1', semesterName: 'HK1', gpa: 3.42, creditsEarned: 3, creditsAttempted: 3,
          records: [{ id: 'r1', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, processScore: 7.4, finalExamScore: 8.6, finalGrade: 8, letterGrade: 'B', gradeStatus: 'PUBLISHED' }],
        }],
      },
    };
    await render(wrap(<TranscriptScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: /Mở chi tiết điểm cho CS101 Nhập môn/ }));
    expect(await screen.findByText('Điểm quá trình (ĐQT - 50%)')).toBeOnTheScreen();
    expect(screen.getByText('Điểm cuối kỳ (ĐCK - 50%)')).toBeOnTheScreen();
    expect(screen.getByText('7,4 / 10')).toBeOnTheScreen();
    expect(screen.getByText('8,6 / 10')).toBeOnTheScreen();
  });
});

describe('enrollments and courses', () => {
  test('history is not limited to ENROLLED and opens a detail with the slip unavailable', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<EnrollmentsScreen {...props} />));
    expect(screen.getByText('Nhập môn lập trình')).toBeOnTheScreen();
    expect(screen.queryByText('Giải tích')).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: 'Đã học (1)' }));
    expect(screen.getByText('Giải tích')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Đã rút (1)' }));
    expect(screen.getByText('Vật lý')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'Đã học (1)' }));
    await fireEvent.press(screen.getByRole('button', { name: /MA101 Giải tích/ }));
    expect(screen.getByText('8,2 · B+')).toBeOnTheScreen();
    expect(screen.getByText('Chưa thể tải xuống trên thiết bị này')).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByRole('tab', { name: 'Đã học (1)' })).toBeOnTheScreen();
  });

  const unknownEnrollment = { ...enrollments[0], status: 'WAITLISTED' };
  const renderUnknownStatus = async (locale: 'vi' | 'en', tabName: string, fallback: string) => {
    mockQueries['academic.enrollments'] = { data: [unknownEnrollment] };
    mockQueries['academic.semesters'] = { data: semesters };
    const view = await render(wrap(<EnrollmentsScreen {...props} />, locale));
    await act(async () => { await fireEvent.press(screen.getByRole('tab', { name: tabName })); });
    expect(screen.getByText(fallback)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /CS101/ }));
    expect(screen.getByText(fallback)).toBeOnTheScreen();
    expect(screen.queryByText('WAITLISTED')).toBeNull();
    await view.unmount();
  };

  test('unknown enrollment statuses use Vietnamese copy in the list and detail', async () => {
    await renderUnknownStatus('vi', 'Đã học (1)', 'Trạng thái chưa xác định');
  });

  test('unknown enrollment statuses use English copy in the list and detail', async () => {
    await renderUnknownStatus('en', 'Past (1)', 'Unknown status');
  });

  test('formats fractional enrollment credits in the active locale', async () => {
    const fractional = {
      ...enrollments[0],
      section: { ...enrollments[0].section, course: { ...course('CS101', 'Nhập môn lập trình'), credits: 3.5 } },
    };
    mockQueries['academic.enrollments'] = { data: [fractional] };
    mockQueries['academic.semesters'] = { data: semesters };
    const view = await render(wrap(<EnrollmentsScreen {...props} />));
    await fireEvent.press(screen.getByRole('button', { name: /CS101/ }));
    expect(screen.getByText('3,5')).toBeOnTheScreen();
    await view.unmount();
  });

  test('accessible enrollment rows announce credits and section number', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<EnrollmentsScreen {...props} />));

    const row = screen.getByRole('button', { name: /CS101 Nhập môn lập trình/ });
    const label = row.props.accessibilityLabel as string;
    expect(label).toContain('3 tín chỉ');
    expect(label).toContain(`${academicMessages.vi.sectionLabel}: 01`);
  });

  test('preview enrollment names follow the active locale', async () => {
    Object.defineProperty(apiClient, 'mode', { configurable: true, value: 'preview' });
    for (const [locale, name] of [
      ['vi', 'Kiến trúc phần mềm'],
      ['en', 'Software Architecture'],
    ] as const) {
      const view = await render(wrap(<EnrollmentsScreen {...props} />, locale));
      expect(screen.getByText(name)).toBeOnTheScreen();
      await view.unmount();
    }
  });

  test('courses is the same workspace, in English on request', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    await render(wrap(<CoursesScreen {...props} />, 'en'));
    expect(screen.getByRole('header', { name: 'Courses' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Active (1)' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Course registration' }));
    expect(navigate).toHaveBeenCalledWith('registration');
  });

  test('an API error shows the error state instead of any course', async () => {
    mockQueries['academic.enrollments'] = { error: 'Bạn không có quyền xem nội dung này.', errorStatus: 403 };
    await render(wrap(<CoursesScreen {...props} />));
    expect(screen.getByText('Bạn không có quyền xem nội dung này.')).toBeOnTheScreen();
    expect(screen.queryByText('Nhập môn lập trình')).toBeNull();
  });

  test('a widget-level 401 stays a retryable error instead of session-expiry copy', async () => {
    mockQueries['academic.enrollments'] = {
      errorInput: new ApiClientError('unauthorized', 401, 'req-w15', 'HTTP_401'),
      errorStatus: 401,
    };
    await render(wrap(<CoursesScreen {...props} />));
    expect(screen.getByText(academicMessages.vi.generic)).toBeOnTheScreen();
    expect(screen.queryByText(academicMessages.vi.signIn)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: academicMessages.vi.retry }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});

describe('grades', () => {
  test('pull to refresh shows its spinner only while the user pull is pending', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters, isStale: true };
    let release: () => void = () => {};
    mockReload.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    await render(wrap(<CoursesScreen {...props} />));
    const list = screen.getByTestId('course-grid');
    const refreshControl = list.props.refreshControl as ReactElement<{ refreshing: boolean; onRefresh: () => void }>;
    expect(refreshControl.type).toBe(RefreshControl);
    expect(pullControl().refreshing).toBe(false);
    await act(async () => { pullControl().onRefresh(); });
    expect(pullControl().refreshing).toBe(true);
    expect(mockReload).toHaveBeenCalledTimes(2);
    await act(async () => { release(); });
    expect(pullControl().refreshing).toBe(false);
  });

  test('a stale revalidation does not show the pull spinner on grades', async () => {
    mockQueries['academic.grades'] = {
      data: [{ id: 'g1', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' }],
      isStale: true,
    };
    await render(wrap(<GradesScreen {...props} />));
    expect(pullControl().refreshing).toBe(false);
  });

  test('a retaken course counts once in the GPA and completed-credit cards', async () => {
    mockQueries['academic.grades'] = {
      data: [
        { id: 'g1', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 2.5, letterGrade: 'F', gradeStatus: 'PUBLISHED', enrollmentStatus: 'COMPLETED', semesterId: 't1', semester: 'HK1' },
        { id: 'g2', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 9, letterGrade: 'A', gradeStatus: 'PUBLISHED', enrollmentStatus: 'COMPLETED', semesterId: 't2', semester: 'HK2' },
      ],
    };
    await render(wrap(<GradesScreen {...props} />));
    expect(screen.getAllByText('4,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Tín chỉ hoàn tất')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.getByText('2/2')).toBeOnTheScreen();
    expect(screen.queryByText('6,00')).toBeNull();
  });

  test('labels preview grades with the localized semester name', async () => {
    Object.defineProperty(apiClient, 'mode', { configurable: true, value: 'preview' });
    await render(wrap(<GradesScreen {...props} />));
    expect(screen.getAllByText('Học kỳ 1 - 2026/2027').length).toBeGreaterThan(0);
    expect(screen.queryByText('preview-term')).toBeNull();
  });

  test('uses the English preview semester name in English', async () => {
    Object.defineProperty(apiClient, 'mode', { configurable: true, value: 'preview' });
    await render(wrap(<GradesScreen {...props} />, 'en'));
    expect(screen.getAllByText('Semester 1 - 2026/2027').length).toBeGreaterThan(0);
    expect(screen.queryByText('preview-term')).toBeNull();
  });

  test('lists published grades only and keeps the scale on the transcript', async () => {
    mockQueries['academic.grades'] = {
      data: [
        { id: 'g1', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' },
        { id: 'g2', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 9.5, letterGrade: 'A+', gradeStatus: 'DRAFT', semesterId: 't2', semester: 'HK2' },
      ],
    };
    await render(wrap(<GradesScreen {...props} />));
    expect(screen.getByText('MA101')).toBeOnTheScreen();
    expect(screen.queryByText('CS101')).toBeNull();
    expect(screen.queryByText('Thang điểm')).toBeNull();
    expect(screen.queryByLabelText('B, 7,0 - 7,9, 3,0')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Mở bảng điểm' }));
    expect(navigate).toHaveBeenCalledWith('transcript');
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('shows the component summary and the per-term count line without the extra scale card', async () => {
    mockQueries['academic.grades'] = {
      data: [
        { id: 'g1', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' },
        { id: 'g2', courseCode: 'PH101', courseName: 'Vật lý', credits: 2, finalGrade: 7, letterGrade: 'B', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' },
      ],
    };
    await render(wrap(<GradesScreen {...props} />));
    expect(screen.getByText('Điểm thành phần theo từng môn')).toBeOnTheScreen();
    expect(screen.getByText('2 môn - 5 tín chỉ')).toBeOnTheScreen();
    expect(screen.queryByText('Thang điểm')).toBeNull();
  });

  test('explains the empty grades state and opens the transcript from it', async () => {
    mockQueries['academic.grades'] = { data: [] };
    await render(wrap(<GradesScreen {...props} />));
    expect(screen.getByText('Chưa có điểm được công bố')).toBeOnTheScreen();
    expect(screen.getByText('Khi môn học được chấm và công bố, kết quả sẽ xuất hiện tại đây.')).toBeOnTheScreen();
    const open = screen.getAllByRole('button', { name: 'Mở bảng điểm' });
    expect(open).toHaveLength(1);
    await fireEvent.press(open[0]);
    expect(navigate).toHaveBeenCalledWith('transcript');
  });

  test('offers catalogue terms that have no published grades in the semester filter', async () => {
    mockQueries['academic.grades'] = {
      data: [{ id: 'g1', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' }],
    };
    mockQueries['academic.semesters'] = {
      data: [{ id: 't9', name: 'HK9', nameVi: 'Học kỳ 9', nameEn: 'Semester 9' }],
    };
    await render(wrap(<GradesScreen {...props} />));
    await fireEvent.press(screen.getByRole('button', { name: 'Học kỳ: Tất cả học kỳ' }));
    expect(screen.getByRole('radio', { name: 'Học kỳ 9' })).toBeOnTheScreen();
  });

  test('opens the grade breakdown sheet from a row', async () => {
    mockQueries['academic.grades'] = {
      data: [{ id: 'g1', courseCode: 'CS101', courseName: 'Nhập môn lập trình', credits: 3, processScore: 7.2, finalExamScore: 8.6, finalGrade: 8.1, letterGrade: 'B', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1', sectionCode: '01' }],
    };
    await render(wrap(<GradesScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: /Mở chi tiết điểm cho CS101 Nhập môn lập trình/ }));
    expect(screen.getByRole('header', { name: 'Chi tiết điểm học phần' })).toBeOnTheScreen();
    expect(screen.getByText('ĐHP = ĐQT × 50% + ĐCK × 50%')).toBeOnTheScreen();
    expect(screen.getByText('Điểm quá trình (ĐQT - 50%)')).toBeOnTheScreen();
    expect(screen.getByText('Điểm cuối kỳ (ĐCK - 50%)')).toBeOnTheScreen();
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText('7,2 / 10')).toBeOnTheScreen();
    expect(screen.getByText('8,6 / 10')).toBeOnTheScreen();
    expect(screen.getByText('Điểm tổng kết (10)')).toBeOnTheScreen();
    expect(screen.getAllByText('8,1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Quy đổi (4.0)')).toBeOnTheScreen();
    expect(screen.getByText('3,0')).toBeOnTheScreen();
    expect(apiClient.get).toHaveBeenCalledWith('/grades/student-grades/enrollment/g1');
  });

  test('renders component rows from the enrollment breakdown API', async () => {
    mockQueries['academic.grades'] = {
      data: [{ id: 'g1', courseCode: 'CS101', courseName: 'Nhập môn lập trình', credits: 3, finalGrade: 8.1, letterGrade: 'B', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' }],
    };
    jest.mocked(apiClient.get).mockResolvedValueOnce({
      grades: [
        { id: 'l1', gradeItemName: 'Kiểm tra giữa kỳ', gradeItemType: 'QUIZ', score: 8.25, maxScore: 10, weight: 0.4 },
        { id: 'l2', gradeItemName: 'Thi cuối kỳ', gradeItemType: 'FINAL', score: 7, maxScore: 10, weight: 60 },
      ],
    });
    await render(wrap(<GradesScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: /Mở chi tiết điểm cho CS101 Nhập môn lập trình/ }));
    expect(await screen.findByText('Kiểm tra giữa kỳ')).toBeOnTheScreen();
    expect(screen.getByText('40%')).toBeOnTheScreen();
    expect(screen.getByText('8,3 / 10')).toBeOnTheScreen();
    expect(screen.getByText('Điểm cuối kỳ (ĐCK - 50%)')).toBeOnTheScreen();
    expect(screen.getByText('60%')).toBeOnTheScreen();
    expect(screen.getByText('7,0 / 10')).toBeOnTheScreen();
  });

  test('letter chips use the web tone bands for B and D grades', async () => {
    mockQueries['academic.grades'] = {
      data: [
        { id: 'g1', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 7.5, letterGrade: 'B', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' },
        { id: 'g2', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 4.5, letterGrade: 'D', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' },
      ],
    };
    await render(wrap(<GradesScreen {...props} />));

    const toneOf = (letter: string) => screen.getAllByText(letter).map((pill) =>
      StyleSheet.flatten(pill.parent?.props.style as StyleProp<ViewStyle>)?.backgroundColor,
    );
    expect(toneOf('B')).toContain(tokens.colors.primaryFixed);
    expect(toneOf('B')).not.toContain(tokens.colors.successFixed);
    expect(toneOf('D')).toContain(tokens.colors.warningFixed);
    expect(toneOf('D')).not.toContain(tokens.colors.errorFixed);
  });

  test('includes appealed grades in the grades list and GPA summary', async () => {
    mockQueries['academic.grades'] = {
      data: [
        { id: 'g1', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 2.0, letterGrade: 'F', gradeStatus: 'APPEALED', semesterId: 't1', semester: 'HK1' },
        { id: 'g2', courseCode: 'CS102', courseName: 'Cấu trúc dữ liệu', credits: 3, finalGrade: 9.0, letterGrade: 'A', gradeStatus: 'APPEALED', semesterId: 't1', semester: 'HK1' },
      ],
    };
    await render(wrap(<GradesScreen {...props} />));
    expect(screen.getByText('CS101')).toBeOnTheScreen();
    expect(screen.getByText('CS102')).toBeOnTheScreen();
    expect(screen.getAllByText('Đang phúc khảo').length).toBe(2);
    expect(screen.getAllByText('2,00').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/CS101 Nhập môn/).props.accessibilityLabel).toContain('Đang phúc khảo');
  });

  test('accessible grade rows announce credits and both displayed component scores', async () => {
    mockQueries['academic.grades'] = {
      data: [{ id: 'g1', courseCode: 'CS101', courseName: 'Nhập môn lập trình', credits: 3, processScore: 7.2, finalExamScore: 8.6, finalGrade: 8.1, letterGrade: 'B', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' }],
    };
    await render(wrap(<GradesScreen {...props} />));

    const row = screen.getByLabelText(/CS101 Nhập môn lập trình/);
    const label = row.props.accessibilityLabel as string;
    expect(label).toContain('3 tín chỉ');
    expect(label).toContain('7,2');
    expect(label).toContain('8,6');
  });
});

describe('schedule and attendance', () => {
  test('same-frame repeated registration slip downloads start once', async () => {
    const pending = deferred<Awaited<ReturnType<typeof apiClient.download>>>();
    const download = jest.mocked(apiClient.download);
    setFileAdapter({
      capability: () => ({ available: true }),
      pick: async () => ({ status: 'cancelled' }),
      share: async () => ({ status: 'cancelled' }),
      save: async () => ({ status: 'done' }),
    });
    download.mockReturnValue(pending.promise);
    await render(wrap(<SlipRow semesterId="semester-1" />));

    try {
      const button = screen.getByRole('button', { name: /Tải phiếu/ });
      await act(async () => {
        fireEvent.press(button);
        fireEvent.press(button);
      });
      expect(download).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        pending.resolve({ data: new Uint8Array([1]).buffer, contentType: 'application/pdf', fileName: null, headers: new Headers(), requestId: 'test' });
        await pending.promise;
      });
      download.mockReset();
      setFileAdapter();
    }
  });

  test('the overall present rate counts only present sessions', () => {
    const rows = [{ sectionId: 's1', courseCode: 'CS101', courseName: 'Nhập môn', total: 4, present: 1, absent: 1, late: 1, excused: 1, attendanceRate: 25 }];
    expect(overallRate(rows)).toBe(25);
  });

  test('attendance cards show the API present rate and count only present sessions', async () => {
    mockQueries['academic.attendance.summary'] = { data: [{ sectionId: 's1', courseCode: 'CS101', courseName: 'Nhập môn', total: 4, present: 1, absent: 1, late: 1, excused: 1, attendanceRate: 25 }] };
    mockQueries['academic.attendance.records'] = { data: [] };
    await render(wrap(<AttendanceScreen {...props} />));
    expect(screen.getByText('1/4 buổi đã tham dự', { exact: false })).toBeOnTheScreen();
    expect(screen.getAllByText('25%').length).toBeGreaterThan(0);
  });

  test('timetable share turns an adapter rejection into a failed outcome', async () => {
    setFileAdapter({
      capability: () => ({ available: true }),
      pick: async () => ({ status: 'cancelled' }),
      share: async () => { throw Object.assign(new Error('native failure'), { code: 'SHARE_FAILED' }); },
      save: async () => ({ status: 'cancelled' }),
    });
    try {
      await expect(shareTimetable('data:text/calendar,', 'campusute-timetable.ics'))
        .resolves.toEqual({ status: 'failed', reason: 'SHARE_FAILED' });
    } finally {
      setFileAdapter();
    }
  });

  test('renders seven accessible week day buttons with one selected day', async () => {
    await render(wrap(<ScheduleScreen {...props} />));
    const dayCells = screen.getAllByTestId(/^day-/);

    expect(dayCells).toHaveLength(7);
    expect(dayCells.every((cell) => cell.props.accessibilityRole === 'button')).toBe(true);
    expect(dayCells.every((cell) => Boolean(cell.props.accessibilityLabel))).toBe(true);
    expect(dayCells.filter((cell) => cell.props.accessibilityState?.selected)).toHaveLength(1);
  });

  test('week day button conveys today in its accessible label', async () => {
    await render(wrap(<ScheduleScreen {...props} />));
    const dayCells = screen.getAllByTestId(/^day-/);
    const todayCells = dayCells.filter((cell) =>
      typeof cell.props.accessibilityLabel === 'string' &&
      (cell.props.accessibilityLabel.includes('hôm nay') || cell.props.accessibilityLabel.includes('today'))
    );
    expect(todayCells).toHaveLength(1);
  });

  test('shows enrollment sessions with a semesters query error', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { error: 'Không thể tải danh sách học kỳ', errorStatus: 503 };
    await render(wrap(<ScheduleScreen {...props} />));
    expect(screen.getByText('Không thể tải danh sách học kỳ')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Học kỳ' }));
    expect(screen.getByRole('button', { name: /CS101 Nhập môn lập trình/ })).toBeOnTheScreen();
  });

  test('requests one timetable share when Export is pressed twice before the busy state commits', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    let release!: (value: { status: 'done' }) => void;
    const pending = new Promise<{ status: 'done' }>((resolve) => { release = resolve; });
    const share = jest.fn(() => pending);
    let released = false;
    const finishShare = async () => {
      if (!released) {
        released = true;
        release({ status: 'done' });
      }
      await pending;
    };
    setFileAdapter({
      capability: () => ({ available: true }),
      pick: async () => ({ status: 'cancelled' }),
      share,
      save: async () => ({ status: 'cancelled' }),
    });
    try {
      await render(wrap(<ScheduleScreen {...props} />));
      const exportButton = screen.getByRole('button', { name: /ics/i });
      await pressTwiceBeforeCommit(exportButton);
      expect(share).toHaveBeenCalledTimes(1);
      await act(finishShare);
    } finally {
      await act(finishShare);
      setFileAdapter();
    }
  });

  test('schedule lists the term sessions and reports calendar export as unavailable', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));
    await fireEvent.press(screen.getByRole('tab', { name: 'Học kỳ' }));
    expect(screen.getByRole('button', { name: /CS101 Nhập môn lập trình, 07:00 – 09:00/ })).toBeOnTheScreen();
    expect(screen.getByText('Chưa thể chia sẻ tệp trên thiết bị này')).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('attendance shows the summary rate per course and each status count', async () => {
    mockQueries['academic.attendance.summary'] = { data: [{ sectionId: 's1', courseCode: 'CS101', courseName: 'Nhập môn', total: 10, present: 9, absent: 1, late: 0, excused: 0, attendanceRate: 90 }] };
    mockQueries['academic.attendance.records'] = { data: [{ id: 'a1', date: '2026-09-07', status: 'ABSENT', sectionId: 's1', notes: 'Điểm danh bù đã duyệt', section: { sectionNumber: '02', course: { code: 'CS101' } } }] };
    await render(wrap(<AttendanceScreen {...props} />));
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0);
    expect(screen.getByText('9/10 buổi đã tham dự', { exact: false })).toBeOnTheScreen();
    expect(screen.getByLabelText('Số phiên: 10')).toBeOnTheScreen();
    expect(screen.getByLabelText('Có mặt: 9')).toBeOnTheScreen();
    expect(screen.getByLabelText('Đi muộn: 0')).toBeOnTheScreen();
    expect(screen.getByLabelText('Vắng: 1')).toBeOnTheScreen();
    expect(screen.getByLabelText('Có phép: 0')).toBeOnTheScreen();
    expect(screen.getByText('CS101 · 02')).toBeOnTheScreen();
    const record = screen.getByLabelText(/Điểm danh bù đã duyệt/);
    expect(record).toBeOnTheScreen();
    expect(record.props.accessibilityLabel).toContain('CS101 · 02');
    expect(record.props.accessibilityLabel).toContain('Điểm danh bù đã duyệt');
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('low attendance rates use the danger progress color', async () => {
    mockQueries['academic.attendance.summary'] = { data: [{ sectionId: 's1', courseCode: 'CS101', courseName: 'Nhập môn', total: 10, present: 4, absent: 6, late: 0, excused: 0, attendanceRate: 40 }] };
    mockQueries['academic.attendance.records'] = { data: [] };
    await render(wrap(<AttendanceScreen {...props} />));
    type JsonNode = { type: string; props: { accessibilityLabel?: string; accessibilityRole?: string; accessibilityValue?: { now?: number }; style?: unknown }; children: Array<JsonNode | string> | null };
    const descendants = (node: JsonNode | null): JsonNode[] => node
      ? [node, ...(node.children ?? []).filter((child): child is JsonNode => typeof child !== 'string').flatMap(descendants)]
      : [];
    const nodes = descendants(screen.toJSON() as JsonNode | null);
    const fillFor = (label: string) => {
      const progress = nodes.find((node) => node.props.accessibilityRole === 'progressbar' && node.props.accessibilityLabel === label);
      return progress && descendants(progress).find((node) => StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>)?.width === '40%');
    };
    expect(StyleSheet.flatten(fillFor('4/10 buổi đã tham dự')?.props.style as StyleProp<ViewStyle>)?.backgroundColor).toBe(tokens.colors.error);
    expect(StyleSheet.flatten(fillFor('Tỷ lệ có mặt')?.props.style as StyleProp<ViewStyle>)?.backgroundColor).toBe(tokens.colors.error);
  });

  test('rates from 70 to 89 use the warning progress color', async () => {
    mockQueries['academic.attendance.summary'] = { data: [{ sectionId: 's1', courseCode: 'CS101', courseName: 'Nhập môn', total: 20, present: 17, absent: 1, late: 2, excused: 0, attendanceRate: 85 }] };
    mockQueries['academic.attendance.records'] = { data: [] };
    await render(wrap(<AttendanceScreen {...props} />));
    type JsonNode = { type: string; props: { accessibilityLabel?: string; accessibilityRole?: string; accessibilityValue?: { now?: number }; style?: unknown }; children: Array<JsonNode | string> | null };
    const descendants = (node: JsonNode | null): JsonNode[] => node
      ? [node, ...(node.children ?? []).filter((child): child is JsonNode => typeof child !== 'string').flatMap(descendants)]
      : [];
    const nodes = descendants(screen.toJSON() as JsonNode | null);
    const progress = nodes.find((node) => node.props.accessibilityRole === 'progressbar' && node.props.accessibilityLabel === '17/20 buổi đã tham dự');
    const fill = progress && descendants(progress).find((node) => StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>)?.width === '85%');
    expect(StyleSheet.flatten(fill?.props.style as StyleProp<ViewStyle>)?.backgroundColor).toBe(tokens.colors.warning);
  });

  test('excused records use the primary status tone', async () => {
    mockQueries['academic.attendance.summary'] = { data: [{ sectionId: 's1', courseCode: 'CS101', courseName: 'Nhập môn', total: 3, present: 2, absent: 0, late: 0, excused: 1, attendanceRate: 67 }] };
    mockQueries['academic.attendance.records'] = { data: [{ id: 'a1', date: '2026-09-07', status: 'EXCUSED', sectionId: 's1', section: { course: { code: 'CS101' } } }] };
    await render(wrap(<AttendanceScreen {...props} />));
    const pillColors = screen.getAllByText('Có phép').map((pill) =>
      StyleSheet.flatten(pill.parent?.props.style as StyleProp<ViewStyle>)?.backgroundColor,
    );
    expect(pillColors).toContain(tokens.colors.primaryFixed);
    expect(pillColors).not.toContain(tokens.colors.warningFixed);
  });

  test('empty attendance uses the web empty copy', async () => {
    mockQueries['academic.attendance.summary'] = { data: [] };
    mockQueries['academic.attendance.records'] = { data: [] };
    await render(wrap(<AttendanceScreen {...props} />));
    expect(screen.getByText('Chưa có bản ghi điểm danh')).toBeOnTheScreen();
    expect(screen.getByText('Khi giảng viên bắt đầu điểm danh cho các lớp của bạn, bảng tổng hợp theo môn và lịch sử phiên học sẽ xuất hiện tại đây.')).toBeOnTheScreen();
  });

  test('attendance load failure uses the web error copy', async () => {
    mockQueries['academic.attendance.summary'] = { error: 'Không có kết nối.' };
    mockQueries['academic.attendance.records'] = { data: [] };
    await render(wrap(<AttendanceScreen {...props} />));
    expect(screen.getByText('Chưa tải được dữ liệu điểm danh')).toBeOnTheScreen();
    expect(screen.getByText('Không tải được dữ liệu điểm danh. Vui lòng kiểm tra kết nối và thử lại.')).toBeOnTheScreen();
    expect(screen.queryByText('Không thể tải dữ liệu')).toBeNull();
  });
});

describe('curriculum', () => {
  test('uses labelled preview curriculum data', async () => {
    Object.defineProperty(apiClient, 'mode', { configurable: true, value: 'preview' });
    await render(wrap(<CurriculumScreen {...props} />));
    expect(screen.getByText('Kỹ thuật phần mềm')).toBeOnTheScreen();
    expect(screen.getByText('CS101')).toBeOnTheScreen();
    expect(screen.getByText('Dữ liệu xem trước, không phải hồ sơ thật.')).toBeOnTheScreen();
  });

  test('shows credits progress, requirements and the registration link', async () => {
    mockQueries['academic.curriculum'] = {
      data: {
        curriculum: { id: 'c', code: 'SE2026', name: 'Kỹ thuật phần mềm', totalCredits: 120 },
        courses: [
          { courseId: 'a', code: 'MA101', name: 'Giải tích', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED', finalGrade: 8.5, letterGrade: 'B' },
          { courseId: 'b', code: 'CS201', name: 'Cấu trúc dữ liệu', credits: 3, year: 1, semester: 2, isMandatory: true, status: 'NOT_STARTED', prerequisites: ['MA101'] },
        ],
      },
    };
    mockQueries['academic.registrationSections'] = { data: [{ id: 's1', courseId: 'b', status: 'OPEN' }] };
    await render(wrap(<CurriculumScreen {...props} />));
    expect(screen.getByText('Đã hoàn tất 8,5 (B)')).toBeOnTheScreen();
    expect(screen.getByText('Năm học 1')).toBeOnTheScreen();
    expect(screen.getByText('Học kỳ 2 - 1 môn')).toBeOnTheScreen();
    expect(screen.getAllByText('Tiên quyết:').length).toBeGreaterThan(0);
    expect(screen.getAllByText('✓ MA101').length).toBeGreaterThan(0);
    expect(screen.getByText('Là tiên quyết của:')).toBeOnTheScreen();
    expect(screen.getByText('Có thể đăng ký ngay')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Đăng ký: CS201' }));
    expect(navigate).toHaveBeenCalledWith('registration');
    await fireEvent.press(screen.getByRole('button', { name: 'Đăng ký học phần' }));
    expect(navigate).toHaveBeenCalledWith('registration');
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('ready-to-register filter lists unblocked courses with open sections', async () => {
    mockQueries['academic.curriculum'] = {
      data: {
        curriculum: { id: 'c', code: 'SE2026', name: 'Kỹ thuật phần mềm', totalCredits: 120 },
        courses: [
          { courseId: 'a', code: 'MA101', name: 'Giải tích', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' },
          { courseId: 'b', code: 'CS201', name: 'Cấu trúc dữ liệu', credits: 3, year: 1, semester: 2, isMandatory: true, status: 'NOT_STARTED', prerequisites: ['MA101'] },
          { courseId: 'd', code: 'CS301', name: 'Mạng máy tính', credits: 3, year: 2, semester: 1, isMandatory: true, status: 'NOT_STARTED', prerequisites: ['CS201'] },
        ],
      },
    };
    mockQueries['academic.registrationSections'] = { data: [{ id: 's1', courseId: 'b', status: 'OPEN' }] };
    await render(wrap(<CurriculumScreen {...props} />));

    expect(screen.getByText('Đang mở 1 lớp trong kỳ này')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Trạng thái: Tất cả' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Có thể đăng ký' }));

    expect(screen.getAllByText('Cấu trúc dữ liệu').length).toBeGreaterThan(0);
    expect(screen.queryByText('Mạng máy tính')).toBeNull();
  });

  test('formats credit amounts inside Vietnamese progress copy', async () => {
    mockQueries['academic.curriculum'] = {
      data: {
        curriculum: { id: 'c', code: 'SE2026', name: 'Kỹ thuật phần mềm', totalCredits: 2345.5 },
        courses: [
          { courseId: 'a', code: 'MA101', name: 'Giải tích', credits: 1234.5, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' },
        ],
      },
    };
    const view = await render(wrap(<CurriculumScreen {...props} />));
    expect(screen.getByText('1.234,5 tín chỉ')).toBeOnTheScreen();
    expect(screen.getByLabelText('Tích lũy 1.234,5/2.345,5 tín chỉ')).toBeOnTheScreen();
    await view.unmount();
  });

  test('accessible curriculum rows announce credits and course requirements', async () => {
    mockQueries['academic.curriculum'] = {
      data: {
        curriculum: { id: 'c', code: 'SE2026', name: 'Kỹ thuật phần mềm', totalCredits: 120 },
        courses: [
          { courseId: 'b', code: 'CS201', name: 'Cấu trúc dữ liệu', credits: 3, year: 1, semester: 2, isMandatory: true, status: 'NOT_STARTED', prerequisites: ['MA101'] },
        ],
      },
    };
    await render(wrap(<CurriculumScreen {...props} />));

    const row = screen.getByLabelText(/CS201 Cấu trúc dữ liệu/);
    const label = row.props.accessibilityLabel as string;
    expect(label).toContain('3 tín chỉ');
    expect(label).toContain('Bắt buộc');
    expect(label).toContain('Tiên quyết: MA101');
  });

  test.each<['vi' | 'en', string, string, string]>([
    ['vi', 'Trạng thái: Tất cả', 'Chưa học', 'Không có học phần nào phù hợp với trạng thái đã chọn.'],
    ['en', 'Status: All', 'Not started', 'No courses match the selected status.'],
  ])('shows filter-specific empty copy in %s', async (locale, filterLabel, optionLabel, expected) => {
    mockQueries['academic.curriculum'] = {
      data: {
        curriculum: { id: 'c', code: 'SE2026', name: 'Kỹ thuật phần mềm', totalCredits: 120 },
        courses: [
          { courseId: 'a', code: 'MA101', name: 'Giải tích', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' },
        ],
      },
    };
    await render(wrap(<CurriculumScreen {...props} />, locale));
    await fireEvent.press(screen.getByRole('button', { name: filterLabel }));
    await fireEvent.press(screen.getByRole('radio', { name: optionLabel }));

    expect(screen.getByText(expected)).toBeOnTheScreen();
    expect(screen.queryByText(academicMessages[locale].emptyCurriculum)).toBeNull();
  });
});

describe('registration', () => {
  const pressSelect = async (code: string) => fireEvent.press(screen.getByRole('button', { name: `Chọn lớp: ${code} Lớp 01` }));
  const pressRegister = async () => fireEvent.press(screen.getByRole('button', { name: 'Đăng ký các lớp đã chọn' }));
  const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'SCHEDULE_CONFLICT' });

  test('does not recompute section availability when only the browse query changes', async () => {
    const availability = jest.spyOn(registrationBrowse, 'sectionAvailability');
    const sections = Array.from({ length: 200 }, (_, index) => section(`P${index}`, { courseCode: `CS${index}` }));
    mockQueries['academic.registration'] = { data: registrationData(sections) };
    await render(wrap(<RegistrationScreen {...props} />));
    const initialCalls = availability.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    await fireEvent.changeText(screen.getByLabelText('Tìm lớp học phần'), 'CS199');
    expect(availability).toHaveBeenCalledTimes(initialCalls);
  });

  test('ignores old-term enrollment conflicts and keeps same-term conflicts', async () => {
    const oldTermMeeting = [{ dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }];
    const currentTermMeeting = [{ dayOfWeek: 2, startTime: '13:00', endTime: '15:00' }];
    mockQueries['academic.registration'] = {
      data: {
        ...registrationData([
          section('A1', { schedules: oldTermMeeting }),
          section('B1', { schedules: currentTermMeeting }),
        ]),
        enrollments: [
          { id: 'old', sectionId: 'old-section', semesterId: 'term-a', status: 'ENROLLED', section: { schedules: oldTermMeeting } },
          { id: 'current', sectionId: 'current-section', semesterId: 'term-b', status: 'ENROLLED', section: { schedules: currentTermMeeting } },
        ],
        eligibility: { eligible: true, creditLimit: 20, creditsUsed: 3, creditsRemaining: 17, semesterId: 'term-b' },
      },
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByRole('button', { name: 'Chọn lớp: CSA1 Lớp 01' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSB1 Lớp 01' })).toBeNull();
  });

  test('falls back to all active enrollments for conflicts when eligibility is missing', async () => {
    const meeting = [{ dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }];
    mockQueries['academic.registration'] = {
      data: {
        ...registrationData([section('A1', { schedules: meeting })]),
        eligibility: null,
        enrollments: [{ id: 'old', sectionId: 'old-section', semesterId: 'term-a', status: 'ENROLLED', section: { schedules: meeting } }],
      },
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSA1 Lớp 01' })).toBeNull();
  });

  test('an unreachable registration read exposes retry and renders after recovery', async () => {
    mockQueries['academic.registration'] = { error: academicMessages.vi.offline, errorStatus: 0 };
    const view = await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByText(academicMessages.vi.offline)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Chọn lớp/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: academicMessages.vi.retry }));
    expect(mockReload).toHaveBeenCalledTimes(1);

    mockQueries['academic.registration'] = { data: registrationData([section('R1')]) };
    await view.rerender(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByRole('button', { name: 'Chọn lớp: CSR1 Lớp 01' })).toBeOnTheScreen();
    expect(screen.queryByText(academicMessages.vi.offline)).toBeNull();
  });

  test('a conflict keeps the selection and explains why', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('A1')]) };
    mockPost.mockRejectedValueOnce(conflict);
    await render(wrap(<RegistrationScreen {...props} />));
    await pressSelect('CSA1');
    await pressRegister();
    expect(await screen.findByText('Lớp trùng lịch với học phần đã đăng ký.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Bỏ chọn: CSA1 Lớp 01' })).toBeOnTheScreen();
    expect(screen.getByText('Lựa chọn của bạn vẫn được giữ lại.')).toBeOnTheScreen();
  });

  test('a retry after a lost response reuses the same idempotency key', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('B1')]) };
    mockPost.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 })).mockResolvedValueOnce({ id: 'new' });
    await render(wrap(<RegistrationScreen {...props} />));
    await pressSelect('CSB1');
    await pressRegister();
    expect(await screen.findByText('Không có kết nối. Chưa thể đăng ký hoặc rút lớp.')).toBeOnTheScreen();
    await pressRegister();
    expect(mockPost).toHaveBeenCalledTimes(2);
    const keys = mockPost.mock.calls.map((call) => call[2]?.headers?.['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  test('offline blocks the mutation before any request is sent', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('C1')]) };
    mockConnected = false;
    await render(wrap(<RegistrationScreen {...props} />));
    await pressSelect('CSC1');
    await pressRegister();
    expect(await screen.findByText('Không có kết nối. Chưa thể đăng ký hoặc rút lớp.')).toBeOnTheScreen();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('full, conflicting and over-limit sections cannot be selected and say why', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([
        section('D1', { remainingSeats: 0 }),
        section('D2', { scheduleConflict: true }),
        section('D3', { credits: 4 }),
        section('D4'),
      ]),
    };
    mockQueries['academic.registration'].data = { ...(mockQueries['academic.registration'].data as object), eligibility: { eligible: true, creditLimit: 20, creditsUsed: 18, creditsRemaining: 3 } };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText('Trùng lịch')).toBeOnTheScreen();
    expect(screen.getByText('Vượt giới hạn tín chỉ')).toBeOnTheScreen();
    expect(screen.getAllByText('Hết chỗ').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSD2 Lớp 01' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSD1 Lớp 01' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Chọn lớp: CSD4 Lớp 01' })).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('drop asks for confirmation and sends one idempotent request', async () => {
    mockQueries['academic.registration'] = {
      data: {
        ...registrationData([section('E1', { alreadyEnrolled: true })]),
        enrollments: [{ id: 'enr-1', sectionId: 'E1', semesterId: 't2', status: 'ENROLLED' }],
      },
    };
    mockPost.mockResolvedValueOnce({ message: 'ok' });
    await render(wrap(<RegistrationScreen {...props} />));
    await fireEvent.press(screen.getByRole('button', { name: 'Rút lớp: CSE1' }));
    expect(mockPost).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Rút lớp' }));
    expect(await screen.findByText('Đã rút lớp')).toBeOnTheScreen();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('/me/enrollments/enr-1/drop');
    expect(mockPost.mock.calls[0][2]?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  test('a confirmed enrollment offers the same drop as an enrolled one', async () => {
    mockQueries['academic.registration'] = {
      data: {
        ...registrationData([section('G1', { alreadyEnrolled: true })]),
        enrollments: [{ id: 'enr-9', sectionId: 'G1', semesterId: 't2', status: 'CONFIRMED' }],
      },
    };
    mockPost.mockResolvedValueOnce({ message: 'ok' });
    await render(wrap(<RegistrationScreen {...props} />));
    await fireEvent.press(screen.getByRole('button', { name: 'Rút lớp: CSG1' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Rút lớp' }));
    expect(await screen.findByText('Đã rút lớp')).toBeOnTheScreen();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('/me/enrollments/enr-9/drop');
  });

  test('a window that closes clears the basket and explains the close reason', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('H1')]) };
    const view = await render(wrap(<RegistrationScreen {...props} />));
    await pressSelect('CSH1');
    expect(screen.getByText('Đã chọn (1)')).toBeOnTheScreen();
    mockQueries['academic.registration'] = {
      data: { ...registrationData([], false), closedReason: 'WINDOW_CLOSED' },
    };
    await view.rerender(wrap(<RegistrationScreen {...props} />));
    expect(screen.queryByText('Đã chọn (1)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đăng ký các lớp đã chọn' })).toBeNull();
    expect(await screen.findByText('Đợt đăng ký hiện không mở.')).toBeOnTheScreen();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('the basket counts toward the credit limit and the schedule', async () => {
    mockQueries['academic.registration'] = {
      data: {
        ...registrationData([
          section('K1', { schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:00' }] }),
          section('K2', { schedules: [{ dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }] }),
          section('K3', { schedules: [{ dayOfWeek: 3, startTime: '07:00', endTime: '09:00' }] }),
        ]),
        eligibility: { eligible: true, creditLimit: 20, creditsUsed: 17, creditsRemaining: 3 },
      },
    };
    await render(wrap(<RegistrationScreen {...props} />));
    await pressSelect('CSK1');
    expect(screen.getByText('Trùng lịch')).toBeOnTheScreen();
    expect(screen.getByText('Vượt giới hạn tín chỉ')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSK2 Lớp 01' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSK3 Lớp 01' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bỏ chọn: CSK1 Lớp 01' })).toBeOnTheScreen();
  });

  test('an eligibility failure shows a retryable warning instead of a silent pass', async () => {
    mockQueries['academic.registration'] = {
      data: { ...registrationData([section('L1')]), eligibility: null, eligibilityError: { status: 500 } },
    };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(await screen.findByText('Có lỗi xảy ra. Vui lòng thử lại.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  test('shows the localized reason for a cohort eligibility error', async () => {
    mockQueries['academic.registration'] = {
      data: { ...registrationData([section('L2')]), eligibility: null, eligibilityError: { status: 422, code: 'COHORT_INELIGIBLE' } },
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByText('Khóa của bạn chưa được đăng ký ở đợt này.')).toBeOnTheScreen();
  });

  test('search narrows the catalog without losing the selection', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('F1', { courseName: 'Điện toán đám mây' }), section('F2', { courseName: 'Vật lý' })]) };
    await render(wrap(<RegistrationScreen {...props} />));
    await pressSelect('CSF2');
    await fireEvent.changeText(screen.getByLabelText('Tìm lớp học phần'), 'dien toan');
    expect(screen.queryByText(/Vật lý/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Chọn lớp: CSF1 Lớp 01' })).toBeOnTheScreen();
    expect(screen.getByText('Đã chọn (1)')).toBeOnTheScreen();
  });

  test('a closed round is a state, not an empty catalog', async () => {
    mockQueries['academic.registration'] = { data: registrationData([], false) };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText('Hiện không có đợt đăng ký nào đang mở')).toBeOnTheScreen();
  });

  test('an API error is an error state, not preview data', async () => {
    mockQueries['academic.registration'] = { error: 'Chưa thể tải.', errorStatus: 500 };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText('Chưa thể tải.')).toBeOnTheScreen();
    expect(screen.queryByText('Distributed Systems')).toBeNull();
    expect(screen.queryByRole('button', { name: /Chọn lớp/ })).toBeNull();
  });

  test('the screen title is not repeated as the basket hero eyebrow', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('M1')]) };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getAllByText('Đăng ký học phần')).toHaveLength(1);
  });

  test('the catalog search placeholder uses the standard course term', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('M2')]) };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByLabelText('Tìm lớp học phần').props.placeholder).toBe('Tìm học phần');
  });

  test('shows the localized course name in Vietnamese and English', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([section('N1', {
        courseName: 'Distributed Systems',
        courseNameEn: 'Distributed Systems',
        courseNameVi: 'Hệ thống phân tán',
      })]),
    };
    const viView = await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText(/Hệ thống phân tán/)).toBeOnTheScreen();
    expect(screen.queryByText(/Distributed Systems/)).toBeNull();
    viView.unmount();

    await render(wrap(<RegistrationScreen {...props} />, 'en'));
    expect(screen.getByText(/Distributed Systems/)).toBeOnTheScreen();
    expect(screen.queryByText(/Hệ thống phân tán/)).toBeNull();
  });
});
