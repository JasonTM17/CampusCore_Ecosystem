import { expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { operationsMessages } from '../../src/i18n/operations-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: 'live' }; },
  campusApi: {},
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/screens/lanes/LaneEntries', () => ({ LaneEntries: () => null }));
jest.mock('../../src/hooks/useScreenQuery', () => {
  const schedule = [
    {
      sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204',
      courseNameVi: 'Kiến trúc phần mềm', courseNameEn: 'Software Architecture',
      semesterId: 'term-1', semesterName: 'HK1', enrolledCount: 16, capacity: 40, credits: 3,
      departmentNameVi: 'Khoa Công nghệ thông tin', departmentNameEn: 'Faculty of Information Technology',
      status: 'OPEN',
      schedules: [{ id: 'slot-a', dayOfWeek: 2, startTime: '08:00', endTime: '09:30', classroom: { building: 'A2', roomNumber: '204' } }],
    },
    {
      sectionId: 'section-b', sectionNumber: '02', courseCode: 'BA312',
      courseNameVi: 'Phân tích kinh doanh', courseNameEn: 'Business Analytics',
      semesterId: 'term-1', semesterName: 'HK1', enrolledCount: 18, capacity: 35, credits: 3,
      departmentNameVi: 'Khoa Quản trị kinh doanh', departmentNameEn: 'Faculty of Business Administration',
      status: 'CLOSED',
      schedules: [{ id: 'slot-b', dayOfWeek: 3, startTime: '13:30', endTime: '15:00', classroom: { building: 'B1', roomNumber: '108' } }],
    },
  ];
  const grading = [
    { sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204', courseNameVi: 'Kiến trúc phần mềm', courseNameEn: 'Software Architecture', semesterId: 'term-1', semester: 'HK1', semesterName: 'HK1', semesterNameVi: 'Học kỳ 1', semesterNameEn: 'Semester 1', enrolledCount: 16, gradedCount: 16, publishedCount: 0, canPublish: true, gradeStatus: 'DRAFT' },
    { sectionId: 'section-b', sectionNumber: '02', courseCode: 'BA312', courseNameVi: 'Phân tích kinh doanh', courseNameEn: 'Business Analytics', semesterId: 'term-1', semester: 'HK1', semesterName: 'HK1', semesterNameVi: 'Học kỳ 1', semesterNameEn: 'Semester 1', enrolledCount: 18, gradedCount: 9, publishedCount: 0, canPublish: false, gradeStatus: 'DRAFT' },
  ];
  const announcements = {
    data: [{ id: 'notice-1', title: 'Lịch thi học kỳ', content: '<p>Xem lịch thi mới.</p>', createdAt: '2026-11-01T08:00:00Z' }],
    meta: { total: 3 },
  };
  const profile = { id: 'user-1', firstName: 'Minh' };
  return {
    useScreenQuery: (key: string) => ({
      data: key === 'lecturer:schedule'
        ? schedule
        : key === 'lecturer:grading'
          ? grading
          : key === 'lecturer:announcements'
            ? announcements
            : key === 'lecturer:profile'
              ? profile
              : undefined,
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

import { LecturerDashboardScreen } from '../../src/screens/operations/LecturerDashboardScreen';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'lecturer' } as MobileScreenProps;
const renderScreen = (locale: 'vi' | 'en') => render(
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale={locale}>
      <LecturerDashboardScreen {...props} />
    </LocaleProvider>
  </ThemeProvider>,
);

const textOrder = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOrder);
  if (node && typeof node === 'object' && 'children' in node) {
    return textOrder((node as { children?: unknown }).children);
  }
  return [];
};

test('the dashboard greets the lecturer and shows the web metric set', async () => {
  await renderScreen('vi');
  expect(screen.getByRole('header', { name: 'Chào mừng quay lại, Minh' })).toBeOnTheScreen();
  expect(screen.getByText('CỔNG GIẢNG VIÊN')).toBeOnTheScreen();
  expect(screen.queryByText('Giữ công việc lớp học, hàng chờ chấm điểm và cập nhật giảng dạy trong cùng Cổng Giảng viên.')).toBeNull();
  expect(screen.getByLabelText('Lớp học phần: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText('Sinh viên: 34')).toBeOnTheScreen();
  expect(screen.getByLabelText('Sẵn sàng công bố: 1')).toBeOnTheScreen();
  expect(screen.getByLabelText('Thông báo mới: 3')).toBeOnTheScreen();
});

test('the dashboard lists grading progress with the ready-to-publish state', async () => {
  await renderScreen('vi');
  expect(screen.getByRole('header', { name: 'Hàng chờ chấm điểm' })).toBeOnTheScreen();
  expect(screen.getByText('Lớp học phần 01 - Học kỳ 1')).toBeOnTheScreen();
  expect(screen.getByText('16/16 đã chấm')).toBeOnTheScreen();
  expect(screen.getByText('9/18 đã chấm')).toBeOnTheScreen();
  expect(screen.getAllByText('Sẵn sàng công bố').length).toBeGreaterThan(0);
  expect(screen.getByText('Đang xử lý')).toBeOnTheScreen();
});

test('sections in scope show capacity, department and section status', async () => {
  await renderScreen('vi');
  expect(screen.getByRole('header', { name: 'Các lớp đang phụ trách' })).toBeOnTheScreen();
  expect(screen.getByText('Lớp học phần 01 - Khoa Công nghệ thông tin')).toBeOnTheScreen();
  expect(screen.getByText('Lớp học phần 02 - Khoa Quản trị kinh doanh')).toBeOnTheScreen();
  expect(screen.getByText('16/40 sinh viên')).toBeOnTheScreen();
  expect(screen.getByText('18/35 sinh viên')).toBeOnTheScreen();
  expect(screen.getByText('Đang mở')).toBeOnTheScreen();
  expect(screen.getByText('Đã đóng')).toBeOnTheScreen();
});

test('the latest announcements feed shows the notice and its plain body', async () => {
  await renderScreen('vi');
  expect(screen.getByRole('header', { name: 'Thông báo mới nhất' })).toBeOnTheScreen();
  expect(screen.getByText('Lịch thi học kỳ')).toBeOnTheScreen();
  expect(screen.getByText('Xem lịch thi mới.')).toBeOnTheScreen();
});

test('the native Today hero stays below the web dashboard panels', async () => {
  await renderScreen('vi');
  expect(screen.getByText('Hôm nay')).toBeOnTheScreen();
  const order = textOrder(screen.toJSON());
  expect(order.indexOf('Thông báo mới nhất')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('Hôm nay')).toBeGreaterThan(order.indexOf('Thông báo mới nhất'));
});

test('the English dashboard uses the web wording for the added blocks', async () => {
  await renderScreen('en');
  expect(screen.getByRole('header', { name: 'Welcome back, Minh' })).toBeOnTheScreen();
  expect(screen.getByText('LECTURER AREA')).toBeOnTheScreen();
  expect(screen.queryByText('Keep class work, grading queues, and teaching updates in one lecturer-focused area.')).toBeNull();
  expect(screen.getByLabelText('Sections: 2')).toBeOnTheScreen();
  expect(screen.getByLabelText('Students: 34')).toBeOnTheScreen();
  expect(screen.getByLabelText('Ready to publish: 1')).toBeOnTheScreen();
  expect(screen.getByLabelText('Fresh notices: 3')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Grading queue' })).toBeOnTheScreen();
  expect(screen.getByText('Class 01 - Semester 1')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Sections in scope' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Latest announcements' })).toBeOnTheScreen();
  expect(screen.getByText('Materials & Assignments')).toBeOnTheScreen();
});
