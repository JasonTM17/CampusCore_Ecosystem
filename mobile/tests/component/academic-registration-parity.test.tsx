import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { campusApi } from '../../src/api/client';
import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { setFileAdapter } from '../../src/files/file-adapter';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { academicMessages } from '../../src/i18n/academic-messages';

type QueryState = { data?: unknown; error?: string | null; errorStatus?: number | null; isLoading?: boolean };

const mockQueries: Record<string, QueryState> = {};
const mockReload = jest.fn(async () => {});
const mockPost = jest.fn<(path: string, body?: unknown, init?: { headers?: Record<string, string> }) => Promise<unknown>>();
const mockGet = jest.fn<(path: string) => Promise<unknown>>();
let mockConnected = true;

jest.mock('../../src/api/client', () => ({
  apiClient: {
    mode: 'live',
    get: (...args: unknown[]) => (mockGet as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
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
  createAssistantClientRequestId: () => 'key-1',
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const state = mockQueries[key] ?? {};
    return {
      data: state.data,
      error: state.error ?? null,
      warning: null,
      errorStatus: state.errorStatus ?? null,
      isLoading: state.isLoading ?? false,
      isStale: false,
      reload: mockReload,
      setData: jest.fn(),
    };
  },
}));

jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ isConnected: mockConnected }) }));

import { academicApi } from '../../src/screens/academic/academic-api';
import { browseSections } from '../../src/screens/academic/registration-browse';
import { CoursesScreen } from '../../src/screens/student/CoursesScreen';
import { RegistrationScreen } from '../../src/screens/student/RegistrationScreen';
import { ScheduleScreen } from '../../src/screens/student/ScheduleScreen';
import { EnrollmentsScreen } from '../../src/screens/academic/EnrollmentsScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const copy = academicMessages.vi;
const navigate = jest.fn();
const props = { navigation: { navigate }, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;

function wrap(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>
  );
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

const course = (code: string, name: string, credits = 3) => ({ code, name, nameVi: name, nameEn: name, credits });
const section = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, sectionNumber: '01', courseId: `c-${id}`, courseCode: `CS${id}`, courseName: `Môn ${id}`, credits: 3,
  capacity: 40, enrolledCount: 10, remainingSeats: 30, status: 'OPEN', scheduleConflict: false, alreadyEnrolled: false, ...overrides,
});
const round = (overrides: Record<string, unknown> = {}) => ({
  id: 'round-reg', semesterId: 't2', name: 'Đợt đăng ký HK2', kind: 'REGISTRATION', status: 'OPEN',
  windowStart: '2020-01-01T00:00:00Z', windowEnd: '2099-12-31T00:00:00Z', ...overrides,
});
const registrationData = (sections: unknown[], overrides: Record<string, unknown> = {}) => ({
  sections, enrollments: [], roundOpen: true, round: round(),
  eligibility: { eligible: true, semesterId: 't2', creditLimit: 20, creditsUsed: 3, creditsRemaining: 17 },
  application: null, closedReason: null, ...overrides,
});

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockConnected = true;
  mockPost.mockReset();
  mockPost.mockResolvedValue({ message: 'ok' });
  mockGet.mockReset();
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/me/registration/eligibility')) {
      return { eligible: true, semesterId: 't2', creditLimit: 20, creditsUsed: 3, creditsRemaining: 17 };
    }
    if (path.startsWith('/me/registration/credit-limit-application')) return null;
    return [];
  });
  mockReload.mockClear();
  navigate.mockClear();
  setFileAdapter({
    capability: () => ({ available: true }),
    pick: async () => ({ status: 'cancelled' }),
    share: async () => ({ status: 'cancelled' }),
    save: async () => ({ status: 'cancelled' }),
  });
});
afterEach(() => { jest.restoreAllMocks(); setFileAdapter(); });

