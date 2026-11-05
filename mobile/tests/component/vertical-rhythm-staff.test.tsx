import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactElement } from 'react';

import { tokens } from '../../src/design/tokens';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

const mockLaneData: Record<string, unknown> = {};
const mockSession = { kind: 'preview', role: 'lecturer', capabilities: [] as string[] };

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  createAssistantClientRequestId: () => 'req-fixed-1',
  campusApi: new Proxy({}, { get: () => jest.fn(async () => ({ data: [] })) }),
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => mockSession }));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(async () => {}), setData: jest.fn() }),
}));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useLocalSearchParams: () => ({}),
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});
jest.mock('../../src/screens/lanes/lane-ui', () => {
  const actual = jest.requireActual('../../src/screens/lanes/lane-ui') as Record<string, unknown>;
  return {
    ...actual,
    useLaneRequest: (_fetcher: unknown, key: string) => ({
      data: mockLaneData[key],
      loading: false,
      error: null,
      failure: null,
      reload: jest.fn(async () => {}),
    }),
  };
});

import { AdminDashboardScreen, AdminLecturersScreen, AdminStudentsScreen } from '../../src/screens/operations/AdminScreens';
import { LecturerAttendanceScreen } from '../../src/screens/operations/LecturerAttendanceScreen';
import { LecturerDashboardScreen } from '../../src/screens/operations/LecturerDashboardScreen';
import { LecturerGradingScreen } from '../../src/screens/operations/LecturerGradingScreen';
import { LecturerScheduleScreen } from '../../src/screens/operations/LecturerScheduleScreen';
import { AdminOverviewScreen } from '../../src/screens/lanes/AdminOverviewScreen';
import {
  AdminAttendanceScreen,
  AdminAuditScreen,
  AdminCreditLimitsScreen,
  AdminEnrollmentsScreen,
  AdminEventsScreen,
  AdminNotificationsScreen,
} from '../../src/screens/lanes/AdminLaneScreens';
import { DeanOverviewScreen } from '../../src/screens/lanes/DeanOverviewScreen';
import { ApplyReviewScreen, CareersDeskScreen, LibraryDeskScreen } from '../../src/screens/lanes/StaffDeskScreens';
import { AssistantChatScreen } from '../../src/screens/assistant/AssistantScreen';
import { lanesMessages } from '../../src/i18n/lanes-messages';

const navigation = {
  navigate: jest.fn(),
  navigateLane: jest.fn(),
  goBack: jest.fn(),
  signOut: jest.fn(),
} as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'lecturer', selectedThesisTopicId: null } as MobileScreenProps;

const page = (items: unknown[]) => ({
  items,
  meta: { total: items.length, page: 1, limit: 20, totalPages: 1 },
  hasMore: false,
});

function setPreviewData() {
  Object.assign(mockLaneData, {
    'admin:overview': {
      totals: { total: 120, up: 10, down: 2 },
      gradeDistribution: [], departments: [], semesterTrends: [],
    },
    'dean:rounds': [{ id: 'round-1', name: 'Round 1', status: 'OPEN' }],
    'dean:overview:round-1': {
      faculty: { facultyName: 'Engineering' },
      stats: { totalGroups: 1, groupsPendingApproval: 1, groupsApproved: 0, groupsRejected: 0, byDepartment: [] },
      supervisors: [{ lecturerId: 'lecturer-1', displayName: 'Nguyễn Văn A', departmentName: 'Computer Science', supervisedGroups: 1, supervisedTopics: 1 }],
      groups: [{ id: 'group-1', topicTitle: 'Campus systems', approvalStatus: 'PENDING', departmentName: 'Computer Science', members: [], supervisors: [] }],
    },
    'admin:attendance::::1': page([{
      id: 'attendance-1', studentId: 'student-1', status: 'PRESENT', date: '2026-11-04',
      student: { user: { firstName: 'An', lastName: 'Nguyễn' } },
      section: { sectionNumber: '01', course: { code: 'CS101', name: 'Software Design' } },
    }]),
    'admin:enrollments:::::1': page([{
      id: 'enrollment-1', status: 'ENROLLED', enrolledAt: '2026-11-04',
      student: { user: { firstName: 'An', lastName: 'Nguyễn' } },
      section: { sectionNumber: '01', course: { code: 'CS101', name: 'Software Design' } },
      semester: { name: 'Fall 2026' },
    }]),
    'admin:audit:::1': page([{
      id: 'audit-1', action: 'GRADE_UPDATED', entityType: 'Grade', actorId: 'lecturer-1', createdAt: '2026-11-04T10:00:00Z',
    }]),
    'admin:credit:PENDING': [{ id: 'credit-1', studentName: 'Nguyễn Văn A', studentCode: '22110001', status: 'PENDING', requestedLimit: 25, semesterName: 'Fall 2026' }],
    'admin:events': [{ id: 'event-1', title: 'Campus day', status: 'REGISTRATION_OPEN', startsAt: '2026-11-10T10:00:00Z', location: 'Hall A', capacity: 40, registeredCount: 12 }],
    'admin:roster:event-1': [{ registrationId: 'registration-1', studentId: 'student-1', studentName: 'Nguyễn Văn A', email: 'student@example.edu', status: 'REGISTERED' }],
    'admin:notifications:1': page([{ id: 'notification-1', title: 'Schedule update', type: 'INFO', createdAt: '2026-11-04T10:00:00Z' }]),
    'apply::0': page([{ id: 'application-1', status: 'SUBMITTED', fullName: 'Nguyễn Văn A', applicantEmail: 'student@example.edu', attachments: [] }]),
    'careers::0': page([{ id: 'career-1', status: 'SUBMITTED', opportunityTitle: 'Internship', organizationName: 'CampusCore', candidateEmail: 'student@example.edu', attachments: [] }]),
    'library:': [{ id: 'loan-1', title: 'Software Design', borrowerEmail: 'student@example.edu', status: 'REQUESTED' }],
  });
}

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
  const hasText = (node.children ?? []).some((child) => typeof child === 'string' && child.trim().length > 0);
  const hasBlocks = children(node).some((child) => !empty(child));
  return !hasText && !hasBlocks && !s.height && !s.backgroundColor && !s.borderWidth &&
    !margin(node, 'Top') && !margin(node, 'Bottom');
}

