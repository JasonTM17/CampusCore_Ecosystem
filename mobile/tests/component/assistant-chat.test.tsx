import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, FlatList, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ComponentProps, ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ThemeProvider } from '../../src/design/theme';
import { minTapTarget, tokens } from '../../src/design/tokens';

const mockChat = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockFilterChipRender = jest.fn();
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
jest.mock('../../src/components/ui/index', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('../../src/components/ui/index')>('../../src/components/ui/index');
  return {
    ...actual,
    FilterChip: (props: ComponentProps<typeof actual.FilterChip>) => {
      mockFilterChipRender();
      return React.createElement(actual.FilterChip, props);
    },
  };
});
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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
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
function setMatrix(width: number, fontScale: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 800, scale: 2, fontScale } as ReturnType<typeof Dimensions.get>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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

type TestNode = { parent?: TestNode | null; type?: string; props?: Record<string, unknown> };
function ancestorWithStyle(node: TestNode, match: (style: ViewStyle) => boolean): TestNode | null {
  let current = node.parent;
  while (current) {
    const flat = StyleSheet.flatten(current.props?.style as StyleProp<ViewStyle>);
    if (flat && match(flat)) return current;
    current = current.parent ?? null;
  }
  return null;
}
function scrollAncestor(node: TestNode): TestNode | null {
  let current = node.parent;
  while (current) {
    if (String(current.type ?? '').includes('ScrollView')) return current;
    current = current.parent ?? null;
  }
  return null;
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
  test('a remounted assistant starts without the prior conversation', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply());
    const first = await renderThemed(<AssistantChatScreen {...props} />);
    await ask('First account question');
    expect(await screen.findByText('Trả lời mẫu.')).toBeOnTheScreen();

    await first.unmount();
    await renderThemed(<AssistantChatScreen {...props} />);

    expect(screen.queryByText('First account question')).toBeNull();
    expect(screen.queryByText('Trả lời mẫu.')).toBeNull();
  });

  test('the input is capped at the server message limit', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    expect(screen.getByLabelText(copy.composerLabel).props.maxLength).toBe(ASSISTANT_MAX_MESSAGE_CHARS);
    expect(ASSISTANT_MAX_MESSAGE_CHARS).toBe(2000);
  });

  test('typing in the composer does not rerender the suggestions', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    const initialSuggestionRenders = mockFilterChipRender.mock.calls.length;
    expect(initialSuggestionRenders).toBeGreaterThan(0);

    await fireEvent.changeText(screen.getByLabelText(copy.composerLabel), 'A question');

    expect(mockFilterChipRender).toHaveBeenCalledTimes(initialSuggestionRenders);
  });

  test('scrolling away from the end keeps the thread reading position during streaming', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    const list = screen.getByTestId('assistant-thread');
    const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd').mockImplementation(() => {});
    scrollToEnd.mockClear();

    await fireEvent.scroll(list, {
      nativeEvent: {
        contentOffset: { x: 0, y: 600 },
        contentSize: { width: 360, height: 1_600 },
        layoutMeasurement: { width: 360, height: 400 },
      },
    });
    await fireEvent(list, 'contentSizeChange', 360, 1_700);

    expect(scrollToEnd).not.toHaveBeenCalled();
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
  test('invalidates a pending history response on unmount', () => {
    const source = readFileSync(resolve(__dirname, '../../src/screens/assistant/useAssistantChat.ts'), 'utf8');
    expect(source).toMatch(/useEffect\(\(\) => \(\) => \{\s*historySeq\.current \+= 1;\s*\}, \[\]\);/);
  });

  test('citations are collapsed behind the sources control and show their excerpt when opened', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply({
      citations: [{ id: 'k1', slug: 'hoc-phi', title: 'Quy chế học phí', source: 'Phòng Tài chính', locale: 'vi', excerpt: 'Học phí thu theo tín chỉ.' }],
    }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Học phí?');
    const sources = await screen.findByRole('button', { name: copy.sources.replace('{count}', '1') });
    const sourcesStyle = StyleSheet.flatten(sources.props.style);
    expect(sourcesStyle.minHeight).toBeGreaterThanOrEqual(minTapTarget);
    expect(sourcesStyle.minWidth).toBeGreaterThanOrEqual(minTapTarget);
    expect(screen.queryByText('Học phí thu theo tín chỉ.')).toBeNull();
    await fireEvent.press(sources);
    expect(await screen.findByText('Học phí thu theo tín chỉ.')).toBeOnTheScreen();
    expect(screen.getByText('Quy chế học phí')).toBeOnTheScreen();
  });

  test('feedback reason chips meet the 48dp minimum on both axes', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply());
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Lịch thi?');
    await fireEvent.press(await screen.findByRole('button', { name: copy.helpful }));
    const reason = await screen.findAllByRole('button', { name: copy.reasons.HELPFUL }).then((buttons) => buttons[buttons.length - 1]);
    const style = StyleSheet.flatten(reason.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(minTapTarget);
    expect(style.minWidth).toBeGreaterThanOrEqual(minTapTarget);
  });

  test('feedback is stored against the server message id', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply());
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Lịch thi?');
    await fireEvent.press(await screen.findByRole('button', { name: copy.helpful }));
    await waitFor(() => expect(mockPutFeedback).toHaveBeenCalledWith('msg-1', 'UP', undefined));
  });

  test('same-frame repeated feedback sends one request', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply());
    const request = deferred<unknown>();
    mockPutFeedback.mockImplementation(() => request.promise);
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Lịch thi?');

    try {
      await pressTwiceBeforeCommit(await screen.findByRole('button', { name: copy.helpful }));
      expect(mockPutFeedback).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        request.resolve(undefined);
        await request.promise;
      });
    }
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

