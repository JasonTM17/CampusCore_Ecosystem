// Maps a failed request to one student-safe message. The raw server text is
// never shown; status classes pick the copy.

export interface ContentErrorCopy {
  offline: string;
  signIn: string;
  denied: string;
  notFound: string;
  rateLimited: string;
  server: string;
  generic: string;
}

export type ContentErrorKind = 'offline' | 'signIn' | 'denied' | 'notFound' | 'rateLimited' | 'server' | 'conflict' | 'generic';

export function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status;
  return error instanceof TypeError ? 0 : null;
}

export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

export function contentErrorKind(error: unknown): ContentErrorKind {
  const status = errorStatus(error);
  if (status === 0 || errorCode(error) === 'NETWORK_ERROR') return 'offline';
  if (status === 401) return 'signIn';
  if (status === 403) return 'denied';
  if (status === 404) return 'notFound';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 429) return 'rateLimited';
  if (status !== null && status >= 500) return 'server';
  return 'generic';
}

export function contentErrorMessage(copy: ContentErrorCopy, error: unknown, fallback?: string): string {
  const kind = contentErrorKind(error);
  if (kind === 'conflict') return fallback ?? copy.generic;
  if (kind === 'generic') return fallback ?? copy.generic;
  return copy[kind];
}

/** A request abandoned on purpose, not a failure to report. */
export function isAbortError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'REQUEST_ABORTED' || code === 'SESSION_CHANGED' || (error as { name?: string } | null)?.name === 'AbortError';
}
