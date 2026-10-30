import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import type { AssistantConversation } from '../../src/api/client';

const mockChat = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockMessages = jest.fn<(...args: unknown[]) => Promise<unknown>>();

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
      messagesPage: (...args: unknown[]) => mockMessages(...args),
      deleteConversation: jest.fn(async () => undefined),
      putFeedback: jest.fn(async () => undefined),
      deleteFeedback: jest.fn(async () => undefined),
    },
  };
});
jest.mock('../../src/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'vi', formatDateTime: () => 'fmt' }),
}));

import { useAssistantChat } from '../../src/screens/assistant/useAssistantChat';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const conv = (id: string): AssistantConversation => ({
  id, title: `t-${id}`, locale: 'vi', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
});

const page = (tag: string, nextCursor: string | null = null) => ({
  data: [{ id: `m-${tag}`, role: 'assistant', content: `answer-${tag}`, createdAt: '2026-10-02T00:00:00Z', citations: [] }],
  nextCursor,
});

const texts = (chat: { messages: Array<{ text: string }> }) => chat.messages.map((item) => item.text);

beforeEach(() => {
  mockChat.mockReset();
  mockMessages.mockReset();
});
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

describe('assistant conversation selection', () => {
  test('the newest selection wins when history pages resolve out of order', async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    mockMessages.mockImplementation((...args: unknown[]) => (args[0] === 'conv-a' ? a.promise : b.promise));
    const { result } = await renderHook(() => useAssistantChat());
    await act(async () => { void result.current.selectConversation(conv('conv-a')); });
    await act(async () => { void result.current.selectConversation(conv('conv-b')); });
    await act(async () => { b.resolve(page('b')); });
    await act(async () => { a.resolve(page('a')); });
    expect(result.current.conversationId).toBe('conv-b');
    expect(texts(result.current)).toEqual(['answer-b']);
  });

  test('a stale selection failure cannot flag the drawer of the newest selection', async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    mockMessages.mockImplementation((...args: unknown[]) => (args[0] === 'conv-a' ? a.promise : b.promise));
    const { result } = await renderHook(() => useAssistantChat());
    await act(async () => { void result.current.selectConversation(conv('conv-a')); });
    await act(async () => { void result.current.selectConversation(conv('conv-b')); });
    await act(async () => { b.resolve(page('b')); });
    await act(async () => { a.reject(new Error('gone')); });
    expect(result.current.conversationId).toBe('conv-b');
    expect(texts(result.current)).toEqual(['answer-b']);
    expect(result.current.history.error).toBe(false);
  });

  test('an earlier page for a deselected thread is not prepended to the current one', async () => {
    const b = deferred<unknown>();
    const earlierB = deferred<unknown>();
    const a = deferred<unknown>();
    mockMessages.mockImplementation((...args: unknown[]) => {
      const options = args[1] as { cursor?: string } | undefined;
      if (args[0] === 'conv-b') return options?.cursor ? earlierB.promise : b.promise;
      return a.promise;
    });
    const { result } = await renderHook(() => useAssistantChat());
    await act(async () => { void result.current.selectConversation(conv('conv-b')); });
    await act(async () => { b.resolve(page('b', 'cursor-b')); });
    await act(async () => { void result.current.loadEarlier(); });
    await act(async () => { void result.current.selectConversation(conv('conv-a')); });
    await act(async () => { a.resolve(page('a')); });
    await act(async () => { earlierB.resolve(page('b-earlier')); });
    expect(result.current.conversationId).toBe('conv-a');
    expect(texts(result.current)).toEqual(['answer-a']);
    expect(result.current.failure).toBeNull();
  });

  test('clearing the thread does not let a pending selection revive the old thread', async () => {
    const a = deferred<unknown>();
    mockMessages.mockImplementation(() => a.promise);
    const { result } = await renderHook(() => useAssistantChat());
    await act(async () => { void result.current.selectConversation(conv('conv-a')); });
    await act(async () => { result.current.newChat(); });
    await act(async () => { a.resolve(page('a')); });
    expect(result.current.conversationId).toBeUndefined();
    expect(result.current.messages).toEqual([]);
  });

  test('switching scope invalidates a pending selection from the previous scope', async () => {
    const a = deferred<unknown>();
    mockMessages.mockImplementation(() => a.promise);
    const { result } = await renderHook(() => useAssistantChat());
    await act(async () => { void result.current.selectConversation(conv('conv-a')); });
    await act(async () => { result.current.changeScope('specialized'); });
    await act(async () => { a.resolve(page('a')); });
    expect(result.current.conversationId).toBeUndefined();
    expect(result.current.messages).toEqual([]);
  });

  test('the next send targets the newest selected conversation', async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    mockMessages.mockImplementation((...args: unknown[]) => (args[0] === 'conv-a' ? a.promise : b.promise));
    mockChat.mockResolvedValue({
      answer: 'Trả lời.', model: 'm', degraded: false, reasonCode: 'ANSWERED', locale: 'vi',
      citations: [], conversationId: 'conv-b', messageId: 'msg-b', requestId: 'r1',
      clientRequestId: 'req-fixed-1', turnId: 't1', terminalStatus: 'COMPLETED',
    });
    const { result } = await renderHook(() => useAssistantChat());
    await act(async () => { void result.current.selectConversation(conv('conv-a')); });
    await act(async () => { void result.current.selectConversation(conv('conv-b')); });
    await act(async () => { b.resolve(page('b')); });
    await act(async () => { a.resolve(page('a')); });
    await act(async () => { result.current.setDraft('Câu hỏi?'); });
    await act(async () => { await result.current.send(); });
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect((mockChat.mock.calls[0][0] as { conversationId?: string }).conversationId).toBe('conv-b');
  });
});
