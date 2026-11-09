import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { admissionsMessages } from '../../src/i18n/admissions-messages';
import { careersMessages } from '../../src/i18n/careers-messages';
import { libraryMessages } from '../../src/i18n/library-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

type QueryState = {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  errorStatus?: number | null;
  isLoading?: boolean;
  isStale?: boolean;
};

const mockQueries: Record<string, QueryState> = {};
const mockReload = jest.fn<() => Promise<void>>();
const mockPost = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../src/api/client', () => ({
  apiClient: {
    mode: 'live',
    get: jest.fn(async () => []),
    post: (...args: unknown[]) => (mockPost as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
    delete: jest.fn(async () => ({})),
  },
  campusApi: { libraryTitle: jest.fn() },
  createAssistantClientRequestId: () => 'request-key',
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, _requestId: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
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
      isStale: state.isStale ?? false,
      reload: mockReload,
      setData: jest.fn(),
    };
  },
}));

import { AdmissionsScreen } from '../../src/screens/student/AdmissionsScreen';
import { CareersScreen } from '../../src/screens/student/CareersScreen';
import { LibraryScreen } from '../../src/screens/student/LibraryScreen';
import { campusApi } from '../../src/api/client';
import { joinMeta } from '../../src/screens/content/content-rules';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

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

async function pressConfirm(label: string, previousCount: number) {
  const buttons = screen.queryAllByRole('button', { name: label });
  if (buttons.length <= previousCount) return;
  await fireEvent.press(buttons[buttons.length - 1]);
  await act(async () => { await Promise.resolve(); });
}

async function reattempt(action: () => void, confirmLabel: string) {
  const before = screen.queryAllByRole('button', { name: confirmLabel }).length;
  await act(async () => { action(); });
  await pressConfirm(confirmLabel, before);
}

async function pressTwiceBeforeCommit(button: unknown) {
  const originalError = console.error;
  const warning = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('overlapping act() calls')) return;
    originalError(message, ...args);
  });
  try {
    await act(async () => {
      fireEvent.press(button as never);
      fireEvent.press(button as never);
    });
  } finally {
    warning.mockRestore();
  }
}

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockReload.mockReset();
  mockReload.mockResolvedValue(undefined);
  mockPost.mockReset();
  mockPost.mockResolvedValue({});
});

test('a second careers withdraw during the applications refresh is ignored', async () => {
  const copy = careersMessages.vi;
  const application = {
    id: 'app-1', opportunityId: 'opp-1', opportunityTitle: 'Thực tập sinh Backend',
    organizationName: 'Công ty A', status: 'SUBMITTED', version: 1,
    submittedAt: '2026-10-01T00:00:00Z', attachments: [],
  };
  mockQueries['content.careers.board.'] = { data: { items: [], hasMore: false } };
  mockQueries['content.careers.applications'] = { data: [application] };
  const reload = deferred<void>();
  mockReload.mockImplementation(() => reload.promise);
  await render(screenElement(<CareersScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', {
    name: joinMeta([application.opportunityTitle, copy.statusLabels.SUBMITTED, application.organizationName]),
  }));
  await fireEvent.press(screen.getByRole('button', { name: copy.withdraw }));
  await pressConfirm(copy.withdraw, 1);
  expect(await screen.findByText(copy.withdrawn)).toBeOnTheScreen();
  expect(mockPost).toHaveBeenCalledTimes(1);

  const withdrawButton = screen.getByRole('button', { name: copy.withdraw });
  await reattempt(() => { fireEvent.press(withdrawButton); }, copy.withdraw);
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(withdrawButton).toBeDisabled();

  await act(async () => {
    reload.resolve();
    await reload.promise;
  });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(screen.getByText(copy.withdrawn)).toBeOnTheScreen();
  expect(screen.queryByText(copy.failed)).toBeNull();
});

test('same-frame repeated careers confirmation sends one request', async () => {
  const copy = careersMessages.vi;
  const application = {
    id: 'app-1', opportunityId: 'opp-1', opportunityTitle: 'Thực tập sinh Backend',
    organizationName: 'Công ty A', status: 'SUBMITTED', version: 1,
    submittedAt: '2026-10-01T00:00:00Z', attachments: [],
  };
  mockQueries['content.careers.board.'] = { data: { items: [], hasMore: false } };
  mockQueries['content.careers.applications'] = { data: [application] };
  const request = deferred<unknown>();
  mockPost.mockImplementation(() => request.promise);
  await render(screenElement(<CareersScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', {
    name: joinMeta([application.opportunityTitle, copy.statusLabels.SUBMITTED, application.organizationName]),
  }));
  await fireEvent.press(screen.getByRole('button', { name: copy.withdraw }));
  const confirm = screen.getAllByRole('button', { name: copy.withdraw }).at(-1)!;
  try {
    await pressTwiceBeforeCommit(confirm);
    expect(mockPost).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      request.resolve({});
      await request.promise;
    });
  }
});