describe('registration round selection and scoping', () => {
  test('picks the live REGISTRATION round and scopes eligibility to it', async () => {
    jest.mocked(campusApi.enrollments).mockResolvedValueOnce([]);
    jest.mocked(campusApi.registrationRounds).mockResolvedValueOnce([
      round({ id: 'round-adddrop', kind: 'ADD_DROP' }),
      round({ id: 'round-reg' }),
      round({ id: 'round-expired', windowEnd: '2020-01-01T00:00:00Z' }),
    ]);
    jest.mocked(campusApi.registrationSections).mockResolvedValueOnce([]);

    const workspace = await academicApi.registrationWorkspace();

    expect(workspace.roundOpen).toBe(true);
    expect(workspace.round?.id).toBe('round-reg');
    const eligibilityCall = mockGet.mock.calls.map((call) => call[0]).find((path) => path.startsWith('/me/registration/eligibility'));
    expect(eligibilityCall).toContain('roundId=round-reg');
    expect(eligibilityCall).toContain('semesterId=t2');
  });

  test('a round still marked OPEN after its window does not open registration', async () => {
    jest.mocked(campusApi.enrollments).mockResolvedValueOnce([]);
    jest.mocked(campusApi.registrationRounds).mockResolvedValueOnce([round({ windowEnd: '2020-01-01T00:00:00Z' })]);
    jest.mocked(campusApi.registrationSections).mockResolvedValueOnce([]);

    const workspace = await academicApi.registrationWorkspace();

    expect(workspace.roundOpen).toBe(false);
    expect(workspace.round).toBeNull();
  });
});

describe('registration round banner', () => {
  test('shows the round name and window', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('A1')]) };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByText('Đợt đăng ký HK2')).toBeOnTheScreen();
    expect(screen.getByText('Từ 01/01/2020 đến 31/12/2099')).toBeOnTheScreen();
    // The web hides the countdown until the last seven days.
    expect(screen.queryByText(/Còn lại/)).toBeNull();
  });

  test('a deadline within a week shows the countdown', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString();
    mockQueries['academic.registration'] = {
      data: registrationData([section('A1')], { round: round({ windowEnd: soon }) }),
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByText(/Còn lại: 2 ngày/)).toBeOnTheScreen();
  });

  test('the countdown clock ticks every second', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-09T00:00:00Z'));
    const soon = new Date('2026-11-11T01:00:00Z').toISOString();
    mockQueries['academic.registration'] = {
      data: registrationData([section('A1')], { round: round({ windowEnd: soon }) }),
    };
    let unmount: (() => void) | undefined;
    try {
      const view = await render(wrap(<RegistrationScreen {...props} />));
      unmount = view.unmount;
      expect(screen.getByText('Còn lại: 2 ngày 01:00:00')).toBeOnTheScreen();
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(screen.getByText('Còn lại: 2 ngày 00:59:59')).toBeOnTheScreen();
    } finally {
      if (unmount) await act(() => { unmount?.(); });
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('registration confirmation and warnings', () => {
  test('register opens a confirmation naming the section before writing', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('A1')]) };
    await render(wrap(<RegistrationScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn lớp: CSA1 Lớp 01' }));
    await fireEvent.press(screen.getByRole('button', { name: copy.registerSelected }));

    expect(screen.getByText(copy.confirmRegister)).toBeOnTheScreen();
    expect(screen.getByText(/Bạn đang đăng ký lớp học phần CSA1/)).toBeOnTheScreen();
    expect(mockPost).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: copy.register }));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test('an outside-curriculum section without a schedule shows both policy warnings', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([section('A2', { curriculumRelevance: 'OUTSIDE', schedules: [] })]),
    };
    await render(wrap(<RegistrationScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: 'Chọn lớp: CSA2 Lớp 01' }));
    await fireEvent.press(screen.getByRole('button', { name: copy.registerSelected }));

    expect(screen.getByText(new RegExp(copy.outsideWarningBanner))).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(copy.scheduleNoneWarning))).toBeOnTheScreen();
  });
});

