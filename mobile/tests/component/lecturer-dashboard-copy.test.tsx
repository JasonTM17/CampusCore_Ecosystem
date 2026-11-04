import { expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: 'live' }; },
  campusApi: {},
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/screens/lanes/LaneEntries', () => ({ LaneEntries: () => null }));
jest.mock('../../src/hooks/useScreenQuery', () => {
  const day = new Date().getDay() + 1;
  const schedule = [
    {
      sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204',
      courseNameVi: 'Kiến trúc phần mềm', courseNameEn: 'Software Architecture',
      semesterId: 'term-1', enrolledCount: 16,
      schedules: [{ id: 'slot-a', dayOfWeek: day, startTime: '08:00', endTime: '09:30', classroom: { building: 'A2', roomNumber: '204' } }],
    },
    {
      sectionId: 'section-b', sectionNumber: '02', courseCode: 'BA312',
      courseNameVi: 'Phân tích kinh doanh', courseNameEn: 'Business Analytics',
      semesterId: 'term-1', enrolledCount: 18,
      schedules: [{ id: 'slot-b', dayOfWeek: day, startTime: '13:30', endTime: '15:00', classroom: { building: 'B1', roomNumber: '108' } }],
    },
  ];
  const grading = [
    { sectionId: 'section-a', sectionNumber: '01', courseCode: 'CS204', semesterId: 'term-1', enrolledCount: 16, gradedCount: 16, publishedCount: 0, canPublish: true, gradeStatus: 'DRAFT' },
    { sectionId: 'section-b', sectionNumber: '02', courseCode: 'BA312', semesterId: 'term-1', enrolledCount: 18, gradedCount: 18, publishedCount: 18, canPublish: false, gradeStatus: 'PUBLISHED' },
  ];
  return {
    useScreenQuery: (key: string) => ({
      data: key === 'lecturer:schedule' ? schedule : grading,
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

test('the Vietnamese dashboard has one page title, one Today and one class count', async () => {
  await renderScreen('vi');
  expect(screen.getByRole('header', { name: 'Tổng quan giảng viên' })).toBeOnTheScreen();
  expect(screen.getAllByText('Hôm nay')).toHaveLength(1);
  expect(screen.getAllByText('2 lớp giảng dạy hôm nay')).toHaveLength(1);
  expect(screen.queryByText(/lớp hôm nay ·/)).toBeNull();
});

test('the English dashboard has one page title, one Today and one class count', async () => {
  await renderScreen('en');
  expect(screen.getByRole('header', { name: 'Teaching overview' })).toBeOnTheScreen();
  expect(screen.getAllByText('Today')).toHaveLength(1);
  expect(screen.getAllByText('2 classes scheduled today')).toHaveLength(1);
  expect(screen.queryByText(/classes today ·/)).toBeNull();
});
