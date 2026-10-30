import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { apiClient } from '../../src/api/client';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { auditTree } from '../a11y/audit';

type QueryState = { data?: unknown; error?: string | null; warning?: string | null; errorStatus?: number | null; isLoading?: boolean };

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
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const match = Object.keys(mockQueries).find((name) => key === name || key.startsWith(`${name}.`));
    const state = (match ? mockQueries[match] : {}) as QueryState;
    return {
      data: state.data,
      error: state.error ?? null,
      warning: state.warning ?? null,
      errorStatus: state.errorStatus ?? null,
      isLoading: state.isLoading ?? false,
      isStale: false,
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
import { AttendanceScreen } from '../../src/screens/student/AttendanceScreen';
import { TranscriptScreen } from '../../src/screens/academic/TranscriptScreen';
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

  test('shows the cumulative GPA, the term record and the grade scale', async () => {
    mockQueries['academic.transcript'] = { data: transcript };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getByRole('header', { name: 'Bảng điểm' })).toBeOnTheScreen();
    expect(screen.getAllByText('3,42').length).toBeGreaterThan(0);
    expect(screen.getByText('GPA tích lũy (hệ 4)')).toBeOnTheScreen();
    expect(screen.getByText('MA101')).toBeOnTheScreen();
    expect(screen.getByLabelText('A+, 9.0 - 10.0, 4.0')).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });

  test('follows the English locale', async () => {
    mockQueries['academic.transcript'] = { data: transcript };
    await render(wrap(<TranscriptScreen {...props} />, 'en'));
    expect(screen.getByRole('header', { name: 'Transcript' })).toBeOnTheScreen();
    expect(screen.getAllByText('3.42').length).toBeGreaterThan(0);
  });

  test('an API error is an error state, never data', async () => {
    mockQueries['academic.transcript'] = { error: 'Không có kết nối.', errorStatus: 0 };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getByText('Không có kết nối.')).toBeOnTheScreen();
    expect(screen.queryByText('3,42')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  test('a payload that is not a transcript is not rendered', async () => {
    mockQueries['academic.transcript'] = { data: { unexpected: true } };
    await render(wrap(<TranscriptScreen {...props} />));
    expect(screen.getByText('Có lỗi xảy ra. Vui lòng thử lại.')).toBeOnTheScreen();
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
    expect(screen.getByText('8.2 · B+')).toBeOnTheScreen();
    expect(screen.getByText('Chưa thể tải xuống trên thiết bị này')).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByRole('tab', { name: 'Đã học (1)' })).toBeOnTheScreen();
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
});

describe('grades', () => {
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

  test('lists published grades only and explains the scale', async () => {
    mockQueries['academic.grades'] = {
      data: [
        { id: 'g1', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' },
        { id: 'g2', courseCode: 'CS101', courseName: 'Nhập môn', credits: 3, finalGrade: 9.5, letterGrade: 'A+', gradeStatus: 'DRAFT', semesterId: 't2', semester: 'HK2' },
      ],
    };
    await render(wrap(<GradesScreen {...props} />));
    expect(screen.getByText('MA101')).toBeOnTheScreen();
    expect(screen.queryByText('CS101')).toBeNull();
    expect(screen.getByLabelText('B, 7.0 - 7.9, 3.0')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Xem bảng điểm tích lũy' }));
    expect(navigate).toHaveBeenCalledWith('transcript');
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });
});

describe('schedule and attendance', () => {
  test('renders seven accessible week day buttons with one selected day', async () => {
    await render(wrap(<ScheduleScreen {...props} />));
    const dayCells = screen.getAllByTestId(/^day-/);

    expect(dayCells).toHaveLength(7);
    expect(dayCells.every((cell) => cell.props.accessibilityRole === 'button')).toBe(true);
    expect(dayCells.every((cell) => Boolean(cell.props.accessibilityLabel))).toBe(true);
    expect(dayCells.filter((cell) => cell.props.accessibilityState?.selected)).toHaveLength(1);
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

  test('attendance shows the summary rate per course', async () => {
    mockQueries['academic.attendance.summary'] = { data: [{ sectionId: 's1', courseCode: 'CS101', courseName: 'Nhập môn', total: 10, present: 9, absent: 1, late: 0, excused: 0, attendanceRate: 90 }] };
    mockQueries['academic.attendance.records'] = { data: [{ id: 'a1', date: '2026-09-07', status: 'ABSENT', sectionId: 's1' }] };
    await render(wrap(<AttendanceScreen {...props} />));
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0);
    expect(screen.getByText('9/10 buổi có mặt', { exact: false })).toBeOnTheScreen();
    expect(screen.getByLabelText(/Vắng/)).toBeOnTheScreen();
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });
});

describe('curriculum', () => {
  test('shows credits progress, requirements and the registration link', async () => {
    mockQueries['academic.curriculum'] = {
      data: {
        curriculum: { id: 'c', code: 'SE2026', name: 'Kỹ thuật phần mềm', totalCredits: 120 },
        courses: [
          { courseId: 'a', code: 'MA101', name: 'Giải tích', credits: 3, year: 1, semester: 1, isMandatory: true, status: 'COMPLETED' },
          { courseId: 'b', code: 'CS201', name: 'Cấu trúc dữ liệu', credits: 3, year: 1, semester: 2, isMandatory: true, status: 'NOT_STARTED', prerequisites: ['MA101'] },
        ],
      },
    };
    await render(wrap(<CurriculumScreen {...props} />));
    expect(screen.getByText('Tiên quyết: MA101')).toBeOnTheScreen();
    expect(screen.getByText('Năm 1 · Học kỳ 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Đăng ký học phần' }));
    expect(navigate).toHaveBeenCalledWith('registration');
    expect(auditTree(screen.toJSON() as never).violations).toEqual([]);
  });
});

describe('registration', () => {
  const pressSelect = async (code: string) => fireEvent.press(screen.getByRole('button', { name: `Chọn lớp: ${code} Lớp 01` }));
  const pressRegister = async () => fireEvent.press(screen.getByRole('button', { name: 'Đăng ký các lớp đã chọn' }));
  const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'SCHEDULE_CONFLICT' });

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
});
