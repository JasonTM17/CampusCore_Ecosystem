import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockLaneData: Record<string, unknown> = {};
const mockSession = { kind: 'preview', role: 'lecturer', capabilities: [] as string[] };

jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'preview' } }));
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../../src/navigation/router-adapter', () => ({ useMobileNavigation: () => ({ navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() }) }));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, isStale: false, reload: async () => {}, setData: () => {} }),
}));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useLocalSearchParams: () => ({}), useFocusEffect: (callback: () => void) => useEffect(callback, [callback]) };
});
jest.mock('../../src/screens/lanes/lane-ui', () => {
  const actual = jest.requireActual('../../src/screens/lanes/lane-ui') as Record<string, unknown>;
  return {
    ...actual,
    useLaneRequest: (_fetcher: unknown, key: string) => ({ data: mockLaneData[key], loading: false, error: null, failure: null, reload: async () => {} }),
  };
});
jest.mock('../../src/screens/operations/shared/preview', () => ({
  previewSchedule: [{
    sectionId: 'section-1', sectionNumber: '01', courseCode: 'CS101', courseNameEn: 'Software Engineering',
    courseNameVi: 'Kỹ thuật phần mềm', semesterId: 'term-1', semesterName: 'Fall 2026', enrolledCount: 1234, schedules: [],
  }],
  previewGrading: [{ sectionId: 'section-1', enrolledCount: 1234, gradedCount: 0 }],
  previewRoster: [{ studentId: 'student-1', studentCode: '21110123', firstName: 'An', lastName: 'Nguyen' }],
}));
jest.mock('../../src/screens/operations/lecturer-model', () => {
  const actual = jest.requireActual('../../src/screens/operations/lecturer-model') as Record<string, unknown>;
  return { ...actual, attendanceMetrics: () => ({ total: 1234, present: 1234, absent: 0, late: 0, excused: 0, rate: 100 }) };
});

import { DeanOverviewScreen } from '../../src/screens/lanes/DeanOverviewScreen';
import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { LecturerDashboardScreen } from '../../src/screens/operations/LecturerDashboardScreen';

const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'lecturer' } as MobileScreenProps;

const renderInLocale = (element: ReactElement, locale: 'vi' | 'en') => render(
  <LocaleProvider initialLocale={locale}>
    <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
  </LocaleProvider>,
);

beforeEach(() => {
  for (const key of Object.keys(mockLaneData)) delete mockLaneData[key];
  mockLaneData['dean:rounds'] = [{ id: 'round-1', name: 'Round 1', status: 'OPEN' }];
  mockLaneData['dean:overview:round-1'] = {
    stats: { totalGroups: 1234, groupsPendingApproval: 0, groupsApproved: 0, groupsRejected: 0, byDepartment: [] },
    supervisors: [],
    groups: [],
  };
});
afterEach(() => { jest.clearAllMocks(); });

describe('localized staff metrics', () => {
  const locales = [['en', '1,234'], ['vi', '1.234']] as const;

  test('dean overview groups the displayed total in each locale', async () => {
    for (const [locale, formatted] of locales) {
      const view = await renderInLocale(<DeanOverviewScreen />, locale);
      expect((await screen.findAllByText(formatted)).length).toBeGreaterThan(0);
      expect(screen.queryByText('1234')).toBeNull();
      await view.unmount();
    }
  });

  test('lecturer dashboard groups the displayed student metric in each locale', async () => {
    for (const [locale, formatted] of locales) {
      const view = await renderInLocale(<LecturerDashboardScreen {...props} />, locale);
      expect((await screen.findAllByText(formatted)).length).toBeGreaterThan(0);
      expect(screen.queryByText('1234')).toBeNull();
      await view.unmount();
    }
  });

  test('lecturer attendance groups the displayed roster metric in each locale', async () => {
    for (const [locale, formatted] of locales) {
      const view = await renderInLocale(<LecturerAttendanceScreen {...props} />, locale);
      expect((await screen.findAllByText(formatted)).length).toBeGreaterThan(0);
      expect(screen.queryByText('1234')).toBeNull();
      await view.unmount();
    }
  });
});
