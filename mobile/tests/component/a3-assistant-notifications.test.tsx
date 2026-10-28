import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

const mockAssistantChat = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCancelAssistantRequest = jest.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live' },
  createAssistantClientRequestId: () => 'req-fixed-1',
  campusApi: {
    // Resolved lazily: the factory runs before the hoisted const bindings are initialised.
    assistantChat: (...args: unknown[]) => mockAssistantChat(...args),
    cancelAssistantRequest: (...args: unknown[]) => mockCancelAssistantRequest(...args),
    assistantConversationsPage: jest.fn(async () => ({ data: [] })),
    assistantConversationMessagesPage: jest.fn(async () => ({ data: [] })),
    deleteAssistantConversation: jest.fn(),
    enrollments: jest.fn(async () => []),
    notifications: jest.fn(async () => ({ data: [] })),
    markNotificationRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    registerPushDevice: jest.fn(),
    unregisterPushDevice: jest.fn(),
    assistantStream: jest.fn(() => ({
      stream: () => ({
        [Symbol.asyncIterator]() {
          return { next: () => Promise.resolve({ done: true, value: undefined }) };
        },
      }),
      cancel: jest.fn(async () => undefined),
    })),
  },
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code?: string;
    constructor(msg: string, status = 0, code?: string) { super(msg); this.status = status; this.code = code; }
  },
}));
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(), setData: jest.fn() }),
}));

import { AssistantChatScreen } from '../../src/screens/assistant/AssistantScreen';
import { NotificationsScreen } from '../../src/screens/student/NotificationsScreen';
import type { MobileScreenProps } from '../../src/navigation/types';

const navigation = { navigate: jest.fn(), signOut: jest.fn() } as unknown as MobileScreenProps['navigation'];
const props = { navigation, role: 'student' } as MobileScreenProps;
const renderThemed = (el: ReactElement) => render(<ThemeProvider forcedScheme="light">{el}</ThemeProvider>);
function setWidth(w: number) {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: w, height: 800, scale: 2, fontScale: 1 } as ReturnType<typeof Dimensions.get>);
}
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

const REPLY = {
  answer: 'Trả lời mẫu.',
  model: 'm', degraded: false, reasonCode: 'ANSWERED', locale: 'vi',
  citations: [], conversationId: 'c1', messageId: 'msg-1', requestId: 'r1',
  clientRequestId: 'req-fixed-1', turnId: 't1', terminalStatus: 'COMPLETED',
};

describe('assistant stream wiring (buffered, PARITY=false)', () => {
  test('send -> assistant message rendered, no streaming label', async () => {
    setWidth(360);
    mockAssistantChat.mockResolvedValue(REPLY);
    await renderThemed(<AssistantChatScreen {...props} />);
    const input = screen.getByLabelText('Câu hỏi của bạn');
    await fireEvent.changeText(input, 'Lịch thi?');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await waitFor(() => expect(screen.getByText('Trả lời mẫu.')).toBeOnTheScreen());
  });

  test('connection lost -> interrupted status + manual retry reuses clientRequestId', async () => {
    setWidth(360);
    mockAssistantChat.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(REPLY);
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Câu hỏi của bạn'), 'Học phí?');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await waitFor(() => expect(screen.getByText('Kết nối bị gián đoạn. Câu trả lời chưa được xác nhận.')).toBeOnTheScreen());
    expect(mockAssistantChat).toHaveBeenCalledTimes(1); // no auto resend
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại yêu cầu này' }));
    await waitFor(() => expect(screen.getByText('Trả lời mẫu.')).toBeOnTheScreen());
    expect(mockAssistantChat).toHaveBeenCalledTimes(2);
    const second = mockAssistantChat.mock.calls[1];
    expect(second[3]).toBe('req-fixed-1'); // same clientRequestId reused
  });

  test('stop calls cancel with the same clientRequestId', async () => {
    setWidth(360);
    mockAssistantChat.mockImplementation(() => new Promise(() => {}));
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Câu hỏi của bạn'), 'Điểm?');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    const stop = await screen.findByRole('button', { name: 'Dừng trả lời' });
    await fireEvent.press(stop);
    await waitFor(() => expect(mockCancelAssistantRequest).toHaveBeenCalledWith('req-fixed-1'));
  });

  test('STREAMING_UNSUPPORTED -> unavailable message, no silent parity claim', async () => {
    setWidth(360);
    mockAssistantChat.mockRejectedValue(Object.assign(new Error('u'), { code: 'STREAMING_UNSUPPORTED', status: 0 }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Câu hỏi của bạn'), 'X?');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await waitFor(() => expect(screen.getByText(/không thể đọc|unavailable|chưa sẵn sàng|gián đoạn/i)).toBeOnTheScreen());
  });
});

describe('push opt-in flag', () => {
  test('flag off renders no permission card', async () => {
    setWidth(360);
    await renderThemed(<NotificationsScreen {...props} />);
    expect(screen.queryByText('Allow notifications')).toBeNull();
    expect(screen.queryByText('Cho phép thông báo')).toBeNull();
  });
});
