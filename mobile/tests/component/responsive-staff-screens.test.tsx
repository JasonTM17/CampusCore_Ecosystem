import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  campusApi: new Proxy({}, { get: () => jest.fn(async () => ({ data: [] })) }),
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useLocalSearchParams: () => mockSectionParams,
    usePathname: () => '/dashboard',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'preview', role: 'admin', capabilities: [] }),
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
jest.mock('../../src/screens/lanes/lane-api', () => ({
  LANE_PAGE_SIZE: 20,
  laneApi: {
    analytics: jest.fn(async () => ({
      totals: { students: 100, lecturers: 10, courses: 20, enrollments: 50 },
      gradeDistribution: [{ grade: 'A', count: 20 }, { grade: 'B', count: 30 }],
      departments: [{ code: 'CNTT', students: 50 }],
      semesterTrends: [{ semester: 'HK1', completionRate: 85 }],
    })),
  },
}));

import { AdminOverviewScreen } from '../../src/screens/lanes/AdminOverviewScreen';
import { LecturerScheduleScreen } from '../../src/screens/operations/LecturerScheduleScreen';
import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { AdminStudentsScreen, AdminLecturersScreen } from '../../src/screens/operations/AdminScreens';
import { AssistantComposer } from '../../src/screens/assistant/AssistantComposer';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn(), navigateLane: jest.fn(), goBack: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'lecturer' } as MobileScreenProps;
let mockSectionParams: { sectionId?: string } = {};

function setWindow(width: number, height = 800, fontScale = 1) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({
    width,
    height,
    scale: 2,
    fontScale,
  } as ReturnType<typeof Dimensions.get>);
}

afterEach(() => {
  mockSectionParams = {};
  jest.restoreAllMocks();
});

function renderThemed(element: ReactElement) {
  return render(
    <LocaleProvider initialLocale="vi">
      <ThemeProvider forcedScheme="light">{element}</ThemeProvider>
    </LocaleProvider>,
  );
}