describe('registration section state', () => {
  test('a course already registered in another section is badged and blocked', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([section('B1'), section('B2', { courseId: 'c-B1' })], {
        enrollments: [{ id: 'e1', sectionId: 'B1', semesterId: 't2', status: 'ENROLLED', section: { courseId: 'c-B1', course: course('CSB1', 'Môn B1') } }],
      }),
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getAllByText(copy.duplicateCourseBadge).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSB2 Lớp 01' })).toBeNull();
    expect(screen.getAllByText(copy.duplicateCourseTooltip).length).toBeGreaterThan(0);
  });

  test('an outside-curriculum section carries its badge', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('C1', { curriculumRelevance: 'OUTSIDE' })]) };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText(copy.outsideBadge)).toBeOnTheScreen();
  });

  test('a blocked section explains itself with the web sentence', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([section('D1', { scheduleConflict: true }), section('D2', { remainingSeats: 0 })]),
    };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText(copy.scheduleConflictTooltip)).toBeOnTheScreen();
    expect(screen.getAllByText(copy.full).length).toBeGreaterThan(0);
  });

  test('the section meeting names the lecturer', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([section('E1', { schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:00', room: 'A1.101', lecturer: 'TS. Nguyễn' }] })]),
    };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText(/GV TS. Nguyễn/)).toBeOnTheScreen();
  });

  test('low seats are amber and a full section is neutral', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([
        section('F1', { remainingSeats: 1, capacity: 40 }),
        section('F2', { remainingSeats: 0, capacity: 40 }),
      ]),
    };
    await render(wrap(<RegistrationScreen {...props} />));

    const low = screen.getByText('Còn 1 chỗ');
    const full = screen.getAllByText(copy.full)[0];
    expect(StyleSheet.flatten(low.parent?.props.style)).toEqual(expect.objectContaining({ backgroundColor: tokens.colors.warningFixed }));
    expect(StyleSheet.flatten(full.parent?.props.style)).toEqual(expect.objectContaining({ backgroundColor: tokens.colors.surfaceLow }));
  });

  test('the course header counts sections and open seats and collapses', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([
        section('G1', { courseId: 'cg', remainingSeats: 10 }),
        section('G2', { courseId: 'cg', remainingSeats: 5 }),
      ]),
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByText('3 tín chỉ · 2 lớp')).toBeOnTheScreen();
    expect(screen.getByText('15 chỗ trống')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'CSG1 Môn G1' }));
    expect(screen.queryByRole('button', { name: 'Chọn lớp: CSG1 Lớp 01' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'CSG1 Môn G1' }));
    expect(screen.getByRole('button', { name: 'Chọn lớp: CSG1 Lớp 01' })).toBeOnTheScreen();
  });
});

describe('registration filters', () => {
  test('filters use the web names, live counts and result count', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([
        section('H1', { curriculumRelevance: 'MANDATORY' }),
        section('H2', { curriculumRelevance: 'ELECTIVE', scheduleConflict: true }),
        section('H3', { curriculumRelevance: 'OUTSIDE', remainingSeats: 0 }),
      ]),
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByText('3 lớp học phần')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`${copy.relLabel}: ${copy.relAll}`) }));
    expect(screen.getByRole('radio', { name: 'Trong chương trình (1)' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Tự chọn (1)' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Ngoài chương trình (1)' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${copy.filterSeats} (2)` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${copy.filterNoConflict} (2)` })).toBeOnTheScreen();
  });

  test('seats open hides a full section even when the student is enrolled in it', () => {
    const rows = [
      section('J1', { remainingSeats: 0, alreadyEnrolled: true }),
      section('J2', { remainingSeats: 4 }),
    ];
    const groups = browseSections(rows, { search: '', curriculum: 'ALL', seatsOnly: true, noConflictOnly: false, sort: 'code' });
    expect(groups.flatMap((group) => group.sections).map((row) => row.id)).toEqual(['J2']);
  });
});

describe('registration slip', () => {
  test('the catalogue footer offers the term slip with the web label', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('K1')]) };
    await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByRole('button', { name: `${copy.slipDownload}: ${copy.slipName}` })).toBeOnTheScreen();
    expect(copy.slipDownload).toBe('Xuất phiếu đăng ký (PDF)');
  });

  test('the enrollments header offers the term slip', async () => {
    mockQueries['academic.enrollments'] = { data: [{ id: 'e1', sectionId: 's1', semesterId: 't2', status: 'ENROLLED', section: { sectionNumber: '01', course: course('CS101', 'Nhập môn') } }] };
    mockQueries['academic.semesters'] = { data: [{ id: 't2', name: 'HK2', status: 'IN_PROGRESS' }] };
    await render(wrap(<EnrollmentsScreen {...props} />));
    expect(screen.getByRole('button', { name: `${copy.slipDownload}: ${copy.slipName}` })).toBeOnTheScreen();
  });
});

