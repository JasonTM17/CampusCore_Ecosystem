import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactElement } from 'react';

import { ThemeProvider } from '../../src/design/theme';

const mockAssistantChat = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCancelAssistantRequest = jest.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
jest.mock('../../src/api/client', () => ({
  apiClient: { mode: 'live', baseUrl: 'http://localhost' },
  createAssistantClientRequestId: () => 'req-fixed-1',
  campusApi: {
    enrollments: jest.fn(async () => []),
    notifications: jest.fn(async () => ({ data: [] })),
    markNotificationRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    registerPushDevice: jest.fn(),
    unregisterPushDevice: jest.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code?: string;
    constructor(msg: string, status = 0, code?: string) { super(msg); this.status = status; this.code = code; }
  },
}));
// The real runtime (buffered transport + turn orchestrator) runs; only the wire calls are replaced.
jest.mock('../../src/api/assistant-api', () => {
  const actual = jest.requireActual('../../src/api/assistant-api') as Record<string, unknown>;
  return {
    ...actual,
    assistantApi: {
      chat: (...args: unknown[]) => mockAssistantChat(...args),
      cancel: (...args: unknown[]) => mockCancelAssistantRequest(...args),
      conversationsPage: jest.fn(async () => ({ data: [], nextCursor: null })),
      messagesPage: jest.fn(async () => ({ data: [], nextCursor: null })),
      deleteConversation: jest.fn(),
      putFeedback: jest.fn(),
      deleteFeedback: jest.fn(),
    },
  };
});
jest.mock('../../src/hooks/useScreenQuery', () => ({
  useScreenQuery: () => ({ data: undefined, error: null, warning: null, isLoading: false, reload: jest.fn(), setData: jest.fn() }),
}));

import { AssistantChatScreen } from '../../src/screens/assistant/AssistantScreen';
import { assistantMessages } from '../../src/i18n/assistant-messages';
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

  test('connection lost -> the orchestrator reconciles with the same clientRequestId, no second turn is created', async () => {
    setWidth(360);
    mockAssistantChat.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(REPLY);
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Câu hỏi của bạn'), 'Học phí?');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await waitFor(() => expect(screen.getByText('Trả lời mẫu.')).toBeOnTheScreen());
    expect(mockAssistantChat).toHaveBeenCalledTimes(2);
    const first = mockAssistantChat.mock.calls[0][0] as { clientRequestId: string };
    const second = mockAssistantChat.mock.calls[1][0] as { clientRequestId: string };
    expect(second.clientRequestId).toBe(first.clientRequestId);
    expect(screen.queryByText('Kết nối bị gián đoạn. Câu trả lời chưa được xác nhận.')).toBeNull();
  });

  test('connection stays lost -> interrupted status and a manual retry reuses the clientRequestId', async () => {
    setWidth(360);
    mockAssistantChat.mockRejectedValueOnce(new TypeError('network')).mockRejectedValueOnce(new TypeError('network'));
    mockAssistantChat.mockResolvedValue(REPLY);
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Câu hỏi của bạn'), 'Học phí?');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await waitFor(() => expect(screen.getByText('Kết nối bị gián đoạn. Câu trả lời chưa được xác nhận.')).toBeOnTheScreen());
    const before = mockAssistantChat.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Thử lại yêu cầu này' }));
    await waitFor(() => expect(screen.getByText('Trả lời mẫu.')).toBeOnTheScreen());
    expect(mockAssistantChat.mock.calls.length).toBeGreaterThan(before);
    const ids = new Set(mockAssistantChat.mock.calls.map((call) => (call[0] as { clientRequestId: string }).clientRequestId));
    expect(ids.size).toBe(1);
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

  test('STREAMING_UNSUPPORTED with no status -> interrupted message and retry, no silent parity claim', async () => {
    setWidth(360);
    mockAssistantChat.mockRejectedValue(Object.assign(new Error('u'), { code: 'STREAMING_UNSUPPORTED', status: 0 }));
    await renderThemed(<AssistantChatScreen {...props} />);
    await fireEvent.changeText(screen.getByLabelText('Câu hỏi của bạn'), 'X?');
    await fireEvent.press(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    await waitFor(() => expect(screen.getByText(assistantMessages.vi.interruptedStatus)).toBeOnTheScreen());
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
