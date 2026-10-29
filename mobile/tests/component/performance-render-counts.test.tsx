import { expect, jest, test } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { Profiler, useState, type ComponentType, type ReactNode } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import type { MobileScreenProps } from '../../src/navigation/types';

let mockCards = 0;
let mockQueryReads = 0;
jest.mock('../../src/components/Ui', () => {
  const actual = jest.requireActual<typeof import('../../src/components/Ui')>('../../src/components/Ui');
  return { ...actual, Card: (props: Parameters<typeof actual.Card>[0]) => { mockCards++; return <actual.Card {...props} />; } };
});
jest.mock('../../src/api/client', () => ({ apiClient: { mode: 'preview' }, campusApi: {}, ApiClientError: class extends Error {} }));
jest.mock('../../src/session/SessionContext', () => ({ useSession: () => ({ kind: 'preview', role: 'student', capabilities: [] }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/hooks/useScreenQuery', () => ({ useScreenQuery: () => { mockQueryReads++; return { data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn() }; } }));

import { StudentDashboardScreen } from '../../src/screens/student/StudentDashboardScreen';
import { NewsScreen } from '../../src/screens/student/NewsScreen';
import { ScheduleScreen } from '../../src/screens/student/ScheduleScreen';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider forcedScheme="light"><LocaleProvider initialLocale="vi">{children}</LocaleProvider></ThemeProvider>;
}

const cases: Array<[string, ComponentType<MobileScreenProps>]> = [
  ['dashboard', StudentDashboardScreen], ['news', NewsScreen], ['schedule', ScheduleScreen],
];
test.each(cases)('%s: count card executions on an unrelated parent render', async (name, Component) => {
  mockCards = 0;
  mockQueryReads = 0;
  let commits = 0;
  const onRender = () => { commits++; };
  let trigger!: () => void;
  function Parent() {
    const [, setTick] = useState(0);
    trigger = () => setTick((n) => n + 1);
    return <Profiler id={name} onRender={onRender}><Component {...props} /></Profiler>;
  }
  const view = await render(<Providers><Parent /></Providers>);
  const initial = mockCards;
  const initialReads = mockQueryReads;
  const firstCommits = commits;
  await act(async () => trigger());
  const repeated = mockCards - initial;
  console.log('P1_RENDER', JSON.stringify({ name, initialCards: initial, repeatedCards: repeated, initialQueryReads: initialReads, repeatedQueryReads: mockQueryReads - initialReads, initialCommits: firstCommits, repeatedCommits: commits - firstCommits }));
  // This probe also checks that the visible screen survives the parent update.
  expect(view.toJSON()).not.toBeNull();
  expect(repeated).toBe(0);
  expect(mockQueryReads - initialReads).toBe(0);
  await view.unmount();
});