describe('credit-limit policy and exception request', () => {
  test('shows the policy and an approved exception from the application', async () => {
    mockQueries['academic.registration'] = {
      data: registrationData([section('L1')], {
        application: { id: 'app1', roundId: 'round-reg', status: 'APPROVED', requestedLimit: 30, standardLimit: 28, reason: 'x'.repeat(20) },
      }),
    };
    await render(wrap(<RegistrationScreen {...props} />));

    expect(screen.getByText(copy.limitPolicyTitle)).toBeOnTheScreen();
    expect(screen.getByText('Đã được duyệt tối đa 30 tín chỉ')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: copy.applicationSubmit })).toBeNull();
  });

  test('submits a reason of at least 20 characters to the student endpoint', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('L2')]) };
    await render(wrap(<RegistrationScreen {...props} />));

    await fireEvent.changeText(screen.getByLabelText(copy.applicationReasonLabel), 'Cần thêm hai tín chỉ cho học kỳ cuối');
    await fireEvent.press(screen.getByRole('button', { name: copy.applicationSubmit }));

    expect(mockPost).toHaveBeenCalledWith('/me/registration/credit-limit-applications', {
      roundId: 'round-reg',
      reason: 'Cần thêm hai tín chỉ cho học kỳ cuối',
    });
  });

  test('sends one application when Submit is pressed twice before the busy state commits', async () => {
    mockQueries['academic.registration'] = { data: registrationData([section('L3')]) };
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    mockPost.mockImplementationOnce(() => pending);
    await render(wrap(<RegistrationScreen {...props} />));

    await fireEvent.changeText(screen.getByLabelText(copy.applicationReasonLabel), 'Cần thêm hai tín chỉ cho học kỳ cuối');
    const submit = screen.getByRole('button', { name: copy.applicationSubmit });
    try {
      await pressTwiceBeforeCommit(submit);
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith('/me/registration/credit-limit-applications', {
        roundId: 'round-reg',
        reason: 'Cần thêm hai tín chỉ cho học kỳ cuối',
      });
    } finally {
      await act(async () => {
        release({ message: 'ok' });
        await pending;
      });
    }
  });
});