test('a second library cancel during the loans refresh is ignored', async () => {
  const copy = libraryMessages.vi;
  const loan = {
    id: 'loan-1', title: 'Sách A', barcode: 'B1', copyId: 'copy-1', status: 'REQUESTED', version: 1,
    requestedAt: '2026-10-01T00:00:00Z', expiresAt: null, dueAt: null,
  };
  mockQueries['content.library.catalogue.'] = { data: { items: [], hasMore: false } };
  mockQueries['content.library.loans'] = { data: [loan] };
  const reload = deferred<void>();
  mockReload.mockImplementation(() => reload.promise);
  await render(screenElement(<LibraryScreen {...props} />));

  await fireEvent.press(screen.getByRole('tab', { name: copy.myLoans }));
  await fireEvent.press(screen.getByRole('button', { name: `${copy.cancel}: ${loan.title}` }));
  await pressConfirm(copy.cancel, 0);
  expect(await screen.findByText(copy.cancelled)).toBeOnTheScreen();
  expect(mockPost).toHaveBeenCalledTimes(1);

  const cancelButton = screen.getByRole('button', { name: `${copy.cancel}: ${loan.title}` });
  await reattempt(() => { fireEvent.press(cancelButton); }, copy.cancel);
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(cancelButton).toBeDisabled();

  await act(async () => {
    reload.resolve();
    await reload.promise;
  });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(screen.getByText(copy.cancelled)).toBeOnTheScreen();
  expect(screen.queryByText(copy.failed)).toBeNull();
});

test('same-frame double hold confirmation sends one library request', async () => {
  const copy = libraryMessages.vi;
  const title = {
    id: 'title-1', title: 'Sách thử nghiệm', author: 'Tác giả', totalCopies: 1,
    availableCopies: 1, version: 1,
    copies: [{ id: 'copy-1', barcode: 'B1', status: 'AVAILABLE' }],
  };
  mockQueries['content.library.catalogue.'] = { data: { items: [title], total: 1, hasMore: false } };
  mockQueries['content.library.title.title-1.0'] = { data: title };
  jest.mocked(campusApi.libraryTitle).mockResolvedValue(title as never);
  const request = deferred<unknown>();
  mockPost.mockImplementation(() => request.promise);
  await render(screenElement(<LibraryScreen {...props} />));
  await fireEvent.press(screen.getByRole('button', { name: /Sách thử nghiệm/ }));
  await fireEvent.press(screen.getByRole('button', { name: `${copy.hold}: B1` }));

  const confirm = screen.getAllByRole('button', { name: copy.hold }).at(-1)!;
  try {
    await pressTwiceBeforeCommit(confirm);
    expect(mockPost).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      request.resolve({});
      await request.promise;
    });
  }
});

test('a second admissions withdraw during the applications refresh is ignored', async () => {
  const copy = admissionsMessages.vi;
  const application = {
    id: 'adm-1', cycle: '2026-Q1', status: 'DRAFT', version: 1,
    fullName: 'Nguyễn Văn A', submittedAt: null, attachments: [], reviews: [],
  };
  mockQueries['content.admissions.mine'] = { data: [application] };
  const reload = deferred<void>();
  mockReload.mockImplementation(() => reload.promise);
  await render(screenElement(<AdmissionsScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', {
    name: joinMeta([application.fullName, `${copy.cycle}: ${application.cycle}`, copy.statusLabels.DRAFT]),
  }));
  await fireEvent.press(screen.getByRole('button', { name: copy.withdraw }));
  await pressConfirm(copy.withdraw, 1);
  expect(await screen.findByText(copy.withdrawn)).toBeOnTheScreen();
  expect(mockPost).toHaveBeenCalledTimes(1);

  const withdrawButton = screen.getByRole('button', { name: copy.withdraw });
  await reattempt(() => { fireEvent.press(withdrawButton); }, copy.withdraw);
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(withdrawButton).toBeDisabled();

  await act(async () => {
    reload.resolve();
    await reload.promise;
  });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(screen.getByText(copy.withdrawn)).toBeOnTheScreen();
  expect(screen.queryByText(copy.failed)).toBeNull();
});

test('same-frame repeated admissions confirmation sends one request', async () => {
  const copy = admissionsMessages.vi;
  const application = {
    id: 'adm-1', cycle: '2026-Q1', status: 'DRAFT', version: 1,
    fullName: 'Nguyễn Văn A', submittedAt: null, attachments: [], reviews: [],
  };
  mockQueries['content.admissions.mine'] = { data: [application] };
  const request = deferred<unknown>();
  mockPost.mockImplementation(() => request.promise);
  await render(screenElement(<AdmissionsScreen {...props} />));

  await fireEvent.press(screen.getByRole('button', {
    name: joinMeta([application.fullName, `${copy.cycle}: ${application.cycle}`, copy.statusLabels.DRAFT]),
  }));
  await fireEvent.press(screen.getByRole('button', { name: copy.withdraw }));
  const confirm = screen.getAllByRole('button', { name: copy.withdraw }).at(-1)!;
  try {
    await pressTwiceBeforeCommit(confirm);
    expect(mockPost).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      request.resolve({});
      await request.promise;
    });
  }
});
