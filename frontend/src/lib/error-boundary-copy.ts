import type { Locale } from '@/i18n/config';

/**
 * Copy for the provider-independent root error fallback.
 *
 * These strings cannot come from `messages.ts`: a crash in the root layout can
 * take the I18nProvider down with it, and `global-error.tsx` renders without
 * the root layout at all. Keeping one locale-keyed object here means the
 * fallback survives a provider crash and still has a single reviewed source of
 * truth. `error.tsx` renders inside the providers and interpolates the site
 * name, so it keeps its own richer variants; this module owns the
 * provider-independent copy `global-error.tsx` renders.
 */
export type ErrorBoundaryCopy = {
  title: string;
  body: string;
  retry: string;
  home: string;
};

export const ERROR_BOUNDARY_COPY: Record<Locale, ErrorBoundaryCopy> = {
  vi: {
    title: 'Đã xảy ra sự cố không mong muốn',
    body: 'Cổng học vụ đã ghi nhận lỗi nghiêm trọng. Bạn có thể thử tải lại ứng dụng.',
    retry: 'Thử lại',
    home: 'Về trang chủ',
  },
  en: {
    title: 'Something went wrong',
    body: 'The academic portal logged a critical error. You can try reloading the application.',
    retry: 'Try again',
    home: 'Back to home',
  },
};
