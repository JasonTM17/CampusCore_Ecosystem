import type { ApiClient, ApiRequestInit } from '../api/client';
import { SESSION_ID_PATTERN } from './checkin-link';

export interface OpenAttendanceSession {
  id: string; sectionId: string; sectionLabel: string; closesAt: string;
  requireCode: boolean; geofenceName: string;
}
export interface LocationConsent { accepted: boolean; version: string; acceptedAt: string | null }
export interface CheckinBody {
  code?: string; latitude: number; longitude: number; accuracyMeters: number;
  capturedAt: string; mockProvider: boolean; installationId: string;
}
export interface CheckinResult {
  decision: 'ACCEPTED' | 'PENDING_REVIEW' | 'REJECTED';
  status: string | null;
  message: string;
}
export type AttendanceErrorCode = 'INVALID_LOCATION' | 'NOT_ENROLLED' | 'CONSENT_REQUIRED' | 'INVALID_CONSENT_VERSION' | 'AUTH_RECOVERY'
  | 'ALREADY_CHECKED_IN' | 'SESSION_CLOSED' | 'BAD_CODE' | 'OUTSIDE_AREA' | 'LOW_ACCURACY'
  | 'TOO_MANY_ATTEMPTS' | 'NETWORK_ERROR' | 'UNKNOWN';
const SERVER_CODES = new Set<string>(['INVALID_LOCATION', 'NOT_ENROLLED', 'CONSENT_REQUIRED', 'INVALID_CONSENT_VERSION',
  'ALREADY_CHECKED_IN', 'SESSION_CLOSED', 'BAD_CODE', 'OUTSIDE_AREA', 'LOW_ACCURACY', 'TOO_MANY_ATTEMPTS']);

export class AttendanceApiError extends Error {
  constructor(readonly code: AttendanceErrorCode, readonly status = 0,
    readonly retryable = false, readonly retryAfterSeconds: number | null = null) {
    super(code); this.name = 'AttendanceApiError';
  }
}
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null || !value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : null;
}
export function normalizeAttendanceError(error: unknown): AttendanceApiError {
  if (error instanceof AttendanceApiError) return error;
  const shape = error as { code?: unknown; status?: unknown; headers?: Headers; retryAfterSeconds?: unknown } | null;
  const status = typeof shape?.status === 'number' ? shape.status : 0;
  const code: AttendanceErrorCode = status === 401 ? 'AUTH_RECOVERY' : typeof shape?.code === 'string' && SERVER_CODES.has(shape.code)
    ? shape.code as AttendanceErrorCode : status === 429 ? 'TOO_MANY_ATTEMPTS'
      : status === 0 && (error instanceof TypeError || shape?.code === 'NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN';
  const retryAfter = typeof shape?.retryAfterSeconds === 'number' && Number.isFinite(shape.retryAfterSeconds)
    ? Math.max(0, Math.ceil(shape.retryAfterSeconds)) : parseRetryAfter(shape?.headers?.get('Retry-After') ?? null);
  return new AttendanceApiError(code, status, code === 'NETWORK_ERROR' || status >= 500, retryAfter);
}
export interface AttendanceApi {
  openSessions(): Promise<OpenAttendanceSession[]>;
  getConsent(): Promise<LocationConsent>;
  acceptConsent(version: string): Promise<LocationConsent>;
  checkin(sessionId: string, body: CheckinBody): Promise<CheckinResult>;
}
export type AttendanceRequest = <T>(path: string, init?: ApiRequestInit) => Promise<T>;

/** One replaceable endpoint module; no query cache, persistence, queue or retries. */
export function createAttendanceApi(client: Pick<ApiClient, 'request'>,
  submitRequest: AttendanceRequest): AttendanceApi {
  async function request<T>(path: string, init?: ApiRequestInit, submit = false): Promise<T> {
    try { return await (submit ? submitRequest<T>(path, init) : client.request<T>(path, init)); }
    catch (error) { throw normalizeAttendanceError(error); }
  }
  return {
    openSessions: () => request('/attendance/sessions/open', { cache: 'no-store' }),
    getConsent: () => request('/attendance/location-consent', { cache: 'no-store' }),
    acceptConsent: (version) => request('/attendance/location-consent', {
      method: 'POST', body: JSON.stringify({ version }),
    }),
    checkin(sessionId, body) {
      if (!SESSION_ID_PATTERN.test(sessionId)) return Promise.reject(new AttendanceApiError('UNKNOWN'));
      return request(`/attendance/sessions/${encodeURIComponent(sessionId)}/checkin`, {
        method: 'POST', body: JSON.stringify(body), cache: 'no-store',
      }, true);
    },
  };
}

/** Single HTTP attempt: preserves Retry-After and never replays a quota-counted POST. */
export function createSingleAttemptRequest(options: {
  baseUrl: string; getAccessToken(): string | null; sessionEpoch(): number;
  fetchImpl?: typeof fetch;
  recoverUnauthorized?(signal: AbortSignal): Promise<unknown>;
}): AttendanceRequest {
  return async <T>(path: string, init?: ApiRequestInit): Promise<T> => {
    const epoch = options.sessionEpoch();
    const token = options.getAccessToken();
    if (!token) throw new AttendanceApiError('AUTH_RECOVERY', 401);
    const controller = new AbortController();
    const epochWatch = setInterval(() => { if (options.sessionEpoch() !== epoch) controller.abort(); }, 100);
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl}${path}`, {
        ...init, signal: controller.signal, redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      if (options.sessionEpoch() !== epoch) throw new AttendanceApiError('UNKNOWN');
      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      if (options.sessionEpoch() !== epoch) throw new AttendanceApiError('UNKNOWN');
      if (!response.ok) {
        if (response.status === 401) {
          // A safe read joins shared refresh/expiry handling; the POST is never replayed.
          try { await options.recoverUnauthorized?.(controller.signal); } catch { /* Preserve explicit auth recovery. */ }
          throw normalizeAttendanceError({ status: 401, headers: response.headers });
        }
        const code = body && typeof body === 'object' && 'code' in body ? body.code : undefined;
        throw normalizeAttendanceError({ status: response.status, code, headers: response.headers });
      }
      if (options.sessionEpoch() !== epoch) throw new AttendanceApiError('UNKNOWN');
      return body as T;
    } catch (error) {
      if (controller.signal.aborted && options.sessionEpoch() === epoch
        && !(error instanceof AttendanceApiError && error.status === 401)) {
        throw new AttendanceApiError('NETWORK_ERROR', 0, true);
      }
      throw normalizeAttendanceError(error);
    } finally { clearInterval(epochWatch); clearTimeout(deadline); }
  };
}

export function createNativeAttendanceApi(): AttendanceApi {
  const { apiClient } = require('../api/client') as typeof import('../api/client');
  const { sessionStore } = require('../auth/mobile-session-store') as typeof import('../auth/mobile-session-store');
  const submit = createSingleAttemptRequest({ baseUrl: apiClient.baseUrl,
    getAccessToken: () => sessionStore.getAccessToken(), sessionEpoch: () => sessionStore.sessionEpoch(),
    recoverUnauthorized: (signal) => apiClient.request('/auth/me', { method: 'GET', cache: 'no-store', signal }) });
  const api = createAttendanceApi(apiClient, submit);
  return {
    ...api,
    checkin: (id, body) => apiClient.mode === 'live' ? api.checkin(id, body)
      : Promise.reject(new AttendanceApiError('UNKNOWN')),
  };
}