describe('assistant large-font and expanded-window layout', () => {
  test('the history list is bounded inside the sheet so a long history stays scrollable', async () => {
    setMatrix(360, 2);
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, title: `Cuộc trò chuyện ${i}`, locale: 'vi',
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
    }));
    mockConversations.mockResolvedValue({ data: items, nextCursor: null });
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: copy.history }));
    const row = (await screen.findByText('Cuộc trò chuyện 0')) as unknown as TestNode;
    const list = scrollAncestor(row);
    expect(list).not.toBeNull();
    expect(StyleSheet.flatten(list?.props?.style as StyleProp<ViewStyle>)?.flexShrink).toBe(1);
  });

  test('the message column keeps the shared content width on expanded windows', async () => {
    setMatrix(1080, 1);
    mockChat.mockResolvedValue(reply());
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Câu hỏi?');
    const answer = (await screen.findByText('Trả lời mẫu.')) as unknown as TestNode;
    const cap = tokens.windowClasses.contentMaxWidth.expanded;
    expect(ancestorWithStyle(answer, (style) => style.maxWidth === cap)).not.toBeNull();
  });

  test('the message column stays full width on compact windows', async () => {
    setMatrix(360, 1);
    mockChat.mockResolvedValue(reply());
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Câu hỏi?');
    const answer = (await screen.findByText('Trả lời mẫu.')) as unknown as TestNode;
    const cap = tokens.windowClasses.contentMaxWidth.expanded;
    expect(ancestorWithStyle(answer, (style) => style.maxWidth === cap)).toBeNull();
  });

  test('a long conversation title is ellipsised visually but kept whole for screen readers', async () => {
    setMatrix(360, 2);
    const longTitle = 'A'.repeat(120);
    mockConversations.mockResolvedValue({
      data: [{ id: 'c-long', title: longTitle, locale: 'vi', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }],
      nextCursor: null,
    });
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: copy.history }));
    const select = await screen.findByRole('button', { name: /^A+, / });
    expect(select.props.accessibilityLabel).toContain(longTitle);
    expect(screen.getByText(`${longTitle.slice(0, 80)}…`)).toBeOnTheScreen();
  });
});

describe('assistant copy and status parity with the web workspace', () => {
  test('the specialized empty state shows the web sentence and its four curated suggestions', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: copy.scopeSpecialized }));
    expect(await screen.findByText('Đặt câu hỏi chuyên môn về lập trình, cơ sở dữ liệu, kiến trúc phần mềm, kiểm thử, DevOps, an toàn thông tin và lộ trình nghề nghiệp.')).toBeOnTheScreen();
    for (const suggestion of [
      'SOLID và design pattern ứng dụng thế nào?',
      'Chuẩn hóa CSDL và tối ưu truy vấn SQL',
      'Viết unit test và TDD hiệu quả',
      'Lộ trình nghề nghiệp kỹ thuật phần mềm',
    ]) {
      expect(screen.getByText(suggestion)).toBeOnTheScreen();
    }
  });

  test('the specialized scope shows the web title and tagline', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: copy.scopeSpecialized }));
    expect(await screen.findByText('Trợ lý chuyên sâu')).toBeOnTheScreen();
    expect(screen.getByText('Hỏi đáp chuyên môn: lập trình, CSDL, kiến trúc, kiểm thử, nghề nghiệp.')).toBeOnTheScreen();
  });

  test('the composer uses the web scope placeholder and send label', async () => {
    setWidth(360);
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: copy.scopeSpecialized }));
    expect(screen.getByPlaceholderText('Hỏi về lập trình, cơ sở dữ liệu, kiểm thử hoặc kỹ thuật phần mềm…')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Gửi tin nhắn' })).toBeOnTheScreen();
  });

  test('an answered reply carries the web provenance badge', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply());
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Học phí?');
    expect(await screen.findByText('Trả lời dựa trên hướng dẫn đã duyệt')).toBeOnTheScreen();
  });

  test('a degraded reply uses the web degraded sentence', async () => {
    setWidth(360);
    mockChat.mockResolvedValue(reply({ answer: 'Hướng dẫn đã duyệt.', degraded: true, reasonCode: 'NO_MATCH' }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Học phí?');
    expect(await screen.findByText('Đang dùng hướng dẫn đã duyệt trong lúc AI tạm thời chưa sẵn sàng')).toBeOnTheScreen();
  });

  test('a session failure offers the web sign-in action', async () => {
    setWidth(360);
    mockChat.mockRejectedValue(Object.assign(new Error('unauthorized'), { code: 'UNAUTHORIZED', status: 401 }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await ask('Học phí?');
    await waitFor(() => expect(screen.getByText('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')).toBeOnTheScreen());
    expect(screen.getByLabelText(copy.composerLabel).props.editable).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Đăng nhập lại' }));
    expect(navigation.navigate).toHaveBeenCalledWith('auth.signIn');
  });

  test('the history sheet uses the web conversation vocabulary', async () => {
    setWidth(360);
    mockConversations.mockResolvedValue({ data: [], nextCursor: null });
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Lịch sử hội thoại' }));
    expect(await screen.findByText('Chưa có hội thoại nào được lưu.')).toBeOnTheScreen();
  });

  test('history messages show the web day and month time', async () => {
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
    await fireEvent.press(await screen.findByRole('button', { name: /^Hỏi học phí,/ }));
    expect(await screen.findByText('Theo biểu phí hiện hành.')).toBeOnTheScreen();
    expect(screen.getAllByText('02/10 07:00').length).toBeGreaterThan(0);
  });
});
