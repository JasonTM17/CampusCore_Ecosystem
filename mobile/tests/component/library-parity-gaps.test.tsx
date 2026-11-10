import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { libraryMessages } from '../../src/i18n/library-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

type QueryState = { data?: unknown; isLoading?: boolean };

const mockQueries: Record<string, QueryState> = {};

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', get: jest.fn(async () => []), post: jest.fn(), delete: jest.fn() },
  campusApi: {},
  createAssistantClientRequestId: () => 'library-parity',
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: (key: string) => {
    const state = mockQueries[key] ?? {};
    return {
      data: state.data,
      error: null,
      warning: null,
      errorStatus: null,
      isLoading: state.isLoading ?? false,
      isStale: false,
      reload: jest.fn(async () => {}),
      setData: jest.fn(),
    };
  },
}));

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { LibraryScreen } from '../../src/screens/student/LibraryScreen';

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;
const wrap = (element: ReactElement) => (
  <ThemeProvider forcedScheme="light">
    <LocaleProvider initialLocale="vi">{element}</LocaleProvider>
  </ThemeProvider>
);

const title = {
  id: 'title-1',
  title: 'Sách khớp lọc',
  author: 'A',
  category: 'CNTT',
  isbn: '978',
  totalCopies: 0,
  availableCopies: 0,
  version: 1,
  copies: [],
};

beforeEach(() => {
  for (const key of Object.keys(mockQueries)) delete mockQueries[key];
  mockQueries['content.library.catalogue.'] = { data: { items: [title], hasMore: false } };
  mockQueries['content.library.loans'] = { data: [] };
});

test('the library header shows the web eyebrow and description', async () => {
  await render(wrap(<LibraryScreen {...props} />));
  expect(screen.getByText(libraryMessages.vi.eyebrow)).toBeOnTheScreen();
  expect(screen.getByText(libraryMessages.vi.description)).toBeOnTheScreen();
});

test('an availability filter with no matching titles uses the filtered empty title', async () => {
  await render(wrap(<LibraryScreen {...props} />));
  await fireEvent.press(screen.getByRole('button', { name: libraryMessages.vi.availableOnly }));

  expect(screen.getByText(libraryMessages.vi.emptyCatalogue)).toBeOnTheScreen();
});

test('a loan without title or barcode still exposes the copy id to assistive tech', async () => {
  mockQueries['content.library.loans'] = {
    data: [{
      id: 'loan-x',
      copyId: 'copy-uuid-99',
      barcode: null,
      title: null,
      status: 'REQUESTED',
      requestedAt: '2026-10-01T00:00:00Z',
      version: 1,
    }],
  };
  await render(wrap(<LibraryScreen {...props} />));
  await fireEvent.press(screen.getByRole('tab', { name: libraryMessages.vi.myLoans }));

  const rows = screen.getAllByLabelText(/copy-uuid-99/);
  expect(rows.some((node) => String(node.props.accessibilityLabel).includes('copy-uuid-99'))).toBe(true);
});
