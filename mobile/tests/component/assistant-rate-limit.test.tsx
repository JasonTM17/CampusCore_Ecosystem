import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';

const mockChat = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', baseUrl: 'http://localhost' },
  createAssistantClientRequestId: () => 'req-fixed-1',
  campusApi: {},
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/api/assistant-api', () => {
  const actual = jest.requireActual('../../src/api/assistant-api') as Record<string, unknown>;
  return {
    ...actual,
    assistantApi: {
      chat: (...args: unknown[]) => mockChat(...args),
      cancel: jest.fn(async () => undefined),
      conversationsPage: jest.fn(async () => ({ data: [], nextCursor: null })),
      messagesPage: jest.fn(async () => ({ data: [], nextCursor: null })),
      deleteConversation: jest.fn(async () => undefined),
      putFeedback: jest.fn(async () => undefined),
      deleteFeedback: jest.fn(async () => undefined),
    },
  };
});
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(), setData: jest.fn() }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import { assistantChatMessages } from '../../src/i18n/assistant-messages';
import type { MobileScreenProps } from '../../src/navigation/types';
import { AssistantChatScreen } from '../../src/screens/assistant/AssistantScreen';

const copy = assistantChatMessages.vi;
const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
const renderThemed = (el: ReactElement) => render(
  <LocaleProvider initialLocale="vi">
    <ThemeProvider forcedScheme="light">{el}</ThemeProvider>
  </LocaleProvider>,
);

function setWidth(w: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: w, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}

/** Shaped like the JSON client's 429 error, including the response's Retry-After header. */
const rateLimited = (retryAfter?: string) => Object.assign(new Error('Too many requests'), {
  status: 429,
  code: 'RATE_LIMIT_EXCEEDED',
  retryable: true,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});

async function ask(text: string) {
  await fireEvent.changeText(screen.getByLabelText(copy.composerLabel), text);
  await fireEvent.press(screen.getByRole('button', { name: copy.send }));
}

afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

describe('assistant rate-limit copy', () => {
  test('the server retry window replaces the fallback seconds', async () => {
    setWidth(360);
    mockChat.mockRejectedValue(rateLimited('45'));
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Hỏi nhanh một câu?');
    expect(await screen.findByText(/45 giây/)).toBeOnTheScreen();
    expect(screen.queryByText(/30 giây/)).toBeNull();
  });

  test('a rate limit without a retry window keeps the fallback seconds', async () => {
    setWidth(360);
    mockChat.mockRejectedValue(rateLimited());
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Hỏi nhanh một câu?');
    expect(await screen.findByText(/30 giây/)).toBeOnTheScreen();
  });
});
