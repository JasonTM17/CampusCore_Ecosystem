import { apiClient } from '../../api/client';
import { useScreenQuery } from '../../hooks/useScreenQuery';
import { contentMessages } from '../../i18n/content-messages';
import { useLocale } from '../../i18n/locale-provider';
import { contentErrorMessage } from './content-errors';

/** Live-only query with student-safe error copy; preview sessions never fetch. */
export function useContentQuery<T>(key: string, fetcher: () => Promise<T>, enabled = true) {
  const { locale } = useLocale();
  const copy = contentMessages[locale];
  return useScreenQuery<T>(key, fetcher, {
    enabled: apiClient.mode === 'live' && enabled,
    errorMessage: copy.generic,
    mapError: (error) => contentErrorMessage(copy, error),
  });
}
