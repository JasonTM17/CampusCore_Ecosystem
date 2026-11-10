import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Dimensions, StyleSheet } from 'react-native';

import { AppBar } from '../../src/components/AppBar';
import { BottomNavigation } from '../../src/components/BottomNavigation';
import { SearchBar, searchFieldFontScaleCap } from '../../src/components/ui/primitives';
import { chromeFontScaleCap } from '../../src/design/font-scale';
import { ThemeProvider } from '../../src/design/theme';
import { campusMessages } from '../../src/i18n/campus-messages';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';
import { GuestHomeScreen } from '../../src/screens/guest/GuestHomeScreen';
import { GradesScreen } from '../../src/screens/student/GradesScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockApi = { mode: 'live' as 'preview' | 'live' };
jest.mock('../../src/api/client', () => ({
  get apiClient() { return { mode: mockApi.mode }; },
}));
jest.mock('../../src/screens/content/content-api', () => ({
  contentApi: { news: jest.fn(), docs: jest.fn() },
}));
jest.mock('../../src/screens/content/use-paged-list', () => ({
  usePagedList: () => ({
    items: [],
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
    warning: null,
    loadMoreError: null,
    errorStatus: null,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    reload: jest.fn(async () => {}),
  }),
}));
jest.mock('../../src/session/SessionContext', () => ({ useOptionalSession: () => null }));
const mockQueries: Record<string, { data?: unknown }> = {
  'academic.grades': {
    data: [{ id: 'g1', courseCode: 'MA101', courseName: 'Giải tích', credits: 3, finalGrade: 8.2, letterGrade: 'B+', gradeStatus: 'PUBLISHED', semesterId: 't1', semester: 'HK1' }],
  },
  'academic.transcript': {
    data: {
      semesters: [
        {
          semesterId: 't2',
          semesterName: 'HK2',
          semesterNameVi: 'Học kỳ 2 năm học 2026-2027',
          semesterNameEn: 'Semester 2 academic year 2026-2027',
          gpa: 3.1,
          creditsEarned: 9,
          creditsAttempted: 9,
          records: [],
        },
      ],
    },
  },
  'academic.semesters': { data: [] },
};

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const state = mockQueries[key] ?? {};
    return {
      data: state.data,
      error: null,
      warning: null,
      errorStatus: null,
      isLoading: false,
      isStale: false,
      reload: jest.fn(),
      setData: jest.fn(),
    };
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaInsetsContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(() => {
  mockApi.mode = 'live';
  jest.restoreAllMocks();
});

function wrap(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return (
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>
  );
}

function setFontScale(fontScale: number, width = 360) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale });
}

const guestProps = { navigation: { navigate: jest.fn() } } as unknown as MobileScreenProps;
const gradesProps = { navigation: { navigate: jest.fn() }, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;

describe('Q-001 guest wordmark', () => {
  test('keeps CampusUTE on one line with font scaling', async () => {
    await render(wrap(<GuestHomeScreen {...guestProps} />));
    const wordmark = screen.getAllByText('CampusUTE')[0];
    expect(wordmark.props.numberOfLines).toBe(1);
    expect(wordmark.props.adjustsFontSizeToFit).toBe(true);
    expect(wordmark.props.minimumFontScale).toBeGreaterThanOrEqual(0.7);
  });
});

describe('Q-002 app bar role', () => {
  test('keeps the role pill label on one line with font scaling', async () => {
    mockApi.mode = 'live';
    setFontScale(1);
    await render(wrap(<AppBar role="lecturer" onProfile={() => {}} />));
    const role = screen.getByText(shellMessages.vi.roles.lecturer);
    expect(role.props.numberOfLines).toBe(1);
    expect(role.props.adjustsFontSizeToFit).toBe(true);
  });

  test('stacks the role under the wordmark at large system font scale', async () => {
    mockApi.mode = 'live';
    setFontScale(chromeFontScaleCap);
    await render(wrap(<AppBar role="student" onProfile={() => {}} />));
    const wordmark = screen.getByText('CampusUTE');
    expect(wordmark.parent?.children).toContainEqual(expect.objectContaining({
      props: expect.objectContaining({ children: shellMessages.vi.roles.student }),
    }));
  });
});

describe('Q-008 lecturer tab label', () => {
  test('keeps Gradebook on one line with font scaling', async () => {
    setFontScale(1, 360);
    await render(wrap(
      <BottomNavigation activeRoute="lecturer.dashboard" role="lecturer" onNavigate={() => {}} onMenu={() => {}} />,
      'en',
    ));
    const label = screen.getByText('Gradebook');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.minimumFontScale).toBeLessThan(1);
  });
});

describe('Q-004 grades term title', () => {
  test('allows the progress strip term name to wrap to three lines', async () => {
    await render(wrap(<GradesScreen {...gradesProps} />));
    const term = screen.getByText('Học kỳ 2 năm học 2026-2027');
    expect(term.props.numberOfLines).toBe(3);
  });
});

describe('Q-005 search placeholder', () => {
  test('lets the search field shrink on a narrow row', async () => {
    const placeholder = campusMessages.vi.searchPlaceholder;
    await render(wrap(<SearchBar value="" onChangeText={() => {}} placeholder={placeholder} />));
    const input = screen.getByLabelText(placeholder);
    expect(input.props.maxFontSizeMultiplier).toBe(searchFieldFontScaleCap);
    const style = StyleSheet.flatten(input.props.style);
    expect(style.flexShrink).toBe(1);
    expect(style.minWidth).toBe(0);
  });
});