describe('enrollment workspace parity', () => {
  const enrollments = [
    { id: 'e1', sectionId: 's1', semesterId: 't2', status: 'PENDING', enrolledAt: '2026-09-07T00:00:00Z', section: { sectionNumber: '01', course: course('CS101', 'Nhập môn'), lecturer: { fullName: 'TS. Trần' }, schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:00', classroom: { building: 'A1', roomNumber: '101' } }] } },
    { id: 'e2', sectionId: 's2', semesterId: 't2', status: 'DROPPED', section: { sectionNumber: '02', course: course('MA101', 'Giải tích') } },
  ];

  test('status names and tones follow the web', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: [{ id: 't2', name: 'HK2', status: 'IN_PROGRESS' }] };
    await render(wrap(<EnrollmentsScreen {...props} />));

    const pending = screen.getByText('Đang chờ duyệt');
    expect(StyleSheet.flatten(pending.parent?.props.style)).toEqual(expect.objectContaining({ backgroundColor: tokens.colors.warningFixed }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Đã rút (1)' }));
    const dropped = screen.getByText('Đã hủy');
    expect(StyleSheet.flatten(dropped.parent?.props.style)).toEqual(expect.objectContaining({ backgroundColor: tokens.colors.errorFixed }));
  });

  test('the list card shows the meeting, lecturer and enrollment date', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: [{ id: 't2', name: 'HK2', status: 'IN_PROGRESS' }] };
    await render(wrap(<EnrollmentsScreen {...props} />));

    expect(screen.getByText(/Thứ Hai 07:00–09:00 · Phòng A1 101/)).toBeOnTheScreen();
    expect(screen.getByText(/TS\. Trần/)).toBeOnTheScreen();
    expect(screen.getByText(/Đăng ký ngày 07\/09\/2026/)).toBeOnTheScreen();
  });

  test('a selected term shows its heading and counts', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: [{ id: 't2', name: 'HK2', status: 'IN_PROGRESS' }] };
    await render(wrap(<EnrollmentsScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: `${copy.term}: ${copy.allTerms}` }));
    await fireEvent.press(screen.getByRole('radio', { name: 'HK2' }));

    expect(screen.getAllByText('HK2').length).toBeGreaterThan(0);
    expect(screen.getByText('2 môn · 6 tín chỉ')).toBeOnTheScreen();
  });

  test('both mobile entries use the web page title', async () => {
    mockQueries['academic.enrollments'] = { data: [] };
    const courses = await render(wrap(<CoursesScreen {...props} />));
    expect(screen.getByRole('header', { name: 'Môn học của tôi' })).toBeOnTheScreen();
    await courses.unmount();
    await render(wrap(<EnrollmentsScreen {...props} />));
    expect(screen.getByRole('header', { name: 'Môn học của tôi' })).toBeOnTheScreen();
  });

  test.each<['vi' | 'en', string, string, string]>([
    ['vi', 'Chưa có môn học', 'Khi bạn đăng ký một lớp học phần, lịch học và thông tin lớp sẽ xuất hiện ở đây.', 'Xem lớp học phần'],
    ['en', 'No courses yet', 'Once you enroll in a class, its schedule and details will appear here.', 'Browse classes'],
  ])('the empty enrollment state follows the web copy and action in %s', async (locale, title, description, action) => {
    mockQueries['academic.enrollments'] = { data: [] };
    mockQueries['academic.semesters'] = { data: [] };
    await render(wrap(<EnrollmentsScreen {...props} />, locale));

    expect(screen.getByText(title)).toBeOnTheScreen();
    expect(screen.getByText(description)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: action }));
    expect(navigate).toHaveBeenCalledWith('registration');
  });

  test('a meeting without a room says the room is pending', async () => {
    mockQueries['academic.enrollments'] = {
      data: [{ id: 'e3', sectionId: 's3', semesterId: 't2', status: 'ENROLLED', section: { sectionNumber: '01', course: course('PH101', 'Vật lý'), schedules: [{ dayOfWeek: 3, startTime: '09:00', endTime: '10:00' }] } }],
    };
    mockQueries['academic.semesters'] = { data: [{ id: 't2', name: 'HK2', status: 'IN_PROGRESS' }] };
    await render(wrap(<EnrollmentsScreen {...props} />));
    await fireEvent.press(screen.getByRole('button', { name: /PH101 Vật lý/ }));
    expect(screen.getByText(/Chưa xếp phòng/)).toBeOnTheScreen();
  });

  test('the three academic screens carry the same eyebrow', async () => {
    mockQueries['academic.enrollments'] = { data: [] };
    const registration = await render(wrap(<RegistrationScreen {...props} />));
    expect(screen.getByText('CỔNG SINH VIÊN')).toBeOnTheScreen();
    await registration.unmount();
    const enrollments = await render(wrap(<EnrollmentsScreen {...props} />));
    expect(screen.getByText('CỔNG SINH VIÊN')).toBeOnTheScreen();
    await enrollments.unmount();
    await render(wrap(<ScheduleScreen {...props} />));
    expect(screen.getByText('CỔNG SINH VIÊN')).toBeOnTheScreen();
  });
});

