import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { tokens } from '../../src/design/tokens';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { academicMessages } from '../../src/i18n/academic-messages';

type QueryState = { data?: unknown; error?: string | null; warning?: string | null; errorStatus?: number | null; isLoading?: boolean };

const mockQueries: Record<string, QueryState> = {};
const mockReload = jest.fn<() => Promise<void>>();
const mockPost = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockNetworkProbe = jest.fn<() => Promise<{ isConnected: boolean | null }>>();

jest.mock('../../src/api/client', () => ({
  apiClient: {
    mode: 'live',
    get: jest.fn(async () => []),
    post: (...args: unknown[]) => (mockPost as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
    download: jest.fn(),
  },
  campusApi: {
    enrollments: jest.fn(async () => []),
    grades: jest.fn(async () => []),
    transcript: jest.fn(async () => ({})),
    attendanceSummary: jest.fn(async () => []),
    registrationRounds: jest.fn(async () => []),
    registrationSections: jest.fn(async () => []),
  },
  createAssistantClientRequestId: () => 'key-1',
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const state = mockQueries[key] ?? {};
    return {
      data: state.data,
      error: state.error ?? null,
      warning: state.warning ?? null,
      errorStatus: state.errorStatus ?? null,
      isLoading: state.isLoading ?? false,
      isStale: false,
      reload: mockReload,
      setData: jest.fn(),
    };
  },
}));

jest.mock('expo-network', () => ({ getNetworkStateAsync: () => mockNetworkProbe() }));

import { RegistrationScreen } from '../../src/screens/student/RegistrationScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const copy = academicMessages.vi;
const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student', selectedThesisTopicId: null } as unknown as MobileScreenProps;

const section = {
  id: 'sec-1', sectionNumber: '01', courseId: 'course-1', courseCode: 'CS101', courseName: 'Nhập môn',
  credits: 3, capacity: 40, enrolledCount: 1, remainingSeats: 39, status: 'OPEN', scheduleConflict: false, alreadyEnrolled: true,
};
const selectable = {
  ...section,
  id: 'sec-9', courseId: 'course-9', courseCode: 'CS201', alreadyEnrolled: false,
};
const workspace = {
  sections: [section],
  enrollments: [{ id: 'enr-1', sectionId: 'sec-1', semesterId: 't2', status: 'ENROLLED' }],
  roundOpen: true,
  eligibility: { eligible: true, creditLimit: 20, creditsUsed: 3, creditsRemaining: 17 },
  closedReason: null,
};

const screenElement = (element: ReactElement) => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
  </ThemeProvider>
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockQueries['academic.registration'] = { data: workspace };
  mockReload.mockReset();
  mockReload.mockResolvedValue(undefined);
  mockPost.mockReset();
  mockPost.mockResolvedValue({ message: 'ok' });
  mockNetworkProbe.mockReset().mockResolvedValue({ isConnected: true });
  navigation.navigate = jest.fn();
});

afterEach(() => { jest.restoreAllMocks(); });

test('registration summary card has standard spacing before its search field', async () => {
  type JsonNode = { type: string; props: Record<string, unknown>; children?: (JsonNode | string)[] | null };
  const flatten = (node: JsonNode | JsonNode[] | string | null | undefined): JsonNode[] => {
    if (node == null || typeof node === 'string') return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    return [node, ...(node.children ?? []).flatMap(flatten)];
  };
  const textContent = (node: JsonNode): string => (node.children ?? []).map((child) =>
    typeof child === 'string' ? child : textContent(child),
  ).join('');

  await render(screenElement(<RegistrationScreen {...props} />));
  const nodes = flatten(screen.toJSON() as JsonNode);
  const summaryIndex = nodes.findIndex((node) => textContent(node) === 'Đã chọn (0)');
  const searchIndex = nodes.findIndex((node) => node.props.accessibilityLabel === copy.searchLabel);
  const sectionSpacer = nodes.slice(summaryIndex + 1, searchIndex).some((node) =>
    StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>)?.height === tokens.spacing.md,
  );

  expect(summaryIndex).toBeGreaterThanOrEqual(0);
  expect(searchIndex).toBeGreaterThan(summaryIndex);
  expect(sectionSpacer).toBe(true);
});

test('registration search stays on one line with a short placeholder and a complete accessible name', async () => {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 360, height: 800, scale: 2, fontScale: 2 } as ReturnType<typeof Dimensions.get>);
  await render(screenElement(<RegistrationScreen {...props} />));
  const input = screen.getByLabelText(copy.searchLabel);

  expect(input.props.placeholder).toBe('Tìm học phần');
  expect(input.props.accessibilityLabel).toBe(copy.searchLabel);
  expect(input.props.multiline).toBe(false);
  expect(academicMessages.en.searchPlaceholder).toBe('Search courses');
});

