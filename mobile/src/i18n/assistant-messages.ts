export type AssistantMessagesLocale = 'en' | 'vi';

const en = {
  streamingStatus: 'Answering…',
  completedStatus: 'Answer received.',
  stoppedStatus: 'Answer stopped.',
  interruptedStatus: 'Connection lost. The answer is unconfirmed.',
  retryAction: 'Retry this request',
  retryingStatus: 'Retrying the same request…',
  busy: 'An answer is already in progress.',
  rateLimited: 'Too many requests. Try again in {seconds} seconds.',
  quotaExceeded: 'You have used today’s assistant allowance.',
  streamInvalid: 'The answer could not be read completely. Try again.',
  sessionExpired: 'Your session expired. Please sign in again.',
  forbidden: 'This account cannot use the assistant.',
  unavailable: 'The assistant is unavailable right now.',
  cancelFailed: 'The request could not be stopped. Wait for the answer or try again.',
  a11yStreaming: 'The assistant is generating a response.',
  a11yCompleted: 'The assistant has answered.',
  a11yStopped: 'Answer stopped.',
  a11yInterrupted: 'Connection lost.',
};

const vi = {
  streamingStatus: 'Đang tạo câu trả lời…',
  completedStatus: 'Đã nhận câu trả lời.',
  stoppedStatus: 'Đã dừng câu trả lời.',
  interruptedStatus: 'Kết nối bị gián đoạn. Câu trả lời chưa được xác nhận.',
  retryAction: 'Thử lại yêu cầu này',
  retryingStatus: 'Đang thử lại cùng yêu cầu…',
  busy: 'Một câu trả lời đang được xử lý.',
  rateLimited: 'Bạn vừa gửi quá nhiều yêu cầu. Hãy thử lại sau {seconds} giây.',
  quotaExceeded: 'Bạn đã dùng hết hạn mức trợ lý hôm nay.',
  streamInvalid: 'Không thể đọc đầy đủ câu trả lời. Hãy thử lại.',
  sessionExpired: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  forbidden: 'Tài khoản hiện không được phép dùng trợ lý.',
  unavailable: 'Trợ lý hiện chưa sẵn sàng.',
  cancelFailed: 'Chưa thể dừng yêu cầu. Hãy đợi câu trả lời hoặc thử lại.',
  a11yStreaming: 'Trợ lý đang tạo câu trả lời.',
  a11yCompleted: 'Trợ lý đã trả lời.',
  a11yStopped: 'Đã dừng câu trả lời.',
  a11yInterrupted: 'Kết nối bị gián đoạn.',
} satisfies Record<keyof typeof en, string>;

export const assistantMessages = { en, vi };
