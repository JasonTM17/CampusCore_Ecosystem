import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { tokens } from '../../src/design/tokens';
import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { libraryMessages } from '../../src/i18n/library-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

type QueryState = {
  data?: unknown;
  error?: string | null;
  warning?: string | null;
  errorStatus?: number | null;
  isLoading?: boolean;
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
  ApiClientError: class ApiClientError extends Error {},
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

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { campusApi } from '../../src/api/client';
import { LibraryScreen } from '../../src/screens/student/LibraryScreen';

const navigation = { navigate: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

const screenElement = (element: ReactElement) => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
  </ThemeProvider>
);

const title = {
  id: 'title-1', title: 'Sách thử nghiệm', author: 'Tác giả', category: 'CNTT', isbn: '978-604-0',
  totalCopies: 5, availableCopies: 3, version: 1,
  copies: [
    { id: 'copy-1', titleId: 'title-1', barcode: 'B1', status: 'AVAILABLE', version: 1 },
    { id: 'copy-2', titleId: 'title-1', barcode: 'B2', status: 'RESERVED', version: 1 },
  ],
};

const loan = {
  id: 'loan-1', copyId: 'copy-1', barcode: 'BAR-9', title: 'Sách thử nghiệm', status: 'RETURNED',
  requestedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-02T09:30:00Z', dueAt: '2026-10-17T10:15:00Z',
  cancelReason: 'Bạn đọc hủy', version: 4,
};

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockReload.mockReset();
  mockReload.mockResolvedValue(undefined);
  mockPost.mockReset();
  mockPost.mockResolvedValue({});
  mockQueries['content.library.catalogue.'] = { data: { items: [title], total: 1, hasMore: false } };
  mockQueries['content.library.loans'] = { data: [loan] };
  mockQueries['content.library.title.title-1.0'] = { data: title };
  jest.mocked(campusApi.libraryTitle).mockResolvedValue(title as never);
});

test('the catalogue card carries the ISBN and the web availability wording', async () => {
  await render(screenElement(<LibraryScreen {...props} />));

  expect(screen.getByText('Tác giả · CNTT · 978-604-0')).toBeOnTheScreen();
  expect(screen.getByText('Còn: 3/5')).toBeOnTheScreen();
});

test('the loan row keeps the barcode, the cancel reason and the time of day', async () => {
  await render(screenElement(<LibraryScreen {...props} />));
  await fireEvent.press(screen.getByRole('tab', { name: libraryMessages.vi.myLoans }));
  await fireEvent.press(screen.getByRole('tab', { name: libraryMessages.vi.loansHistory }));

  const row = screen.getByLabelText(/Sách thử nghiệm/);
  const label = String(row.props.accessibilityLabel);
  expect(label).toContain('BAR-9');
  expect(label).toContain('Giữ chỗ đến: 02/10/2026 16:30');
  expect(label).toContain('Hạn trả: 17/10/2026 17:15');
  expect(label).toContain('Bạn đọc hủy');
});

test('a returned loan uses the web success role', async () => {
  await render(screenElement(<LibraryScreen {...props} />));
  await fireEvent.press(screen.getByRole('tab', { name: libraryMessages.vi.myLoans }));
  await fireEvent.press(screen.getByRole('tab', { name: libraryMessages.vi.loansHistory }));

  const pill = screen.getByText(libraryMessages.vi.statusLabels.RETURNED).parent;
  expect(pill).toHaveStyle({ backgroundColor: tokens.colors.successFixed });
});

test('each available copy carries its own hold action', async () => {
  await render(screenElement(<LibraryScreen {...props} />));
  await fireEvent.press(screen.getByRole('button', { name: /Sách thử nghiệm/ }));

  expect(screen.queryByRole('button', { name: `${libraryMessages.vi.hold}: B2` })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: `${libraryMessages.vi.hold}: B1` }));
  await fireEvent.press(screen.getByRole('button', { name: libraryMessages.vi.hold }));
  await act(async () => { await Promise.resolve(); });

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost.mock.calls[0][0]).toBe('/library/requests');
  expect(mockPost.mock.calls[0][1]).toEqual({ copyId: 'copy-1' });
});
