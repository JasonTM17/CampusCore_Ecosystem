import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
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
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
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
import { GradesScreen } from '../../src/screens/student/GradesScreen';
import { RegistrationScreen } from '../../src/screens/student/RegistrationScreen';
import { AttendanceScreen } from '../../src/screens/student/AttendanceScreen';
import { LearningScreen } from '../../src/screens/student/LearningScreen';
import { MenuPanel } from '../../src/components/MenuPanel';
import { SignInScreen } from '../../src/screens/auth/SignInScreen';

const navigation = {
  navigate: jest.fn(),
  navigateLane: jest.fn(),
  goBack: jest.fn(),
  signOut: jest.fn(),
} as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

async function renderInLocale(ui: ReactElement, locale: 'vi' | 'en' = 'vi') {
  return render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>
    </ThemeProvider>,
  );
}

type JsonNode = {
  type: string;
  props?: Record<string, unknown>;
  children?: (JsonNode | string)[] | null;
};

function findNodes(root: JsonNode | null | undefined, predicate: (node: JsonNode) => boolean): JsonNode[] {
  if (!root || typeof root === 'string') return [];
  const results: JsonNode[] = [];
  if (predicate(root)) results.push(root);
  if (root.children) {
    for (const child of root.children) {
      if (typeof child !== 'string') {
        results.push(...findNodes(child, predicate));
      }
    }
  }
  return results;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Vietnamese preview data localization and accessibility names', () => {
  test('StudentDashboardScreen renders Vietnamese course names for preview upcoming classes', async () => {
    const view = await renderInLocale(<StudentDashboardScreen {...props} />, 'vi');
    expect((await view.findAllByText(/Kiến trúc phần mềm/)).length).toBeGreaterThan(0);
    expect((await view.findAllByText(/Phân tích kinh doanh/)).length).toBeGreaterThan(0);
    expect(view.queryByText(/Software Architecture/)).toBeNull();
  });

  test('GradesScreen renders Vietnamese course names in records and accessibility labels', async () => {
    const view = await renderInLocale(<GradesScreen {...props} />, 'vi');
    expect(await view.findByText('Kiến trúc phần mềm')).toBeTruthy();
    expect(await view.findByText('Phân tích kinh doanh')).toBeTruthy();
    expect(view.queryByText('Software Architecture')).toBeNull();
  });

  test('RegistrationScreen renders Vietnamese course names for preview section groups', async () => {
    const view = await renderInLocale(<RegistrationScreen {...props} />, 'vi');
    expect(await view.findByText(/CS401 · Hệ phân tán/)).toBeTruthy();
    expect(await view.findByText(/UX305 · Thiết kế dịch vụ/)).toBeTruthy();
    expect(view.queryByText(/Distributed Systems/)).toBeNull();
  });

  test('AttendanceScreen renders Vietnamese course names for preview attendance rows', async () => {
    const view = await renderInLocale(<AttendanceScreen {...props} />, 'vi');
    expect(await view.findByText('Kiến trúc phần mềm')).toBeTruthy();
    expect(await view.findByText('Phân tích kinh doanh')).toBeTruthy();
    expect(view.queryByText('Software Architecture')).toBeNull();
  });

  test('LearningScreen renders Vietnamese course name for preview learning sections', async () => {
    const view = await renderInLocale(<LearningScreen {...props} />, 'vi');
    expect(await view.findByLabelText(/CS101 · 01 · Nhập môn lập trình/)).toBeTruthy();
    expect(view.queryByLabelText(/Introduction to Programming/)).toBeNull();
  });

  test('MenuPanel decorative brand logo is hidden from accessibility tree', async () => {
    const view = await renderInLocale(
      <MenuPanel
        activeRoute="dashboard.student"
        onClose={jest.fn()}
        onNavigate={jest.fn()}
        role="student"
        onSwitchRole={jest.fn()}
        allowRoleSwitch
      />,
      'vi',
    );
    const images = findNodes(view.toJSON() as JsonNode, (n) => n.type === 'Image');
    expect(images.length).toBeGreaterThan(0);
    const logo = images[0];
    expect(logo.props?.accessible).toBe(false);
    expect(logo.props?.accessibilityElementsHidden).toBe(true);
    expect(logo.props?.importantForAccessibility).toBe('no');
  });

  test('SignInScreen news cover image is hidden from accessibility tree', async () => {
    const view = await renderInLocale(<SignInScreen {...props} />, 'vi');
    const images = findNodes(view.toJSON() as JsonNode, (n) => n.type === 'Image' && n.props?.testID === 'signin-news-cover');
    expect(images.length).toBe(1);
    const cover = images[0];
    expect(cover.props?.accessible).toBe(false);
    expect(cover.props?.importantForAccessibility).toBe('no');
  });
});