function edgeSpace(node: Host, edge: 'Top' | 'Bottom'): number {
  const s = style(node);
  const own = margin(node, edge);
  const items = children(node).filter((child) => !empty(child));
  if (atomic(node) && !(items.length === 1 && !s.backgroundColor && !s.borderWidth && !s.flexDirection)) return own;
  if (!items.length) {
    // A terminal empty spacer's top margin separates its preceding block from the next list row.
    return own + number(s.height) + (edge === 'Bottom' ? margin(node, 'Top') : 0);
  }
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
    const firstBottom = edgeSpace(first, 'Bottom');
    const secondTop = edgeSpace(second, 'Top');
    const parentGap = number(s.rowGap ?? s.gap);
    const space = firstBottom + secondTop + parentGap;
    const overlap = edgeSpace(second, 'Top');
    const paddedOverlap = overlap < 0 && padding(first, 'Bottom') + overlap >= tokens.spacing.xs;
    if (space < tokens.spacing.xs && !joinedCard(first, second) && !paddedOverlap) {
      problems.push(`${label(first)} -> ${label(second)}: ${space} dp`);
    }
  }
  items.forEach((child) => auditColumn(child, problems));
}

function auditScrolls(node: Host, problems: string[]): number {
  let count = 0;
  if (/ScrollView|FlatList|VirtualizedList/.test(node.type)) {
    const content = { ...node, type: 'View', props: { style: node.props.contentContainerStyle } };
    auditColumn(content, problems);
    count++;
  }
  return count + children(node).reduce((total, child) => total + auditScrolls(child, problems), 0);
}

const staffScreens: Array<{ name: string; render: () => ReactElement; exercise?: () => Promise<void> }> = [
  { name: 'lecturer dashboard', render: () => <LecturerDashboardScreen {...props} /> },
  { name: 'lecturer schedule', render: () => <LecturerScheduleScreen {...props} /> },
  { name: 'lecturer attendance', render: () => <LecturerAttendanceScreen {...props} /> },
  { name: 'lecturer grading', render: () => <LecturerGradingScreen {...props} /> },
  { name: 'admin dashboard', render: () => <AdminDashboardScreen {...props} /> },
  { name: 'admin students', render: () => <AdminStudentsScreen /> },
  { name: 'admin lecturers', render: () => <AdminLecturersScreen /> },
  { name: 'admin overview', render: () => <AdminOverviewScreen {...props} /> },
  { name: 'dean overview', render: () => <DeanOverviewScreen /> },
  { name: 'admin attendance queue', render: () => <AdminAttendanceScreen /> },
  { name: 'admin enrollments queue', render: () => <AdminEnrollmentsScreen /> },
  { name: 'admin audit queue', render: () => <AdminAuditScreen /> },
  { name: 'admin credit queue', render: () => <AdminCreditLimitsScreen /> },
  {
    name: 'admin event queue and roster',
    render: () => <AdminEventsScreen />,
    exercise: async () => { await fireEvent.press(screen.getByRole('button', { name: lanesMessages.vi.eventDetail })); },
  },
  { name: 'admin notification desk', render: () => <AdminNotificationsScreen /> },
  { name: 'admissions desk', render: () => <ApplyReviewScreen /> },
  { name: 'careers desk', render: () => <CareersDeskScreen /> },
  { name: 'library desk', render: () => <LibraryDeskScreen /> },
  { name: 'assistant', render: () => <AssistantChatScreen {...props} /> },
];

async function renderThemed(element: ReactElement) {
  return render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: 16, left: 0, right: 0 }}>
      <ThemeProvider forcedScheme="light">
        <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
      </ThemeProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(mockLaneData)) delete mockLaneData[key];
  setPreviewData();
  mockSession.kind = 'preview';
  mockSession.role = 'lecturer';
  mockSession.capabilities = [];
});
afterEach(() => { jest.restoreAllMocks(); });

describe('vertical rhythm in staff and assistant screens', () => {
  for (const entry of staffScreens) {
    test(`${entry.name} separates adjacent scroll blocks`, async () => {
      jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 393, height: 852, scale: 2.75, fontScale: 1 });
      const view = await renderThemed(entry.render());
      const problems: string[] = [];
      let root = view.toJSON() as Host;
      expect(root).toBeTruthy();
      let scrolls = auditScrolls(root, problems);
      expect(scrolls).toBeGreaterThan(0);

      await entry.exercise?.();
      if (entry.exercise) {
        root = view.toJSON() as Host;
        scrolls += auditScrolls(root, problems);
      }
      expect(problems).toEqual([]);
      await view.unmount();
    });
  }
});
