import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  campusApi: {
    enrollments: jest.fn(async () => []),
    announcements: jest.fn(async () => ({ data: [] })),
    grades: jest.fn(async () => []),
    notifications: jest.fn(async () => ({ data: [] })),
    attendanceSummary: jest.fn(async () => []),
    profile: jest.fn(async () => null),
    registrationRounds: jest.fn(async () => []),
    registrationSections: jest.fn(async () => []),
    enroll: jest.fn(),
    dropEnrollment: jest.fn(),
    markNotificationRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({
    data: undefined,
    error: null,
    warning: null,
    isLoading: false,
    reload: jest.fn(),
    setData: jest.fn(),
  }),
}));

import {
  StudentDashboardScreen,
  CoursesScreen,
  GradesScreen,
  NotificationsScreen,
} from '../../src/screens/student/StudentScreens';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

function setWidth(width: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}
afterEach(() => { jest.restoreAllMocks(); });

const renderThemed = (el: ReactElement, scheme: 'light' | 'dark' = 'light') =>
  render(<ThemeProvider forcedScheme={scheme}>{el}</ThemeProvider>);

function rootBg() {
  const tree = screen.toJSON();
  const flat = StyleSheet.flatten(tree?.props.style);
  return flat?.backgroundColor;
}

describe('student screens (preview mode)', () => {
  test('dashboard renders header and actions at 360 width', async () => {
    setWidth(360);
    await renderThemed(<StudentDashboardScreen {...props} />);
    expect(screen.getByRole('header', { name: 'Tổng quan học tập' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Xem lịch học' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Hỏi trợ lý' })).toBeOnTheScreen();
  });

  test('dashboard background follows scheme', async () => {
    setWidth(360);
    await renderThemed(<StudentDashboardScreen {...props} />, 'light');
    expect(rootBg()).toBe(tokens.colors.background);
    await renderThemed(<StudentDashboardScreen {...props} />, 'dark');
    expect(rootBg()).toBe(tokens.colorsDark.background);
  });

  test('courses renders list; grid turns two-column on medium width', async () => {
    setWidth(360);
    await renderThemed(<CoursesScreen {...props} />);
    expect(screen.getByRole('header', { name: 'Học phần' })).toBeOnTheScreen();
    expect(screen.getByText('Software Architecture')).toBeOnTheScreen();
    const compact = screen.getByTestId('course-grid');
    expect(StyleSheet.flatten(compact.props.style)?.flexDirection).not.toBe('row');

    setWidth(700);
    await renderThemed(<CoursesScreen {...props} />);
    const medium = screen.getByTestId('course-grid');
    expect(StyleSheet.flatten(medium.props.style)?.flexDirection).toBe('row');
  });

  test('grades renders metrics and rows', async () => {
    setWidth(360);
    await renderThemed(<GradesScreen {...props} />);
    expect(screen.getByRole('header', { name: 'Điểm học kỳ' })).toBeOnTheScreen();
    expect(screen.getByText('Điểm trung bình (hệ 10)')).toBeOnTheScreen();
    expect(screen.getByText('CS204')).toBeOnTheScreen();
  });

  test('notifications renders rows and mark-all action', async () => {
    setWidth(360);
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.getByRole('header', { name: 'Notifications' })).toBeOnTheScreen();
    expect(screen.getByText('Thesis registration opens Monday')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeOnTheScreen();
  });
});
