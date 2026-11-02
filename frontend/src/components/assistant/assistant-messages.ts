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