test('search matches the localized course name shown to the student', async () => {
  mockQueries['academic.registration'] = {
    data: { ...workspace, sections: [{ ...selectable, courseName: 'Cloud Computing', courseNameEn: 'Cloud Computing', courseNameVi: 'Điện toán đám mây' }], enrollments: [] },
  };
  await render(screenElement(<RegistrationScreen {...props} />));

  await fireEvent.changeText(screen.getByLabelText(copy.searchLabel), 'dien toan');
  expect(screen.getByRole('button', { name: `${copy.select}: CS201 Lớp 01` })).toBeOnTheScreen();
});

test('a second drop press during the post-drop reload is ignored', async () => {
  const reload = deferred<void>();
  mockReload.mockImplementation(() => reload.promise);
  await render(screenElement(<RegistrationScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', { name: `${copy.dropSection}: CS101` }));
  await fireEvent.press(screen.getByRole('button', { name: copy.dropSection }));
  expect(await screen.findByText(copy.dropped)).toBeOnTheScreen();
  expect(mockPost).toHaveBeenCalledTimes(1);

  // The reload that removes the row has not settled yet: a second tap must not
  // reach a second drop request.
  const rowDrop = screen.getByRole('button', { name: `${copy.dropSection}: CS101` });
  await fireEvent.press(rowDrop);
  await act(async () => { await Promise.resolve(); });
  const confirm = screen.queryByRole('button', { name: copy.dropSection });
  if (confirm) {
    await fireEvent.press(confirm);
    await act(async () => { await Promise.resolve(); });
  }
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(rowDrop).toBeDisabled();

  await act(async () => {
    reload.resolve();
    await reload.promise;
  });

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(screen.getByText(copy.dropped)).toBeOnTheScreen();
  expect(screen.queryByText(copy.errors.generic)).toBeNull();
});

test('a second select during the post-register refresh cannot send another enroll', async () => {
  mockQueries['academic.registration'] = {
    data: { ...workspace, sections: [selectable], enrollments: [] },
  };
  const reload = deferred<void>();
  const post = deferred<unknown>();
  mockReload.mockImplementation(() => reload.promise);
  mockPost.mockImplementation(() => post.promise);
  await render(screenElement(<RegistrationScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', { name: `${copy.select}: CS201 Lớp 01` }));
  await fireEvent.press(screen.getByRole('button', { name: copy.registerSelected }));
  await act(async () => { post.resolve({ id: 'enr-new' }); await post.promise; });

  // The enroll succeeded but the workspace has not refreshed yet: the row must
  // not offer an enabled Select while the refresh is still in flight.
  const select = screen.getByRole('button', { name: `${copy.select}: CS201 Lớp 01` });
  expect(select).toBeDisabled();
  await fireEvent.press(select);
  await act(async () => { await Promise.resolve(); });
  const register = screen.queryByRole('button', { name: copy.registerSelected });
  if (register) {
    await fireEvent.press(register);
    await act(async () => { await Promise.resolve(); });
  }
  expect(mockPost).toHaveBeenCalledTimes(1);

  await act(async () => { reload.resolve(); await reload.promise; });
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test('selection controls stay disabled while registration checks connectivity', async () => {
  const network = deferred<{ isConnected: boolean | null }>();
  mockNetworkProbe.mockReturnValue(network.promise);
  mockQueries['academic.registration'] = { data: { ...workspace, sections: [selectable], enrollments: [] } };
  await render(screenElement(<RegistrationScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', { name: `${copy.select}: CS201 Lớp 01` }));
  await fireEvent.press(screen.getByRole('button', { name: copy.registerSelected }));
  await act(async () => { await Promise.resolve(); });

  const unselect = screen.getByRole('button', { name: `${copy.unselect}: CS201 Lớp 01` });
  const disabledDuringProbe = (unselect.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled;
  await act(async () => { network.resolve({ isConnected: true }); await network.promise; });
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));

  expect(disabledDuringProbe).toBe(true);
});

test('two rapid registration submissions send one enrollment request', async () => {
  mockQueries['academic.registration'] = {
    data: { ...workspace, sections: [selectable], enrollments: [] },
  };
  let resolvePost!: (value: unknown) => void;
  mockPost.mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));
  await render(screenElement(<RegistrationScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', { name: `${copy.select}: CS201 Lớp 01` }));
  const submit = screen.getByRole('button', { name: copy.registerSelected });
  await act(async () => {
    await fireEvent.press(submit);
    await fireEvent.press(submit);
  });

  expect(mockPost).toHaveBeenCalledTimes(1);
  await act(async () => { resolvePost({ id: 'enr-new' }); });
});
