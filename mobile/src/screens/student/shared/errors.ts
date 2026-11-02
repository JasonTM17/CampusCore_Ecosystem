import { ApiClientError } from '../../../api/client';
import { academicMessages } from '../../../i18n/academic-messages';
import { DEFAULT_LOCALE, type AppLocale } from '../../../i18n/locale';

export function studentFriendlyErrorMessage(
  error: unknown,
  fallbackMessage: string,
  locale: AppLocale = DEFAULT_LOCALE,
) {
  if (error instanceof ApiClientError) {
    return error.code ? academicMessages[locale].studentErrors[error.code] ?? fallbackMessage : fallbackMessage;
  }
  return fallbackMessage;
}

export function isStudentResourceUnauthorizedError(error: unknown) {
  return error instanceof ApiClientError
    && (error.status === 401 || error.code === 'HTTP_401' || error.code === 'UNAUTHENTICATED');
}
