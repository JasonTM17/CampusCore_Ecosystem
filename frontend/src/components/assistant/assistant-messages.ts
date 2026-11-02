/**
 * Localized copy for the bounded assistant display window and the dedicated
 * stream-progress live region.
 *
 * The assistant's existing catalogue lives in `src/i18n/messages.ts`; this
 * module follows the domain-catalogue pattern (`library-messages.ts`,
 * `careers-messages.ts`) for the new P4d/F-14 strings without editing the
 * shared catalogue.
 */

export const ASSISTANT_STREAM_PROGRESS_STEP = 120;

export const assistantWindowMessages = {
  vi: {
    resolver: {
      defaultName: 'bạn',
      greeting: {
        header: 'Chào **{displayName}**! Mình là **Trợ lý học vụ CampusUTE**.',
        body: {
          introduction:
            'Mình hỗ trợ tra cứu thông tin học vụ công khai và dữ liệu cá nhân mà tài khoản của bạn được phép xem. Bạn có thể hỏi về:',
          topics: [
            '1. **Lịch học**: lớp học, thời gian, phòng và lịch theo ngày.',
            '2. **Điểm số**: điểm học phần, GPA và bảng điểm.',
            '3. **Đăng ký học phần**: điều kiện, thời hạn và số tín chỉ theo từng học kỳ.',
            '4. **Đồ án hoặc khóa luận**: tiến độ, đề tài và các mốc cần lưu ý.',
            '5. **Thông báo và quy định**: hướng dẫn, chính sách và biểu mẫu học vụ.',
          ],
          closing: 'Bạn muốn bắt đầu với nội dung nào?',
        },
      },
      capabilities: {
        introduction: 'Mình là **Trợ lý học vụ CampusUTE**.',
        lead: 'Mình có thể:',
        points: [
          '- Tra cứu lịch học, điểm số, thông báo và tiến độ học tập của bạn khi dữ liệu được cung cấp.',
          '- Giải thích các hướng dẫn học vụ công khai dựa trên nguồn đã được duyệt.',
          '- Hỗ trợ sinh viên và giảng viên theo quyền truy cập của từng tài khoản.',
        ],
        closing:
          'Nếu chưa đủ căn cứ, mình sẽ nói rõ thay vì tự suy đoán. Bạn có thể hỏi: *"Hôm nay tôi có lịch học không?"* hoặc *"Điểm GPA của tôi là bao nhiêu?"*.',
      },
      thankYou:
        'Không có gì! Nếu cần, bạn có thể hỏi mình về lịch học, điểm số, đăng ký học phần hoặc đồ án tốt nghiệp.',
      goodbye: 'Hẹn gặp lại **{displayName}**. Chúc bạn học tập hiệu quả!',
    },
    clipboard: {
      copyFailed: 'Không thể sao chép vào bộ nhớ tạm.',
    },
    specialized: {
      retry: 'Gửi lại câu hỏi',
    },
    returnToLatest: 'Quay lại mới nhất',
    returningToLatest: 'Đang tải lại các tin nhắn mới nhất…',
    returnToLatestHint: 'Tạm dừng gửi khi bạn đang xem tin nhắn cũ.',
    historyNavigationLocked:
      'Không thể tải tin nhắn cũ khi đang trả lời hoặc lưu phản hồi.',
    windowTrimmed:
      'Các tin nhắn cũ hơn đã được ẩn để giữ khung chat gọn. Câu trả lời cục bộ đã ẩn có thể không khôi phục được.',
    streamProgressStart: 'Đang nhận câu trả lời…',
    streamProgressSlowStart: 'Vẫn đang nhận câu trả lời…',
    streamProgress: 'Đang nhận câu trả lời… {count} ký tự',
    streamProgressSlow: 'Vẫn đang nhận câu trả lời… {count} ký tự',
  },
  en: {
    resolver: {
      defaultName: 'there',
      greeting: {
        header: 'Hello **{displayName}**! I’m the **CampusUTE academic assistant**.',
        body: {
          introduction:
            'I can help with public academic guidance and personal records that your account is allowed to view. You can ask about:',
          topics: [
            '1. **Schedules**: classes, times, rooms, and a specific day.',
            '2. **Grades**: course results, GPA, and your transcript.',
            '3. **Course registration**: eligibility, deadlines, and term credit limits.',
            '4. **Thesis or capstone work**: progress, topics, and important dates.',
            '5. **Announcements and regulations**: official guidance and forms.',
          ],
          closing: 'What would you like to check first?',
        },
      },
      capabilities: {
        introduction: 'I’m the **CampusUTE academic assistant**.',
        lead: 'I can:',
        points: [
          '- Check your schedules, grades, announcements, and academic progress when the records are available.',
          '- Explain public academic guidance from approved sources.',
          '- Support students and lecturers within each account’s access.',
        ],
        closing:
          'When the available evidence is insufficient, I will say so instead of guessing. Try asking: *"Do I have classes today?"* or *"What is my GPA?"*.',
      },
      thankYou:
        'You’re welcome. You can ask me about schedules, grades, course registration, or thesis work whenever you need.',
      goodbye: 'Goodbye **{displayName}**. Have a productive day!',
    },
    clipboard: {
      copyFailed: 'Could not copy to clipboard.',
    },
    specialized: {
      retry: 'Retry the question',
    },
    returnToLatest: 'Return to latest',
    returningToLatest: 'Reloading the latest messages…',
    returnToLatestHint: 'Sending is paused while you read older messages.',
    historyNavigationLocked:
      'Older messages cannot load while a reply or feedback save is in progress.',
    windowTrimmed:
      'Older messages were hidden to keep this view bounded. Local replies that were hidden may not be recoverable.',
    streamProgressStart: 'Receiving reply…',
    streamProgressSlowStart: 'Still receiving the reply…',
    streamProgress: 'Receiving reply… {count} characters',
    streamProgressSlow: 'Still receiving the reply… {count} characters',
  },
} as const;

export type AssistantWindowLocale = keyof typeof assistantWindowMessages;
export type AssistantWindowCopy =
  (typeof assistantWindowMessages)[AssistantWindowLocale];

export function getAssistantWindowMessages(
  locale: string,
): AssistantWindowCopy {
  return assistantWindowMessages[locale === 'vi' ? 'vi' : 'en'];
}

/**
 * Progress copy is bucketed by the caller so a live region is not rewritten on
 * every streamed token. A zero count announces the start of the reply.
 */
export function streamProgressText(
  locale: string,
  state: { characters: number; slow?: boolean },
): string {
  const copy = getAssistantWindowMessages(locale);
  const characters = Math.max(0, Math.floor(state.characters));
  if (characters <= 0) {
    return state.slow ? copy.streamProgressSlowStart : copy.streamProgressStart;
  }
  const template = state.slow ? copy.streamProgressSlow : copy.streamProgress;
  return template.replace('{count}', String(characters));
}
