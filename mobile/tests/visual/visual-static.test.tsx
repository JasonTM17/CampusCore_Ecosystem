import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  createAssistantClientRequestId: () => 'req-fixed-1',
  campusApi: new Proxy({}, { get: () => jest.fn(async () => ({ data: [] })) }),
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(), setData: jest.fn() }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));

import { StudentDashboardScreen } from '../../src/screens/student/StudentDashboardScreen';
import { CoursesScreen } from '../../src/screens/student/CoursesScreen';
import { NotificationsScreen } from '../../src/screens/student/NotificationsScreen';
import { EventsScreen } from '../../src/screens/student/EventsScreen';
import { AssistantChatScreen } from '../../src/screens/assistant/AssistantScreen';
import { BottomNavigation } from '../../src/components/BottomNavigation';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
function setWidth(w: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: w, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}
afterEach(() => { jest.restoreAllMocks(); });
const renderThemed = (el: ReactElement, scheme: 'light' | 'dark') => render(<ThemeProvider forcedScheme={scheme}>{el}</ThemeProvider>);

const STYLE_KEYS = ['backgroundColor', 'color', 'fontSize', 'padding', 'paddingTop', 'paddingBottom', 'paddingHorizontal', 'paddingVertical', 'margin', 'marginTop', 'marginBottom', 'gap', 'rowGap', 'columnGap', 'flexDirection', 'width', 'maxWidth', 'flex', 'justifyContent', 'alignItems', 'borderRadius', 'borderColor'] as const;

type Node = { type: string; props?: Record<string, unknown>; children?: (Node | string)[] | null };
function normalize(node: Node | string | null | undefined): unknown {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node;
  const flat = (StyleSheet.flatten(node.props?.style) ?? {}) as Record<string, unknown>;
  const style: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) if (flat[k] !== undefined) style[k] = flat[k];
  return {
    t: node.type,
    ...(node.props?.accessibilityRole ? { role: node.props.accessibilityRole } : {}),
    ...(node.props?.accessibilityLabel ? { label: node.props.accessibilityLabel } : {}),
    ...(Object.keys(style).length ? { s: style } : {}),
    c: (node.children ?? []).map(normalize),
  };
}

const CASES: Array<[string, ReactElement]> = [
  ['StudentDashboard', <StudentDashboardScreen {...props} />],
  ['Courses', <CoursesScreen {...props} />],
  ['Notifications', <NotificationsScreen {...props} />],
  ['Events', <EventsScreen {...props} />],
  ['Assistant-initial', <AssistantChatScreen {...props} />],
  ['BottomNavigation', <BottomNavigation activeRoute="dashboard.student" role="student" onNavigate={() => {}} onMenu={() => {}} />],
];

describe('static visual snapshots (structure/token, not pixels)', () => {
  for (const [name, el] of CASES) {
    for (const scheme of ['light', 'dark'] as const) {
      for (const width of [360, 1000]) {
        test(`${name} ${scheme} w${width}`, async () => {
          setWidth(width);
          await renderThemed(el, scheme);
          expect(normalize(screen.toJSON() as never)).toMatchSnapshot();
        });
      }
    }
  }
});
