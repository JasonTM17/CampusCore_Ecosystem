import { afterAll, afterEach, describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Dimensions, Pressable, Text, TextInput, View } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { useWindowClass } from '../../src/design/theme';
import { auditTree } from './audit';
import type { AuditResult } from './audit';

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
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));

import { screenComponents } from '../../src/screens/index';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

function setMatrix(width: number, fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
}
afterEach(() => { jest.restoreAllMocks(); });

const renderThemed = (el: ReactElement, scheme: 'light' | 'dark') =>
  render(<ThemeProvider forcedScheme={scheme}>{el}</ThemeProvider>);

function WindowClassProbe() {
  const wc = useWindowClass();
  return <Text testID="wc">{`${wc.class}:${wc.fontScale}`}</Text>;
}

describe('matrix sanity', () => {
  test('width/fontScale truly change the window class', async () => {
    setMatrix(360, 1);
    await renderThemed(<WindowClassProbe />, 'light');
    expect(screen.getByTestId('wc')).toHaveTextContent('compact:1');
    setMatrix(1000, 1.5);
    await renderThemed(<WindowClassProbe />, 'light');
    expect(screen.getByTestId('wc')).toHaveTextContent('expanded:1.5');
  });
});

describe('a11y audit over screenComponents', () => {
  const standaloneRenderAllowlist: Record<string, { reason: string; expectedError: RegExp }> = {
    'auth.signIn': {
      reason: 'Uses session state and requires the app SessionProvider.',
      expectedError: /useSession must be used inside SessionProvider/,
    },
    'auth.resetPassword': {
      reason: 'Uses Expo Router navigation hooks and requires the app router context.',
      expectedError: /useRouter.*not a function/,
    },
  };
  // The listed cases have layout-dependent touch targets in test-renderer output; all others allow zero unknown sizes.
  const unknownSizeLimits: Record<string, number> = {
    'profile/light/w360/fs1': 1,
    'profile/dark/w1000/fs1.5': 1,
    'admin.dashboard/light/w360/fs1': 2,
    'admin.dashboard/dark/w1000/fs1.5': 2,
    'admin.students/light/w360/fs1': 5,
    'admin.students/dark/w1000/fs1.5': 5,
    'admin.lecturers/light/w360/fs1': 4,
    'admin.lecturers/dark/w1000/fs1.5': 4,
    'lecturer.dashboard/light/w360/fs1': 3,
    'lecturer.dashboard/dark/w1000/fs1.5': 3,
  };
  const failures = new Map<string, string>();
  const coverage = new Set<string>();
  const results: { name: string; caseKey: string; res: AuditResult }[] = [];
  const matrix = [
    { scheme: 'light' as const, width: 360, fontScale: 1 },
    { scheme: 'dark' as const, width: 1000, fontScale: 1.5 },
  ];
  const caseKey = (name: string, m: (typeof matrix)[number]) => `${name}/${m.scheme}/w${m.width}/fs${m.fontScale}`;

  for (const name of Object.keys(screenComponents)) {
    const Component = screenComponents[name as keyof typeof screenComponents];
    for (const m of matrix) {
      test(`${name} ${m.scheme} w${m.width} fs${m.fontScale}`, async () => {
        setMatrix(m.width, m.fontScale);
        const currentCase = caseKey(name, m);
        try {
          await renderThemed(<Component {...props} />, m.scheme);
        } catch (error) {
          const allowlistEntry = standaloneRenderAllowlist[name];
          const message = error instanceof Error ? error.message : String(error);
          if (!allowlistEntry?.expectedError.test(message)) throw error;
          failures.set(name, allowlistEntry.reason);
          coverage.add(currentCase);
          return;
        }
        const res = auditTree(screen.toJSON() as never);
        results.push({ name, caseKey: currentCase, res });
        coverage.add(currentCase);
        expect(res.violations).toEqual([]);
      }, 20000);
    }
  }

  afterAll(() => {
    const expectedCases = Object.keys(screenComponents).flatMap((name) => matrix.map((m) => caseKey(name, m))).sort();
    const expectedScreens = Object.keys(screenComponents).sort();
    const accountedScreens = [...new Set([...results.map((r) => r.name), ...failures.keys()])].sort();
    const unknownSizeByScreen = results.reduce<Record<string, number>>((counts, result) => {
      counts[result.name] = (counts[result.name] ?? 0) + result.res.unknownSize;
      return counts;
    }, {});
    const unknownSizeTotal = results.reduce((total, result) => total + result.res.unknownSize, 0);
    const nonzeroUnknownSizeByScreen = Object.fromEntries(Object.entries(unknownSizeByScreen).filter(([, count]) => count > 0));
    const unknownSizeOverages = results
      .filter((result) => result.res.unknownSize > (unknownSizeLimits[result.caseKey] ?? 0))
      .map((result) => `${result.caseKey}: ${result.res.unknownSize} > ${unknownSizeLimits[result.caseKey] ?? 0}`);

    console.log(`A11Y-AUDIT screens=${accountedScreens.length}/${expectedScreens.length} renders=${results.length} allowed-render-failures=${JSON.stringify(Object.fromEntries(failures))} unknown-size=${unknownSizeTotal} by-screen=${JSON.stringify(nonzeroUnknownSizeByScreen)}`);
    expect([...coverage].sort()).toEqual(expectedCases);
    expect(accountedScreens).toEqual(expectedScreens);
    expect(Object.keys(standaloneRenderAllowlist).every((name) => expectedScreens.includes(name))).toBe(true);
    expect(Object.values(standaloneRenderAllowlist).every(({ reason }) => reason.trim() !== '')).toBe(true);
    expect(unknownSizeOverages).toEqual([]);
  });
});

describe('audit teeth (negative test)', () => {
  test('flags an unlabeled icon button and an unlabeled input', () => {
    const bad: Parameters<typeof auditTree>[0] = {
      type: 'View',
      props: {},
      children: [
        { type: 'Pressable', props: { onPress: () => {} }, children: [] },
        { type: 'TextInput', props: {}, children: [] },
        { type: 'Image', props: {}, children: [] },
      ],
    };
    const res = auditTree(bad);
    expect(res.violations.map((v) => v.rule)).toEqual(['a-name', 'b-input-label', 'c-image-label']);
  });

  test('flags a button with a hard-truncated label (rule e)', () => {
    const truncated = {
      type: 'Pressable',
      props: { onPress: () => {}, accessibilityRole: 'button' },
      children: [{ type: 'Text', props: { numberOfLines: 1 }, children: ['A very long action label'] }],
    };
    expect(auditTree(truncated).violations.map((v) => v.rule)).toContain('e-truncated-action');
  });

  test('exempts a labelled list row whose visual text truncates (rule e exemption)', () => {
    const listRow = {
      type: 'Pressable',
      props: {
        onPress: () => {},
        accessibilityRole: 'button',
        accessibilityLabel: 'Course CS101 — Introduction to Computing — enrolled',
      },
      children: [{ type: 'Text', props: { numberOfLines: 1 }, children: ['Course CS101 — Introduc…'] }],
    };
    expect(auditTree(listRow).violations.filter((v) => v.rule === 'e-truncated-action')).toEqual([]);
  });

  test('flags an alert role element with no readable content (rule f)', () => {
    const emptyAlert = { type: 'View', props: { accessibilityRole: 'alert' }, children: [] };
    expect(auditTree(emptyAlert).violations.map((v) => v.rule)).toContain('f-empty-alert');
  });
});
