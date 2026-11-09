import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider, useLocale } from '../../src/i18n/locale-provider';
import { academicMessages } from '../../src/i18n/academic-messages';

const mockShareTimetable = jest.fn(async (_uri: string, _name: string) => ({ status: 'done' as const }));
const mockSaveRegistrationSlip = jest.fn(async (_semesterId: string | null) => ({ status: 'done' as const }));
const mockIsDeviceOffline = jest.fn(async () => false);

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live' },
  campusApi: {
    enrollments: jest.fn(async () => []),
    grades: jest.fn(async () => []),
    transcript: jest.fn(async () => ({})),
    attendanceSummary: jest.fn(async () => []),
    registrationRounds: jest.fn(async () => []),
    registrationSections: jest.fn(async () => []),
  },
}));

jest.mock('../../src/screens/academic/academic-api', () => ({
  apiClient: { mode: 'live' },
  shareTimetable: (...args: [string, string]) => mockShareTimetable(...args),
  timetableShareCapability: () => ({ available: true }),
  saveRegistrationSlip: (semesterId: string | null) => mockSaveRegistrationSlip(semesterId),
  isDeviceOffline: () => mockIsDeviceOffline(),
  dropEnrollmentById: jest.fn(),
  enrollInSection: jest.fn(),
  isOfflineError: () => false,
}));

jest.mock('../../src/files/file-adapter', () => ({
  getFileAdapter: () => ({ capability: () => ({ available: true }) }),
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({ useScreenQuery: jest.fn() }));

import { ScheduleExport } from '../../src/screens/academic/ScheduleExport';
import { SlipRow } from '../../src/screens/academic/SlipRow';
import { useRegistrationActions } from '../../src/screens/academic/useRegistrationActions';

function LocaleSwitcher() {
  const { setLocale } = useLocale();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Switch to English" onPress={() => setLocale('en')}>
      <Text>Switch</Text>
    </Pressable>
  );
}

function withLocale(ui: ReactElement) {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">
        <LocaleSwitcher />
        {ui}
      </LocaleProvider>
    </ThemeProvider>
  );
}

const enrollments = [{
  id: 'enrollment-1',
  sectionId: 'section-1',
  semesterId: 'semester-1',
  status: 'ENROLLED',
  section: {
    sectionNumber: '01',
    course: { code: 'CS101', nameVi: 'Nhập môn lập trình', nameEn: 'Introduction to Programming', credits: 3 },
    schedules: [{ dayOfWeek: 2, startTime: '07:00', endTime: '08:00' }],
  },
}];

function RegistrationNoticeHarness() {
  const { locale } = useLocale();
  const actions = useRegistrationActions({
    copy: academicMessages[locale],
    locale,
    preview: false,
    knownOffline: true,
    reload: async () => {},
    catalogIds: [],
    roundOpen: true,
  });
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Register while offline" onPress={() => void actions.registerSelected()}>
        <Text>Register</Text>
      </Pressable>
      {actions.notice ? <Text>{actions.notice.text}</Text> : null}
    </>
  );
}

describe('localized academic state', () => {
  test('timetable export feedback follows a locale switch', async () => {
    mockShareTimetable.mockClear();
    await render(withLocale(<ScheduleExport enrollments={enrollments} semester={{ id: 'semester-1', startDate: '2026-09-01', endDate: '2026-12-31' }} />));
    await fireEvent.press(screen.getByRole('button', { name: /Xuất lịch/ }));
    expect(await screen.findByText('Đã chia sẻ lịch học')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Switch to English' }));
    expect(screen.getByText('Timetable shared')).toBeOnTheScreen();
    expect(screen.queryByText('Đã chia sẻ lịch học')).toBeNull();
  });

  test('registration slip feedback follows a locale switch', async () => {
    mockSaveRegistrationSlip.mockClear();
    await render(withLocale(<SlipRow semesterId="semester-1" />));
    await fireEvent.press(screen.getByRole('button', { name: /Xuất phiếu/ }));
    expect(await screen.findByText('Đã lưu phiếu đăng ký')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Switch to English' }));
    expect(screen.getByText('Registration slip saved')).toBeOnTheScreen();
    expect(screen.queryByText('Đã lưu phiếu đăng ký')).toBeNull();
  });

  test('registration notices follow a locale switch', async () => {
    mockIsDeviceOffline.mockClear();
    await render(withLocale(<RegistrationNoticeHarness />));
    await fireEvent.press(screen.getByRole('button', { name: 'Register while offline' }));
    expect(screen.getByText('Không có kết nối. Chưa thể đăng ký hoặc rút lớp.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Switch to English' }));
    expect(screen.getByText('No connection. You cannot register or drop right now.')).toBeOnTheScreen();
    expect(screen.queryByText('Không có kết nối. Chưa thể đăng ký hoặc rút lớp.')).toBeNull();
  });
});
