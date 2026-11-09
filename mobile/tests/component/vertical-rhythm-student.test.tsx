import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactElement } from 'react';

import { tokens } from '../../src/design/tokens';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
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
  useOptionalSession: () => null,
}));
jest.mock('../../src/auth/oidc-session', () => ({ signInWithOidc: jest.fn() }));
jest.mock('../../src/auth/mobile-session-store', () => ({ sessionStore: {} }));
const mockQueries: Record<string, { data?: unknown; warning?: string | null; error?: string | null }> = {};
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(async () => {}), setData: jest.fn(), ...mockQueries[key] }),
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


import { TranscriptScreen } from '../../src/screens/academic/TranscriptScreen';
import { CurriculumScreen } from '../../src/screens/academic/CurriculumScreen';
import { EnrollmentsScreen } from '../../src/screens/academic/EnrollmentsScreen';
import { AnnouncementsScreen } from '../../src/screens/content/AnnouncementsScreen';
import { ConductScreen } from '../../src/screens/content/ConductScreen';
import { CertificatesScreen } from '../../src/screens/content/CertificatesScreen';
import { ForgotPasswordScreen } from '../../src/screens/account/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../../src/screens/account/ResetPasswordScreen';
import { LoggedOutScreen } from '../../src/screens/account/LoggedOutScreen';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';
import { CheckinScreen } from '../../src/screens/attendance-checkin/CheckinScreen';
import { apiClient } from '../../src/api/client';
import { Card, ScreenShell, UiText } from '../../src/components/Ui';
import { AcademicShell } from '../../src/screens/academic/academic-ui';
import { EnrollmentDetail } from '../../src/screens/academic/EnrollmentDetail';
import { previewEnrollments } from '../../src/screens/academic/academic-preview';
import { QueryNotices } from '../../src/screens/thesis/thesis-ui';
import { thesisMessages } from '../../src/i18n/thesis-messages';
import { AdmissionDetail } from '../../src/screens/content/AdmissionDetail';
import { AssignmentDetail } from '../../src/screens/content/AssignmentDetail';
import { EventDetail } from '../../src/screens/content/EventDetail';
import { ApplicationDetail, OpportunityDetail } from '../../src/screens/content/CareerDetail';
import { LibraryTitleDetail } from '../../src/screens/content/LibraryTitleDetail';
import { NewsDetail } from '../../src/screens/content/NewsDetail';
import { DocDetail } from '../../src/screens/content/DocDetail';
import { previewAdmissions, previewAssignments, previewEvents, previewCareerApplications, previewOpportunities, previewLibraryTitles, previewNews, previewDocs, previewConduct } from '../../src/screens/content/preview-data';
import { ThesisTopicsScreen, ThesisRoundScreen, ThesisAdvisorsScreen, ThesisDetailScreen, ThesisProgressScreen, ThesisRegistrationScreen } from '../../src/screens/thesis/ThesisScreens';

const navigation = {
  navigate: jest.fn(),
  navigateLane: jest.fn(),
  goBack: jest.fn(),
  signOut: jest.fn(),
} as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: 'preview-topic-1' } as MobileScreenProps;

