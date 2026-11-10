import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: 'live' }; },
  campusApi: {},
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/hooks/useScreenQuery', () => {
  const { campusDayOfWeek } = require('../../src/i18n/locale') as typeof import('../../src/i18n/locale');
  const today = campusDayOfWeek();
  const otherDay = today === 7 ? 1 : today + 1;
  const schedule = [
    {
      sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204',
      courseNameVi: 'Kiến trúc phần mềm', courseNameEn: 'Software Architecture',
      semesterId: 'term-1', semesterName: 'HK1', enrolledCount: 16, capacity: 40, credits: 3,
      departmentNameVi: 'Khoa Công nghệ thông tin', departmentNameEn: 'Faculty of Information Technology',
      status: 'OPEN',
      schedules: [
        { id: 'slot-a-today', dayOfWeek: today, startTime: '08:00', endTime: '09:30', classroom: { building: 'A2', roomNumber: '204' } },
        { id: 'slot-a-other', dayOfWeek: otherDay, startTime: '13:30', endTime: '15:00', classroom: { building: 'A2', roomNumber: '205' } },
      ],
    },
    {
      sectionId: 'section-b', sectionNumber: '02', courseCode: 'BA312',
      courseNameVi: 'Phân tích kinh doanh', courseNameEn: 'Business Analytics',
      semesterId: 'term-1', semesterName: 'HK1', enrolledCount: 18, capacity: 35, credits: 3,
      departmentNameVi: 'Khoa Quản trị kinh doanh', departmentNameEn: 'Faculty of Business Administration',
      status: 'CLOSED',
      schedules: [
        { id: 'slot-b-other', dayOfWeek: otherDay, startTime: '09:00', endTime: '10:30', classroom: { building: 'B1', roomNumber: '108' } },
      ],
    },
  ];
  return {
    useScreenQuery: () => ({
      data: schedule,
      error: null,
      warning: null,
      errorStatus: null,
      isLoading: false,
      isStale: false,
      reload: jest.fn(async () => {}),
      setData: jest.fn(),
    }),
  };
});

import { LecturerScheduleScreen } from '../../src/screens/operations/LecturerScheduleScreen';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'lecturer' } as MobileScreenProps;
const renderScreen = () => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">
      <LecturerScheduleScreen {...props} />
    </LocaleProvider>
  </ThemeProvider>,
);

test('today is marked on the meeting that falls on the current day', async () => {
  await renderScreen();
  expect(screen.getByText('CỔNG GIẢNG VIÊN')).toBeOnTheScreen();
  expect(screen.getByText('Thời khóa biểu giảng dạy và lịch công tác học kỳ của giảng viên.')).toBeOnTheScreen();
  expect(screen.getAllByText('HÔM NAY').length).toBeGreaterThanOrEqual(1);
});

test('section details show department, credits, capacity and status', async () => {
  await renderScreen();
  await fireEvent.press(screen.getByRole('tab', { name: 'Danh sách' }));
  await fireEvent.press(screen.getAllByRole('button', { name: 'Chi tiết' })[0]);
  expect(screen.getByRole('header', { name: 'Chi tiết lớp học phần' })).toBeOnTheScreen();
  expect(screen.getByText('Lớp HP')).toBeOnTheScreen();
  expect(screen.getByText('Khoa / Bộ môn')).toBeOnTheScreen();
  expect(screen.getByText('Khoa Công nghệ thông tin')).toBeOnTheScreen();
  expect(screen.getByText('Số tín chỉ')).toBeOnTheScreen();
  expect(screen.getByText('3 tín chỉ')).toBeOnTheScreen();
  expect(screen.getByText('Sĩ số đăng ký')).toBeOnTheScreen();
  expect(screen.getByText('16/40 sinh viên')).toBeOnTheScreen();
  expect(screen.getByText('Đang mở')).toBeOnTheScreen();
});

test('the day view reuses the week strip and shows only the selected day', async () => {
  await renderScreen();
  expect(screen.getByText('BA312')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('tab', { name: 'Theo ngày' }));
  expect(screen.getByTestId('week-strip')).toBeOnTheScreen();
  expect(screen.getByText('CS204')).toBeOnTheScreen();
  expect(screen.queryByText('BA312')).toBeNull();
});
