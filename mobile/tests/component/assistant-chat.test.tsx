import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

const mockChat = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCancel = jest.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
const mockConversations = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockMessages = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockDelete = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined);
const mockPutFeedback = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined);

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
      cancel: (...args: unknown[]) => mockCancel(...args),
      conversationsPage: (...args: unknown[]) => mockConversations(...args),
      messagesPage: (...args: unknown[]) => mockMessages(...args),
      deleteConversation: (...args: unknown[]) => mockDelete(...args),
      putFeedback: (...args: unknown[]) => mockPutFeedback(...args),
      deleteFeedback: jest.fn(async () => undefined),
    },
  };
});
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(), setData: jest.fn() }),
}));

import { peekAssistantEntryScope, requestAssistantEntryScope } from '../../src/assistant/entry-scope';
import { ASSISTANT_MAX_MESSAGE_CHARS } from '../../src/api/assistant-limits';
import { assistantChatMessages } from '../../src/i18n/assistant-messages';
import type { MobileScreenProps } from '../../src/navigation/types';
import { AssistantChatScreen } from '../../src/screens/assistant/AssistantScreen';

const copy = assistantChatMessages.vi;
const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
const renderThemed = (el: ReactElement) => render(<ThemeProvider forcedScheme="light">{el}</ThemeProvider>);
function setWidth(w: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: w, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

const reply = (over: Record<string, unknown> = {}) => ({
  answer: 'Trả lời mẫu.',
  model: 'm', degraded: false, reasonCode: 'ANSWERED', locale: 'vi',
  citations: [], conversationId: 'c1', messageId: 'msg-1', requestId: 'r1',
  clientRequestId: 'req-fixed-1', turnId: 't1', terminalStatus: 'COMPLETED',
  ...over,
});

async function ask(text: string) {
  await fireEvent.changeText(screen.getByLabelText(copy.composerLabel), text);
  await fireEvent.press(screen.getByRole('button', { name: copy.send }));
}

describe('assistant composer and guards', () => {
  test('the input is capped at the server message limit', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    expect(screen.getByLabelText(copy.composerLabel).props.maxLength).toBe(ASSISTANT_MAX_MESSAGE_CHARS);
    expect(ASSISTANT_MAX_MESSAGE_CHARS).toBe(2000);
  });

  test('personal data is blocked before any request and the text stays in the composer', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('liên hệ me@example.com giúp mình');
    expect(await screen.findByText(copy.guardSensitive)).toBeOnTheScreen();
    expect(mockChat).not.toHaveBeenCalled();
    expect(screen.getByLabelText(copy.composerLabel).props.value).toBe('liên hệ me@example.com giúp mình');
  });

  test('an unsafe answer is replaced wholesale by the blocked copy', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply({ answer: 'Gọi GET /api/v1/admin/users để xem.' }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Cho mình biết API?');
    expect(await screen.findByText(copy.outputBlocked)).toBeOnTheScreen();
    expect(screen.queryByText(/\/api\/v1\/admin/)).toBeNull();
  });
});

describe('assistant scope, entry and quota', () => {
  test('the specialized scope is sent to the server', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply());
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: copy.scopeSpecialized }));
    await ask('Đề tài luận văn?');
    await waitFor(() => expect(mockChat).toHaveBeenCalled());
    expect((mockChat.mock.calls[0][0] as { scope: string }).scope).toBe('specialized');
  });

  test('the thesis entry opens in the specialized scope and the hand-off is one-shot', async () => {
    setWidth(360);
    requestAssistantEntryScope('specialized');
    await renderThemed(<AssistantChatScreen {...props} />);
    expect(screen.getByRole('tab', { name: copy.scopeSpecialized }).props.accessibilityState.selected).toBe(true);
    expect(peekAssistantEntryScope()).toBeNull();
  });

  test('a quota-degraded turn shows the limit and when it resets', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply({ degraded: true, reasonCode: 'QUOTA_EXCEEDED', answer: 'Đã hết lượt.', resetAt: '2026-10-30T00:00:00Z' }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Còn lượt không?');
    expect(await screen.findByText(copy.quotaTitle)).toBeOnTheScreen();
    expect(screen.getByText(/Bạn đã dùng hết 20 lượt hôm nay/)).toBeOnTheScreen();
  });
});

describe('assistant citations, feedback and history', () => {
  test('citations are collapsed behind the sources control and show their excerpt when opened', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply({
      citations: [{ id: 'k1', slug: 'hoc-phi', title: 'Quy chế học phí', source: 'Phòng Tài chính', locale: 'vi', excerpt: 'Học phí thu theo tín chỉ.' }],
    }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Học phí?');
    const sources = await screen.findByRole('button', { name: copy.sources.replace('{count}', '1') });
    expect(screen.queryByText('Học phí thu theo tín chỉ.')).toBeNull();
    await fireEvent.press(sources);
    expect(await screen.findByText('Học phí thu theo tín chỉ.')).toBeOnTheScreen();
    expect(screen.getByText('Quy chế học phí')).toBeOnTheScreen();
  });

  test('feedback is stored against the server message id', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply());
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Lịch thi?');
    await fireEvent.press(await screen.findByRole('button', { name: copy.helpful }));
    await waitFor(() => expect(mockPutFeedback).toHaveBeenCalledWith('msg-1', 'UP', undefined));
  });

  test('history lists conversations, loads one and deletes only after confirmation', async () => {
    setWidth(360);
    mockConversations.mockResolvedValue({
      data: [{ id: 'c9', title: 'Hỏi học phí', locale: 'vi', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }],
      nextCursor: null,
    });
    mockMessages.mockResolvedValue({
      data: [
        { id: 'm1', role: 'user', content: 'Học phí bao nhiêu?', createdAt: '2026-10-02T00:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'Theo biểu phí hiện hành.', createdAt: '2026-10-02T00:00:01Z', citations: [] },
      ],
      nextCursor: null,
    });
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: copy.history }));
    const row = await screen.findByRole('button', { name: /^Hỏi học phí,/ });
    await fireEvent.press(row);
    expect(await screen.findByText('Theo biểu phí hiện hành.')).toBeOnTheScreen();
    expect(mockMessages).toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: copy.history }));
    await fireEvent.press(await screen.findByRole('button', { name: `${copy.delete}: Hỏi học phí` }));
    expect(mockDelete).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('button', { name: copy.delete }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('c9'));
  });
});
