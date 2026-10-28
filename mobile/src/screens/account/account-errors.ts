/**
 * Transport-agnostic error classification for the account flows. It reads
 * only `status` and `code`, so it never carries server message text (which
 * could echo input) into the UI, and it needs no import of the API client.
 */

export type ErrorKind =
  | 'network'
  | 'rateLimited'
  | 'unauthorized'
  | 'forbidden'
  | 'validation'
  | 'conflict'
  | 'server'
  | 'preview'
  | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  code: string | null;
  status: number | null;
}

export interface ErrorCopy {
  network: string;
  rateLimited: string;
  unauthorized: string;
  forbidden: string;
  validation: string;
  conflict: string;
  server: string;
  preview: string;
  unknown: string;
  codes: Record<string, string>;
}

export function classifyError(error: unknown): ClassifiedError {
  const shaped = (typeof error === 'object' && error !== null ? error : {}) as {
    status?: unknown;
    code?: unknown;
  };
  const status = typeof shaped.status === 'number' ? shaped.status : null;
  const code = typeof shaped.code === 'string' && shaped.code.length > 0 ? shaped.code : null;
  const base = { code, status };

  if (code === 'MOBILE_API_PREVIEW') {
    return { ...base, kind: 'preview' };
  }
  if (code === 'RATE_LIMIT_EXCEEDED' || status === 429) {
    return { ...base, kind: 'rateLimited' };
  }
  if (status === 0 || (status === null && error instanceof TypeError)) {
    return { ...base, kind: 'network' };
  }
  if (status === 400 || status === 422) return { ...base, kind: 'validation' };
  if (status === 401) return { ...base, kind: 'unauthorized' };
  if (status === 403) return { ...base, kind: 'forbidden' };
  if (status === 409) return { ...base, kind: 'conflict' };
  if (status !== null && status >= 500) return { ...base, kind: 'server' };
  return { ...base, kind: 'unknown' };
}

/**
 * A specific business code wins over the generic kind copy so people learn
 * why the request failed; `overrides` lets one screen reinterpret a code.
 */
export function errorMessage(
  failure: ClassifiedError,
  copy: ErrorCopy,
  overrides: Record<string, string> = {},
): string {
  const code = failure.code;
  if (code && overrides[code]) return overrides[code];
  if (code && copy.codes[code]) return copy.codes[code];
  return copy[failure.kind];
}
