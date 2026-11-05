import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  campusApi: new Proxy({}, { get: () => jest.fn(async () => ({ data: [] })) }),
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'preview', role: 'student', capabilities: [] }),
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(), setData: jest.fn() }),
}));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useLocalSearchParams: () => ({}),
    usePathname: () => '/dashboard',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});

import { StudentDashboardScreen } from '../../src/screens/student/StudentDashboardScreen';
import { ScheduleScreen } from '../../src/screens/student/ScheduleScreen';
import { CoursesScreen } from '../../src/screens/student/CoursesScreen';
import { GradesScreen } from '../../src/screens/student/GradesScreen';
import { RegistrationScreen } from '../../src/screens/student/RegistrationScreen';
import { EventsScreen } from '../../src/screens/student/EventsScreen';
import { LibraryScreen } from '../../src/screens/student/LibraryScreen';
import { CareersScreen } from '../../src/screens/student/CareersScreen';
import { AdmissionsScreen } from '../../src/screens/student/AdmissionsScreen';
import { NewsScreen } from '../../src/screens/student/NewsScreen';
import { DocsScreen } from '../../src/screens/student/DocsScreen';
import { NotificationsScreen } from '../../src/screens/student/NotificationsScreen';
import { ProfileScreen } from '../../src/screens/student/ProfileScreen';
import { LearningScreen } from '../../src/screens/student/LearningScreen';
import { AttendanceScreen } from '../../src/screens/student/AttendanceScreen';

const navigation = {
  navigate: jest.fn(),
  navigateLane: jest.fn(),
  goBack: jest.fn(),
  signOut: jest.fn(),
} as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

const studentScreens: ReadonlyArray<{ name: string; render: () => ReactElement }> = [
  { name: 'dashboard', render: () => <StudentDashboardScreen {...props} /> },
  { name: 'schedule', render: () => <ScheduleScreen {...props} /> },
  { name: 'courses', render: () => <CoursesScreen {...props} /> },
  { name: 'grades', render: () => <GradesScreen {...props} /> },
  { name: 'registration', render: () => <RegistrationScreen {...props} /> },
  { name: 'events', render: () => <EventsScreen {...props} /> },
  { name: 'library', render: () => <LibraryScreen {...props} /> },
  { name: 'careers', render: () => <CareersScreen {...props} /> },
  { name: 'admissions', render: () => <AdmissionsScreen {...props} /> },
  { name: 'news', render: () => <NewsScreen {...props} /> },
  { name: 'docs', render: () => <DocsScreen {...props} /> },
  { name: 'notifications', render: () => <NotificationsScreen {...props} /> },
  { name: 'profile', render: () => <ProfileScreen {...props} /> },
  { name: 'learning', render: () => <LearningScreen {...props} /> },
  { name: 'attendance', render: () => <AttendanceScreen {...props} /> },
];

const windows = [
  { width: 360, height: 800 },
  { width: 393, height: 852 },
  { width: 600, height: 360 },
  { width: 700, height: 1100 },
  { width: 839, height: 360 },
  { width: 840, height: 1180 },
  { width: 1024, height: 600 },
] as const;

afterEach(() => { jest.restoreAllMocks(); });

describe('student screens across supported window classes', () => {
  for (const studentScreen of studentScreens) {
    test(`${studentScreen.name} renders across window and font scales`, async () => {
      const getDimensions = jest.spyOn(Dimensions, 'get');

      for (const window of windows) {
        for (const fontScale of [1, 1.3, 2]) {
          getDimensions.mockReturnValue({ ...window, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
          const view = await render(
            <ThemeProvider forcedScheme="light">
              <LocaleProvider initialLocale="vi">{studentScreen.render()}</LocaleProvider>
            </ThemeProvider>,
          );
          expect(view.getAllByRole('header').length).toBeGreaterThan(0);
          await view.unmount();
        }
      }
    });
  }
});
