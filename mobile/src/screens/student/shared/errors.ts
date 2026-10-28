import { ApiClientError } from '../../../api/client';

const friendlyErrorMessageByCode: Record<string, string> = {
  ACCESS_DENIED: 'You do not have access to this action.',
  COHORT_INELIGIBLE: 'Registration is not available for your year group yet.',
  CONFLICT: 'This change conflicts with your current record.',
  HTTP_400: 'Please review the information and try again.',
  HTTP_401: 'Please sign in again to continue.',
  HTTP_403: 'You do not have access to this action.',
  HTTP_404: 'We could not find that item.',
  INVALID_REQUEST: 'Please review the information and try again.',
  ROUND_NOT_FOUND: 'Registration is not open right now.',
  UNAUTHENTICATED: 'Please sign in again to continue.',
  WINDOW_CLOSED: 'Registration is not open right now.',
};

export function studentFriendlyErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiClientError) {
    return error.code ? friendlyErrorMessageByCode[error.code] ?? fallbackMessage : fallbackMessage;
  }
  return fallbackMessage;
}