describe('responsive staff screens and assistant layout', () => {
  test('Finding 1: AdminOverviewScreen charts use ResponsiveGrid 2-column layout on expanded window', async () => {
    setWindow(1000);
    await renderThemed(<AdminOverviewScreen {...props} />);

    const charts = screen.getAllByRole('image');
    expect(charts.length).toBeGreaterThanOrEqual(3);

    // Each chart should be placed in a 48% width cell within ResponsiveGrid
    for (const chart of charts.slice(0, 3)) {
      const parentStyle = StyleSheet.flatten(chart.parent?.props.style);
      expect(parentStyle?.width).toBe('48%');
    }
  });

  test('Finding 2: LecturerScheduleScreen cards adapt to 2-column grid on expanded window', async () => {
    setWindow(1000);
    await renderThemed(<LecturerScheduleScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Danh sách' }));

    const cardHeader = screen.getByRole('header', { name: 'Kiến trúc phần mềm' });
    const firstCard = cardHeader.parent?.parent?.parent;
    const cardStyle = StyleSheet.flatten(firstCard?.props.style);
    expect(cardStyle?.width).toBe('48.5%');
  });

  test('Finding 3: AdminStudentsScreen directory list uses 2-column grid on expanded window', async () => {
    setWindow(1000);
    await renderThemed(<AdminStudentsScreen />);

    // In preview mode, student directory cards should be 48.5% width on tablet
    const button = screen.getByRole('button', { name: /Nguyễn Đức Minh/i });
    const card = button.parent;
    const cardStyle = StyleSheet.flatten(card?.props.style);
    expect(cardStyle?.width).toBe('48.5%');
  });

  test('Finding 4: AdminStudentsScreen student name in directoryTop has flex: 1 and minWidth: 0 next to StatusPill', async () => {
    setWindow(360, 800, 1.3);
    await renderThemed(<AdminStudentsScreen />);

    const nameText = screen.getByText('Nguyễn Đức Minh');
    const style = StyleSheet.flatten(nameText.props.style);
    expect(style).toMatchObject({ flex: 1, minWidth: 0 });
  });

  test('Finding 5: AssistantComposer wraps inner controls in ResponsiveContent with centered max width on expanded window', async () => {
    setWindow(1000);
    const mockChat = {
      copy: {
        composerLabel: 'Nhập tin nhắn',
        composerPlaceholder: 'Hỏi...',
        characters: '{count}/{max}',
        send: 'Gửi',
        stop: 'Dừng',
      },
      draft: '',
      busy: false,
      notice: null,
      setDraft: jest.fn(),
      attachDraftSetter: jest.fn(),
      send: jest.fn(),
      stop: jest.fn(),
    };

    await renderThemed(<AssistantComposer chat={mockChat as never} />);

    // Inner container wrapping the field and send button must be constrained to contentMaxWidth.expanded (960)
    const sendButton = screen.getByRole('button', { name: 'Gửi' });
    const actionsRow = sendButton.parent;
    const responsiveWrap = actionsRow?.parent;
    const wrapStyle = StyleSheet.flatten(responsiveWrap?.props.style);
    expect(wrapStyle?.maxWidth).toBe(tokens.windowClasses.contentMaxWidth.expanded);
    expect(wrapStyle?.alignSelf).toBe('center');
  });

  test('Finding 6: AssistantComposer restricts input maxHeight on landscape phone', async () => {
    setWindow(800, 360); // landscape: width 800 > height 360
    const mockChat = {
      copy: {
        composerLabel: 'Nhập tin nhắn',
        composerPlaceholder: 'Hỏi...',
        characters: '{count}/{max}',
        send: 'Gửi',
        stop: 'Dừng',
      },
      draft: '',
      busy: false,
      notice: null,
      setDraft: jest.fn(),
      attachDraftSetter: jest.fn(),
      send: jest.fn(),
      stop: jest.fn(),
    };

    await renderThemed(<AssistantComposer chat={mockChat as never} />);

    // In landscape mode, input Field maxHeight should be <= 80 to fit above the keyboard
    const input = screen.getByPlaceholderText('Hỏi...');
    const fieldContainer = input.parent;
    const fieldStyle = StyleSheet.flatten(fieldContainer?.props.style);
    expect(fieldStyle?.maxHeight).toBeLessThanOrEqual(80);
  });

  test('Finding 7: LecturerScheduleScreen action buttons have flexGrow: 1 to fill row width evenly', async () => {
    setWindow(360);
    await renderThemed(<LecturerScheduleScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Danh sách' }));

    const attendanceBtns = screen.getAllByRole('button', { name: /Điểm danh/i });
    expect(attendanceBtns.length).toBeGreaterThan(0);
    const btnStyle = StyleSheet.flatten(attendanceBtns[0].props.style);
    expect(btnStyle?.flexGrow).toBe(1);
  });

  test('attendance follows a changed section route parameter while mounted', async () => {
    mockSectionParams = { sectionId: 'preview-cs204' };
    const view = await renderThemed(<LecturerAttendanceScreen {...props} />);

    expect(screen.getByRole('button', { name: 'Lớp học phần: CS204 · Lớp 02' })).toBeOnTheScreen();
    mockSectionParams = { sectionId: 'preview-ba312' };
    await view.rerender(
      <LocaleProvider initialLocale="vi">
        <ThemeProvider forcedScheme="light"><LecturerAttendanceScreen {...props} /></ThemeProvider>
      </LocaleProvider>,
    );

    expect(screen.getByRole('button', { name: 'Lớp học phần: BA312 · Lớp 01' })).toBeOnTheScreen();
  });

  test('section picker selection is preserved when mounted with a sectionId route parameter', async () => {
    mockSectionParams = { sectionId: 'preview-cs204' };
    await renderThemed(<LecturerAttendanceScreen {...props} />);

    expect(screen.getByRole('button', { name: 'Lớp học phần: CS204 · Lớp 02' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Lớp học phần: CS204 · Lớp 02' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'BA312 · Lớp 01' }));

    expect(screen.getByRole('button', { name: 'Lớp học phần: BA312 · Lớp 01' })).toBeOnTheScreen();
  });
});