describe('enrollment drop parity', () => {
  const rows = [
    { id: 'e1', sectionId: 's1', semesterId: 't2', status: 'ENROLLED', enrolledAt: '2026-09-07T00:00:00Z', section: { sectionNumber: '01', course: course('CS101', 'Nhập môn'), schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:00', classroom: { building: 'A1', roomNumber: '101' } }] } },
    { id: 'e2', sectionId: 's2', semesterId: 't2', status: 'DROPPED', section: { sectionNumber: '02', course: course('MA101', 'Giải tích') } },
  ];
  const term = [{ id: 't2', name: 'HK2', status: 'IN_PROGRESS' }];

  test('the list card drops an enrolled course through the shared confirmation', async () => {
    mockQueries['academic.enrollments'] = { data: rows };
    mockQueries['academic.semesters'] = { data: term };
    mockPost.mockResolvedValueOnce({ message: 'ok' });
    await render(wrap(<EnrollmentsScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: `${copy.dropSection}: CS101` }));
    expect(screen.getByText(copy.dropTitle)).toBeOnTheScreen();
    expect(screen.getByText(/Bạn đang hủy lớp học phần CS101-01/)).toBeOnTheScreen();
    expect(mockPost).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: copy.dropSection }));
    expect(await screen.findByText(copy.dropped)).toBeOnTheScreen();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('/me/enrollments/e1/drop');
  });

  test('the detail sheet drops the same course', async () => {
    mockQueries['academic.enrollments'] = { data: rows };
    mockQueries['academic.semesters'] = { data: term };
    mockPost.mockResolvedValueOnce({ message: 'ok' });
    await render(wrap(<EnrollmentsScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: /CS101 Nhập môn/ }));
    await fireEvent.press(screen.getByRole('button', { name: `${copy.dropSection}: CS101` }));
    await fireEvent.press(screen.getByRole('button', { name: copy.dropSection }));
    expect(await screen.findByText(copy.dropped)).toBeOnTheScreen();
    expect(mockPost.mock.calls[0][0]).toBe('/me/enrollments/e1/drop');
  });

  test('a dropped course no longer offers the drop action', async () => {
    mockQueries['academic.enrollments'] = { data: rows };
    mockQueries['academic.semesters'] = { data: term };
    await render(wrap(<EnrollmentsScreen {...props} />));
    await fireEvent.press(screen.getByRole('tab', { name: 'Đã rút (1)' }));

    expect(screen.queryByRole('button', { name: `${copy.dropSection}: MA101` })).toBeNull();
  });
});

describe('schedule parity', () => {
  const enrollments = [
    { id: 'e1', sectionId: 's1', semesterId: 't2', status: 'ENROLLED', section: { sectionNumber: '01', course: course('CS101', 'Nhập môn'), schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:00', classroom: { building: 'A1', roomNumber: '101' } }] } },
    { id: 'e2', sectionId: 's2', semesterId: 't1', status: 'ENROLLED', section: { sectionNumber: '01', course: course('MA101', 'Giải tích'), schedules: [{ dayOfWeek: 3, startTime: '09:00', endTime: '10:00' }] } },
  ];
  const semesters = [
    { id: 't1', name: 'HK1', startDate: '2026-01-05', endDate: '2026-05-30' },
    { id: 't2', name: 'HK2', startDate: '2026-09-01', endDate: '2026-12-31', status: 'IN_PROGRESS' },
  ];

  test('the term selector offers all semesters and merges their agenda', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: `${copy.term}: HK2` }));
    await fireEvent.press(screen.getByRole('radio', { name: copy.allTerms }));
    await fireEvent.press(screen.getByRole('tab', { name: copy.viewTerm }));
    expect(screen.getByRole('button', { name: /CS101 Nhập môn/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /MA101 Giải tích/ })).toBeOnTheScreen();
  });

  test('quick metrics count courses, weekly sessions and credits', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));

    await fireEvent.press(screen.getByRole('button', { name: `${copy.term}: HK2` }));
    await fireEvent.press(screen.getByRole('radio', { name: copy.allTerms }));

    expect(screen.getByLabelText('Môn học: 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Buổi học / tuần: 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Tín chỉ: 6')).toBeOnTheScreen();
  });

  test('the empty schedule explains itself and links to registration', async () => {
    mockQueries['academic.enrollments'] = { data: [] };
    mockQueries['academic.semesters'] = { data: [] };
    await render(wrap(<ScheduleScreen {...props} />));

    expect(screen.getByText('Chưa có lớp học theo lịch')).toBeOnTheScreen();
    expect(screen.getByText('Khi lớp học phần được xác nhận, các buổi học sẽ xuất hiện tại đây theo lịch tuần.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Xem lớp học phần' }));
    expect(navigate).toHaveBeenCalledWith('registration');
  });

  test('an empty day keeps the hint that classes will appear there', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));

    const dayCells = screen.getAllByTestId(/^day-/);
    await fireEvent.press(dayCells[1]);
    expect(screen.getByText('Các buổi học của ngày đã chọn sẽ xuất hiện tại đây.')).toBeOnTheScreen();
  });

  test('weekdays use the web capitalisation and today is visible', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));

    expect(screen.getByText('HÔM NAY')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: copy.viewTerm }));
    expect(screen.getByText('Thứ Hai')).toBeOnTheScreen();
  });
});