const studentScreens: Array<{ name: string; render: () => ReactElement; setup?: () => void }> = [
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


studentScreens.push(...[
  TranscriptScreen, CurriculumScreen, EnrollmentsScreen, AnnouncementsScreen, ConductScreen, CertificatesScreen,
  ForgotPasswordScreen, ResetPasswordScreen, LoggedOutScreen, SignInScreen,
  ThesisTopicsScreen, ThesisRoundScreen, ThesisAdvisorsScreen, ThesisDetailScreen, ThesisProgressScreen, ThesisRegistrationScreen,
].map((Screen) => ({ name: Screen.name, render: () => <Screen {...props} /> })));

const noop = () => {};
studentScreens.push(
  { name: 'check-in', render: () => <CheckinScreen {...props} /> },
  { name: 'reset form', render: () => <ResetPasswordScreen {...props} initialToken="fake-reset-token_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" /> },
  { name: 'enrollment detail', render: () => <ScreenShell title="Enrollment"><EnrollmentDetail enrollment={previewEnrollments[0]} onBack={noop} onDrop={noop} /></ScreenShell> },
  { name: 'admission detail', render: () => <AdmissionDetail application={previewAdmissions('vi')[0]} busy={false} preview flash={null} onBack={noop} onSave={noop} onSubmit={noop} onWithdraw={noop} onUploaded={noop} onDeleteFile={noop} /> },
  { name: 'assignment detail', render: () => <AssignmentDetail assignment={previewAssignments('vi')[0]} onBack={noop} onChanged={noop} /> },
  { name: 'event detail', render: () => <EventDetail event={previewEvents('vi')[0]} busy={false} flash={null} onBack={noop} onRegister={noop} onCancel={noop} /> },
  { name: 'career application detail', render: () => <ApplicationDetail application={previewCareerApplications('vi')[0]} busy={false} preview flash={null} onBack={noop} onWithdraw={noop} onUploaded={noop} /> },
  { name: 'opportunity detail', render: () => <OpportunityDetail opportunity={previewOpportunities('vi')[0]} alreadyApplied={false} busy={false} preview flash={null} onBack={noop} onApply={noop} /> },
  { name: 'library title detail', render: () => <LibraryTitleDetail titleId={previewLibraryTitles('vi')[0].id} busy={false} flash={null} onBack={noop} onHold={noop} reloadToken={0} /> },
  { name: 'news detail', render: () => <NewsDetail idOrSlug={previewNews('vi')[0].id} onBack={noop} /> },
  { name: 'document detail', render: () => <DocDetail slug={previewDocs('vi')[0].slug} onBack={noop} /> },
  { name: 'academic stale notice', render: () => <AcademicShell title="Academic" warning="Stale data"><Card><UiText>Academic content</UiText></Card></AcademicShell> },
  { name: 'thesis stale notice', render: () => <ScreenShell title="Thesis"><QueryNotices copy={thesisMessages.vi} state={{ warning: 'Stale data', error: null, loading: false, reload: async () => {}, preview: true }} /><Card><UiText>Thesis content</UiText></Card></ScreenShell> },
  { name: 'dashboard stale notice', setup: () => { mockQueries['academic.dashboard'] = { warning: 'Stale data' }; }, render: () => <StudentDashboardScreen {...props} /> },
  { name: 'dashboard announcement error', setup: () => { mockQueries.announcements = { error: 'Announcements unavailable' }; }, render: () => <StudentDashboardScreen {...props} /> },
  { name: 'dashboard empty agenda', setup: () => { Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true }); }, render: () => <StudentDashboardScreen {...props} /> },
  { name: 'conduct stale notice', setup: () => {
    Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true });
    mockQueries['content.conduct'] = { data: previewConduct('vi'), warning: 'Stale data' };
  }, render: () => <ConductScreen {...props} /> },
  { name: 'registration closed round', setup: () => { Object.defineProperty(apiClient, 'mode', { value: 'live', configurable: true }); }, render: () => <RegistrationScreen {...props} /> },
);

type Host = {
  type: string;
  props: {
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    accessible?: boolean;
  };
  children?: (Host | string)[] | null;
};
const style = (node: Host): ViewStyle => StyleSheet.flatten(node.props.style) ?? {};
const children = (node: Host) => (node.children ?? []).filter((child): child is Host => typeof child !== 'string');
const number = (value: unknown) => typeof value === 'number' ? value : 0;
const margin = (node: Host, edge: 'Top' | 'Bottom') => {
  const s = style(node);
  return number(s[`margin${edge}`] ?? s.marginVertical ?? s.margin);
};
const padding = (node: Host, edge: 'Top' | 'Bottom') => {
  const s = style(node);
  return number(s[`padding${edge}`] ?? s.paddingVertical ?? s.padding);
};
const label = (node: Host): string => node.props.accessibilityLabel ??
  (node.children ?? []).map((child) => typeof child === 'string' ? child : label(child)).join(' ').slice(0, 75);
