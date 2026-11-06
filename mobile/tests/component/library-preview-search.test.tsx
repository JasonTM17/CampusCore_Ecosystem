import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { libraryMessages } from '../../src/i18n/library-messages';
import type { MobileScreenProps } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview', get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  campusApi: new Proxy({}, { get: () => jest.fn() }),
  createAssistantClientRequestId: () => 'preview-search-test',
  ApiClientError: class ApiClientError extends Error {},
}));

jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, errorStatus: null, isLoading: false, reload: jest.fn(async () => {}), setData: jest.fn() }),
}));

jest.mock('../../src/session/SessionContext', () => ({
  useSession: () => ({ kind: 'preview', role: 'student', capabilities: [] }),
}));

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../../src/api/parity-api', () => ({
  parityApi: new Proxy({}, { get: () => jest.fn(async () => ({ items: [], hasMore: false })) }),
}));

import { LibraryScreen } from '../../src/screens/student/LibraryScreen';

const props = { navigation: { navigate: jest.fn() }, role: 'student' } as unknown as MobileScreenProps;

test('preview catalogue search filters the displayed titles on submit', async () => {
  await render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="en">
        <LibraryScreen {...props} />
      </LocaleProvider>
    </ThemeProvider>,
  );

  const search = screen.getByLabelText(libraryMessages.en.search);
  await fireEvent.changeText(search, 'advanced');
  await fireEvent(search, 'submitEditing', { nativeEvent: { text: 'advanced' } });

  expect(screen.getByText('Advanced databases')).toBeOnTheScreen();
  expect(screen.queryByText('Introduction to data structures')).toBeNull();
});
