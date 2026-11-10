import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { ScheduleScreen } from '../../src/screens/student/ScheduleScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

type QueryState = { data?: unknown; error?: string | null; isLoading?: boolean };

const mockQueries: Record<string, QueryState> = {};

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', get: jest.fn(async () => []), post: jest.fn() },
  campusApi: {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const match = Object.keys(mockQueries).find((name) => key === name || key.startsWith(`${name}.`));
    const state = (match ? mockQueries[match] : {}) as QueryState;
    return {
      data: state.data,
      error: state.error ?? null,
      warning: null,
      errorStatus: null,
      isLoading: state.isLoading ?? false,
      isStale: false,
      reload: jest.fn(async () => {}),
      setData: jest.fn(),
    };
  },
}));

function wrap(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

const course = (code: string, nameVi: string, nameEn: string, credits = 3) => ({
  code, name: nameVi, nameVi, nameEn, credits,
});

const enrollments = [
  {
    id: 'e1', sectionId: 's1', semesterId: 't2', status: 'ENROLLED',
    section: {
      sectionNumber: 'CS101-01',
      course: course('CS101', 'Nhập môn lập trình', 'Introduction to Programming'),
      lecturer: { fullName: 'TS. Trần' },
      schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '09:30', classroom: { building: 'A1', roomNumber: '101' } }],
    },
  },
  {
    id: 'e2', sectionId: 's2', semesterId: 't2', status: 'ENROLLED',
    section: {
      sectionNumber: '02',
      course: course('MA101', 'Giải tích', 'Calculus'),
      lecturer: { fullName: 'TS. Lê' },
      schedules: [{ dayOfWeek: 3, startTime: '08:00', endTime: '09:00', classroom: { building: 'B2', roomNumber: '201' } }],
    },
  },
  {
    id: 'e3', sectionId: 's3', semesterId: 't2', status: 'ENROLLED',
    section: {
      sectionNumber: '01',
      course: course('BA312', 'Phân tích kinh doanh', 'Business Analytics'),
      lecturer: { fullName: 'TS. Hà' },
      schedules: [{ dayOfWeek: 5, startTime: '13:30', endTime: '15:00', classroom: { building: 'C1', roomNumber: '12' } }],
    },
  },
  {
    id: 'e4', sectionId: 's4', semesterId: 't1', status: 'ENROLLED',
    section: {
      sectionNumber: '01',
      course: course('PH101', 'Vật lý', 'Physics'),
      schedules: [{ dayOfWeek: 4, startTime: '10:00', endTime: '11:30', classroom: { building: 'D1', roomNumber: '1' } }],
    },
  },
];

const semesters = [
  { id: 't1', name: 'HK1', startDate: '2026-01-05', endDate: '2026-05-30' },
  { id: 't2', name: 'HK2', startDate: '2026-09-01', endDate: '2026-12-31', status: 'IN_PROGRESS' },
];

afterEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
});

describe('schedule weekly grid', () => {
  test('the weekly grid tab places the same meetings on a day-by-period matrix', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));

    await fireEvent.press(screen.getByRole('tab', { name: 'Lưới tuần' }));

    expect(screen.getByLabelText('Lưới thời khóa biểu')).toBeOnTheScreen();
    expect(screen.getByText('Lịch học theo tuần')).toBeOnTheScreen();
    expect(screen.getByText('Bấm vào môn học để xem chi tiết đầy đủ')).toBeOnTheScreen();
    expect(screen.getByText('Giờ')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Tuần trước')).toBeNull();
    expect(screen.queryByText('PH101')).toBeNull();

    expect(screen.getByRole('button', { name: /CS101 Nhập môn lập trình, 07:00 – 09:30, A1-101/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /MA101 Giải tích, 08:00 – 09:00, B2-201/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /BA312 Phân tích kinh doanh, 13:30 – 15:00, C1-12/ })).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /CS101/ })).toHaveLength(1);
    expect(screen.getAllByText('CS101').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Sáng').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Chiều')).toBeOnTheScreen();
    expect(screen.getByText('T2')).toBeOnTheScreen();
    expect(screen.getByText('T5')).toBeOnTheScreen();

    const hour = screen.getByText('Giờ');
    expect(hour.props.numberOfLines).toBe(1);
    expect(hour.props.adjustsFontSizeToFit).toBe(true);
    const day = screen.getByText('T2');
    expect(day.props.numberOfLines).toBe(1);
    expect(day.props.adjustsFontSizeToFit).toBe(true);
    const shift = screen.getAllByText('Sáng')[0];
    expect(shift.props.numberOfLines).toBe(1);
    expect(shift.props.adjustsFontSizeToFit).toBe(true);

    const grid = screen.getByTestId('week-grid');
    expect(grid.props.horizontal).toBe(true);
  });

  test('opening a grid block shows the section, lecturer and full course title', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));

    await fireEvent.press(screen.getByRole('tab', { name: 'Lưới tuần' }));
    await fireEvent.press(screen.getByRole('button', { name: /CS101 Nhập môn lập trình, 07:00 – 09:30, A1-101/ }));

    expect(screen.getByText('Lớp học phần: CS101-01')).toBeOnTheScreen();
    expect(screen.getByText('Giảng viên: TS. Trần')).toBeOnTheScreen();
    expect(screen.getByText('3 tín chỉ')).toBeOnTheScreen();
    const title = screen.getByText('Nhập môn lập trình');
    expect(title.props.numberOfLines).toBeUndefined();
  });

  test('english weekly grid uses the web labels', async () => {
    mockQueries['academic.enrollments'] = { data: enrollments };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />, 'en'));

    await fireEvent.press(screen.getByRole('tab', { name: 'Weekly Grid' }));

    expect(screen.getByLabelText('Weekly timetable grid')).toBeOnTheScreen();
    expect(screen.getByText('Weekly agenda')).toBeOnTheScreen();
    expect(screen.getByText('Click on any class to view complete details')).toBeOnTheScreen();
    expect(screen.getByText('Hour')).toBeOnTheScreen();
    expect(screen.getAllByText('AM').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('PM')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /CS101 Introduction to Programming, 07:00 – 09:30, A1-101/ })).toBeOnTheScreen();
    expect(screen.getByText('Mon')).toBeOnTheScreen();
  });

  test('a registered section with no meetings keeps the empty grid copy', async () => {
    mockQueries['academic.enrollments'] = {
      data: [{ id: 'e9', sectionId: 's9', semesterId: 't2', status: 'ENROLLED', section: { sectionNumber: '01', course: course('CS101', 'Nhập môn lập trình', 'Introduction to Programming'), schedules: [] } }],
    };
    mockQueries['academic.semesters'] = { data: semesters };
    await render(wrap(<ScheduleScreen {...props} />));

    await fireEvent.press(screen.getByRole('tab', { name: 'Lưới tuần' }));
    expect(screen.getByText('Chưa có buổi học nào.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /CS101/ })).toBeNull();
  });
});