function hasInput(node: Host): boolean {
  return node.type.includes('TextInput') || children(node).some(hasInput);
}
function atomic(node: Host): boolean {
  const s = style(node);
  const items = children(node);
  const field = items.length <= 3 && items[0]?.type === 'Text' && items[1] && hasInput(items[1]);
  return node.type !== 'View' && !node.type.includes('Cell') ||
    Boolean(s.backgroundColor || s.borderWidth || s.flexDirection?.startsWith('row') ||
      node.props.accessibilityRole || node.props.accessible || field);
}
function empty(node: Host): boolean {
  const s = style(node);
  return !(node.children?.length) && !s.height && !s.backgroundColor && !s.borderWidth &&
    !margin(node, 'Top') && !margin(node, 'Bottom');
}
function edgeSpace(node: Host, edge: 'Top' | 'Bottom'): number {
  const s = style(node);
  const own = margin(node, edge);
  const items = children(node).filter((child) => !empty(child));
  if (atomic(node) && !(items.length === 1 && !s.backgroundColor && !s.borderWidth && !s.flexDirection)) return own;
  if (!items.length) return own + number(s.height);
  return own + padding(node, edge) + edgeSpace(edge === 'Top' ? items[0] : items[items.length - 1], edge);
}
function joinedCard(first: Host, second: Host): boolean {
  while (children(first).length === 1 && !style(first).backgroundColor) first = children(first)[0];
  while (children(second).length === 1 && !style(second).backgroundColor) second = children(second)[0];
  const a = style(first), b = style(second);
  return a.borderBottomWidth === 0 && b.borderTopWidth === 0 && Boolean(a.backgroundColor && b.backgroundColor);
}
function auditColumn(node: Host, problems: string[]) {
  if (atomic(node)) return;
  const items = children(node).filter((child) => !empty(child));
  const s = style(node);
  for (let i = 1; i < items.length; i++) {
    const first = items[i - 1], second = items[i];
    const space = edgeSpace(first, 'Bottom') + edgeSpace(second, 'Top') + number(s.rowGap ?? s.gap);
    // The sign-in form intentionally overlaps the padded institutional hero.
    const overlap = edgeSpace(second, 'Top');
    const paddedOverlap = overlap < 0 && padding(first, 'Bottom') + overlap >= tokens.spacing.xs;
    if (space < tokens.spacing.xs && !joinedCard(first, second) && !paddedOverlap) {
      problems.push(`${label(first)} -> ${label(second)}: ${space} dp`);
    }
  }
  items.forEach((child) => auditColumn(child, problems));
}
function auditScrolls(node: Host, problems: string[]): number {
  if (node.type.includes('ScrollView')) {
    const content = { ...node, type: 'View', props: { style: node.props.contentContainerStyle } };
    auditColumn(content, problems);
    return 1;
  }
  return children(node).reduce((count, child) => count + auditScrolls(child, problems), 0);
}

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  Object.defineProperty(apiClient, 'mode', { value: 'preview', configurable: true });
});
afterEach(() => { jest.restoreAllMocks(); });

describe('vertical rhythm in student and account screens', () => {
  for (const entry of studentScreens) {
    test(`${entry.name} separates adjacent scroll blocks`, async () => {
      entry.setup?.();
      jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 393, height: 852, scale: 2, fontScale: 1 });
      const view = await render(
        <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: 16, left: 0, right: 0 }}>
          <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale="vi">{entry.render()}</LocaleProvider></ThemeProvider>
        </SafeAreaInsetsContext.Provider>,
      );
      const problems: string[] = [];
      const root = view.toJSON() as Host;
      expect(root).toBeTruthy();
      expect(auditScrolls(root, problems)).toBeGreaterThan(0);
      expect(problems).toEqual([]);
      await view.unmount();
    });
  }
});
