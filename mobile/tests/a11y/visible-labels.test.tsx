import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '../../src/design/theme';
import { LocaleProvider } from '../../src/i18n/locale-provider';
import { assistantChatMessages } from '../../src/i18n/assistant-messages';
import { AnnouncementsScreen } from '../../src/screens/content/AnnouncementsScreen';
import { MessageBubble } from '../../src/screens/assistant/MessageBubble';
import type { ChatMessage } from '../../src/screens/assistant/useAssistantChat';
import type { MobileScreenProps } from '../../src/navigation/types';

jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'preview' },
  campusApi: new Proxy({}, { get: () => jest.fn(async () => ({ data: [] })) }),
  ApiClientError: class ApiClientError extends Error {},
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: async () => {}, setData: () => {} }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
}));

const navigation = {} as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;

type TestNode = { children: Array<string | TestNode> };
function textContent(node: TestNode): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('');
}

test('the announcements filter count is included in its accessible name', async () => {
  await render(
    <ThemeProvider forcedScheme="light">
      <LocaleProvider initialLocale="vi">
        <AnnouncementsScreen {...props} />
      </LocaleProvider>
    </ThemeProvider>,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Bộ lọc' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Khẩn' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Áp dụng' }));

  expect(screen.getByText('Bộ lọc (1)')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Bộ lọc (1)' })).toBeOnTheScreen();
});

test('a rated assistant feedback button exposes its visible selected status', async () => {
  const message: ChatMessage = {
    id: 'message-1',
    from: 'assistant',
    text: 'Trả lời mẫu.',
    feedback: { rating: 'UP', reason: 'HELPFUL' },
  };

  await render(
    <ThemeProvider forcedScheme="light">
      <MessageBubble message={message} copy={assistantChatMessages.vi} feedbackBusy={false} onRate={() => {}} />
    </ThemeProvider>,
  );

  expect(screen.getByText('✓ Hữu ích')).toBeOnTheScreen();
  const ratedButton = screen.getAllByRole('button', { name: 'Hữu ích' })
    .find((button) => textContent(button as unknown as TestNode).includes('✓ Hữu ích'));
  expect(ratedButton).toBeTruthy();
  expect(ratedButton?.props.accessibilityState?.selected).toBe(true);
  expect(screen.getByRole('button', { name: 'Chưa đúng' }).props.accessibilityState?.selected).toBe(false);
});
