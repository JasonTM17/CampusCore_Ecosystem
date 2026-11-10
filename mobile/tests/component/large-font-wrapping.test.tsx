import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Dimensions, StyleSheet } from 'react-native';

import { AppBar } from '../../src/components/AppBar';
import { FileRow } from '../../src/components/ui/file-row';
import { SearchBar, SegmentedControl, searchFieldFontScaleCap } from '../../src/components/ui/primitives';
import { chromeFontScaleCap } from '../../src/design/font-scale';
import { ThemeProvider } from '../../src/design/theme';
import { campusMessages } from '../../src/i18n/campus-messages';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { shellMessages } from '../../src/i18n/shell-messages';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';
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
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
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
            {
              semesterId: 't1',
              semesterName: 'HK1',
              semesterNameVi: 'Học kỳ 1 năm học 2025-2026',
              semesterNameEn: 'Semester 1 academic year 2025-2026',
              gpa: 3.4,
              creditsEarned: 19,
              creditsAttempted: 19,
              records: [],
            },
          ],
        },
      },
      'academic.semesters': { data: [] },
    };
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
jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'signedOut', role: 'student', capabilities: [], bootStatus: 'ready' }),
}));
jest.mock('../../src/auth/oidc-session', () => ({ signInWithOidc: jest.fn(async () => ({ kind: 'cancelled' })) }));
jest.mock('../../src/auth/mobile-session-store', () => ({
  sessionStore: {
    issuer: 'http://issuer.test',
    sessionEpoch: jest.fn(() => 0),
    saveRefresh: jest.fn(async () => {}),
    setAccessToken: jest.fn(),
    bumpEpoch: jest.fn(),
  },
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
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

const gradesProps = { navigation: { navigate: jest.fn() }, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;
const signInProps = { navigation: { navigate: jest.fn() }, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;

describe('Q-002 app bar role at large chrome', () => {
  test('keeps the stacked role label on one line with font scaling', async () => {
    setFontScale(chromeFontScaleCap);
    await render(wrap(<AppBar role="lecturer" onProfile={() => {}} />));
    const role = screen.getByText(shellMessages.vi.roles.lecturer);
    expect(role.props.numberOfLines).toBe(1);
    expect(role.props.adjustsFontSizeToFit).toBe(true);
    expect(role.props.minimumFontScale).toBeLessThan(1);
  });
});

describe('Q-004 grades progress cards', () => {
  test('allows three lines on term names and keeps credit lines on one line', async () => {
    await render(wrap(<GradesScreen {...gradesProps} />));
    const term = screen.getByText('Học kỳ 2 năm học 2026-2027');
    expect(term.props.numberOfLines).toBe(3);
    const credits = screen.getByText('9 tín chỉ');
    expect(credits.props.numberOfLines).toBe(1);
    expect(credits.props.adjustsFontSizeToFit).toBe(true);
  });
});

describe('Q-005 search field at large font', () => {
  test('caps TextInput font scaling and keeps the row flexible', async () => {
    const placeholder = campusMessages.vi.searchPlaceholder;
    await render(wrap(<SearchBar value="" onChangeText={() => {}} placeholder={placeholder} />));
    const input = screen.getByLabelText(placeholder);
    expect(input.props.maxFontSizeMultiplier).toBe(searchFieldFontScaleCap);
    const style = StyleSheet.flatten(input.props.style);
    expect(style.flexShrink).toBe(1);
    expect(style.minWidth).toBe(0);
  });

  test('renders a long placeholder as a wrapped two-line label when empty', async () => {
    setFontScale(1.3, 411);
    const placeholder = campusMessages.vi.searchPlaceholder;
    await render(wrap(<SearchBar value="" onChangeText={() => {}} placeholder={placeholder} />));
    const hint = screen.getByText(placeholder, { includeHiddenElements: true });
    expect(hint.props.numberOfLines).toBe(2);
    expect(hint.props.maxFontSizeMultiplier).toBe(searchFieldFontScaleCap);
    const input = screen.getByLabelText(placeholder);
    expect(input.props.placeholder).toBe(placeholder);
    expect(input.props.placeholderTextColor).toBe('transparent');
    expect(input.props.multiline).toBe(false);
  });
});

describe('Q2-001 thesis segment labels', () => {
  test('keeps segment labels on one line with font scaling', async () => {
    await render(wrap(
      <SegmentedControl
        accessibilityLabel="view"
        value="topics"
        onChange={() => {}}
        options={[
          { value: 'topics', label: 'Đề tài' },
          { value: 'round', label: 'Đợt' },
          { value: 'advisors', label: shellMessages.vi.roles.lecturer },
        ]}
      />,
    ));
    const advisor = screen.getByText(shellMessages.vi.roles.lecturer);
    expect(advisor.props.numberOfLines).toBe(1);
    expect(advisor.props.adjustsFontSizeToFit).toBe(true);
  });
});

describe('Q2-002 export filename row', () => {
  test('ellipsizes long filenames in the middle on one line', async () => {
    await render(wrap(<FileRow name="campusute-timetable.ics" actions={[]} />));
    const name = screen.getByText('campusute-timetable.ics');
    expect(name.props.numberOfLines).toBe(1);
    expect(name.props.ellipsizeMode).toBe('middle');
  });
});

describe('Q2-003 sign-in brand row', () => {
  test('keeps CampusUTE on one line with font scaling', async () => {
    setFontScale(chromeFontScaleCap);
    await render(wrap(<SignInScreen {...signInProps} />));
    const wordmark = screen.getAllByText('CampusUTE')[0];
    expect(wordmark.props.numberOfLines).toBe(1);
    expect(wordmark.props.adjustsFontSizeToFit).toBe(true);
    expect(wordmark.props.minimumFontScale).toBeGreaterThanOrEqual(0.7);
  });
});
