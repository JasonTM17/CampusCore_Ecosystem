import {
  AttendanceApiError, normalizeAttendanceError, type AttendanceApi, type OpenAttendanceSession,
} from './attendance-api';
import { parseCheckinLink } from './checkin-link';
import {
  isFreshFix, LocationServiceError, type FreshFix, type LocationProvider,
} from './location-service';

export type CheckinState =
  | { type: 'idle' | 'loadingSessions' | 'noOpenSession' | 'needsPermission' | 'permissionBlocked'
      | 'servicesOff' | 'acquiringFix' | 'lowAccuracy' | 'submitting' | 'alreadyCheckedIn'
      | 'sessionClosed' | 'notEnrolled' | 'authRecovery' }
  | { type: 'needsConsent'; version: string; reason?: 'INVALID_CONSENT_VERSION' }
  | { type: 'readyForCode'; requireCode: boolean }
  | { type: 'accepted'; status: string | null }
  | { type: 'pendingReview' }
  | { type: 'rejected'; reason: 'INVALID_LOCATION' | 'BAD_CODE' | 'OUTSIDE_AREA' | 'REJECTED' }
  | { type: 'tooManyAttempts'; retryAfterSeconds: number | null }
  | { type: 'networkError'; retryable: boolean }
  | { type: 'error'; code: 'INVALID_LINK' | 'INVALID_SESSION' | 'STALE_FIX' | 'TIMEOUT' | 'UNKNOWN' };

export interface CheckinSnapshot {
  readonly state: CheckinState;
  readonly sessions: readonly OpenAttendanceSession[];
  readonly selectedSession: OpenAttendanceSession | null;
}
export interface CheckinMachine {
  getSnapshot(): CheckinSnapshot;
  subscribe(listener: (snapshot: CheckinSnapshot) => void): () => void;
  loadSessions(link?: string): Promise<void>;
  selectSession(sessionId: string): Promise<void>;
  acceptConsent(): Promise<void>;
  acquireLocation(): Promise<void>;
  submit(code?: string): Promise<void>;
  /** Call on blur/unmount/sign-out; invalidates every outstanding async operation. */
  reset(): void;
}

/** No React, cache, storage or native imports. One instance belongs to one visible flow. */
export function createCheckinMachine(deps: {
  api: AttendanceApi; location: LocationProvider; getInstallationId(): Promise<string>;
  /** Account/grant/session epoch token. A change invalidates reads AND submissions. */
  identity(): string | number; now?: () => number;
}): CheckinMachine {
  const now = deps.now ?? Date.now;
  let identity = deps.identity();
  let generation = 0;
  let busy = false;
  // Retain the physical POST lock across reset: a second flow cannot overlap it.
  let postInFlight = false;
  let queuedLoad: { link?: string } | undefined;
  let consentAccepted = false;
  let fix: FreshFix | undefined;
  let snapshot: CheckinSnapshot = { state: { type: 'idle' }, sessions: [], selectedSession: null };
  const listeners = new Set<(snapshot: CheckinSnapshot) => void>();
  function publish(state: CheckinState, sessions = snapshot.sessions, selectedSession = snapshot.selectedSession) {
    snapshot = Object.freeze({ state: Object.freeze(state), sessions, selectedSession });
    for (const listener of listeners) listener(snapshot);
  }
  function reset() {
    generation += 1; identity = deps.identity(); busy = false; fix = undefined; consentAccepted = false;
    queuedLoad = undefined;
    publish({ type: 'idle' }, [], null);
  }
  function syncIdentity() { if (deps.identity() !== identity) reset(); }
  function current(ticket: number) {
    syncIdentity();
    return generation === ticket;
  }
  async function run(work: (ticket: number) => Promise<void>) {
    syncIdentity();
    if (busy || postInFlight) return;
    busy = true;
    const ticket = generation;
    try { await work(ticket); }
    catch (error) { if (current(ticket)) { fix = undefined; await failure(error, ticket); } }
    finally {
      if (current(ticket)) busy = false;
      if (!busy && !postInFlight && queuedLoad) {
        const queued = queuedLoad;
        queuedLoad = undefined;
        await loadSessions(queued.link);
      }
    }
  }
  async function consent(ticket: number, changedVersion = false) {
    const response = await deps.api.getConsent();
    if (!current(ticket)) return;
    if (!response.version) { publish({ type: 'error', code: 'UNKNOWN' }); return; }
    consentAccepted = response.accepted && !changedVersion;
    publish(consentAccepted ? { type: 'needsPermission' } : { type: 'needsConsent', version: response.version,
      ...(changedVersion ? { reason: 'INVALID_CONSENT_VERSION' as const } : {}) });
  }
  async function failure(error: unknown, ticket: number) {
    if (error instanceof LocationServiceError) {
      switch (error.code) {
        case 'PERMISSION_DENIED': publish({ type: 'needsPermission' }); return;
        case 'PERMISSION_BLOCKED': publish({ type: 'permissionBlocked' }); return;
        case 'SERVICES_OFF': publish({ type: 'servicesOff' }); return;
        case 'LOW_ACCURACY': publish({ type: 'lowAccuracy' }); return;
        default: publish({ type: 'error', code: error.code }); return;
      }
    }
    const apiError = normalizeAttendanceError(error);
    if (apiError.status === 401) { consentAccepted = false; publish({ type: 'authRecovery' }); return; }
    switch (apiError.code) {
      case 'INVALID_LOCATION': case 'BAD_CODE': case 'OUTSIDE_AREA':
        publish({ type: 'rejected', reason: apiError.code }); return;
      case 'NOT_ENROLLED': publish({ type: 'notEnrolled' }); return;
      case 'CONSENT_REQUIRED': case 'INVALID_CONSENT_VERSION':
        consentAccepted = false;
        try { await consent(ticket, apiError.code === 'INVALID_CONSENT_VERSION'); }
        catch (error) {
          if (current(ticket)) publish(normalizeAttendanceError(error).status === 401
            ? { type: 'authRecovery' } : { type: 'networkError', retryable: true });
        }
        return;
      case 'ALREADY_CHECKED_IN': publish({ type: 'alreadyCheckedIn' }); return;
      case 'SESSION_CLOSED': publish({ type: 'sessionClosed' }); return;
      case 'LOW_ACCURACY': publish({ type: 'lowAccuracy' }); return;
      case 'TOO_MANY_ATTEMPTS': publish({ type: 'tooManyAttempts', retryAfterSeconds: apiError.retryAfterSeconds }); return;
      case 'NETWORK_ERROR': publish({ type: 'networkError', retryable: apiError.retryable }); return;
      default:
        publish(apiError.status >= 500 ? { type: 'networkError', retryable: true }
          : { type: 'error', code: 'UNKNOWN' });
    }
  }
  async function acquire(ticket: number) {
    fix = undefined;
    const permission = await deps.location.ensurePermission();
    if (!current(ticket)) return;
    if (permission !== 'granted') {
      publish({ type: permission === 'denied-blocked' ? 'permissionBlocked' : 'needsPermission' }); return;
    }
    if (!await deps.location.isServicesEnabled()) {
      if (current(ticket)) publish({ type: 'servicesOff' }); return;
    }
    if (!current(ticket)) return;
    publish({ type: 'acquiringFix' });
    if (!current(ticket)) return;
    const acquired = await deps.location.getFreshFix({ timeoutMs: 15000, maxAgeMs: 30000 });
    if (!current(ticket)) return;
    if (!isFreshFix(acquired, now())) throw new LocationServiceError('STALE_FIX');
    if (acquired.accuracyMeters > 100) throw new LocationServiceError('LOW_ACCURACY');
    fix = acquired;
    publish({ type: 'readyForCode', requireCode: snapshot.selectedSession?.requireCode ?? true });
  }
  async function select(sessionId: string, ticket: number) {
    const session = snapshot.sessions.find((item) => item.id === sessionId);
    fix = undefined; consentAccepted = false;
    if (!session) { publish({ type: 'error', code: 'INVALID_SESSION' }, snapshot.sessions, null); return; }
    if (Date.parse(session.closesAt) <= now()) { publish({ type: 'sessionClosed' }, snapshot.sessions, session); return; }
    publish({ type: 'loadingSessions' }, snapshot.sessions, session);
    await consent(ticket);
  }
  function loadSessions(link?: string): Promise<void> {
    syncIdentity();
    if (postInFlight) {
      queuedLoad = { link };
      publish({ type: 'loadingSessions' }, [], null);
      return Promise.resolve();
    }
    return run(async (ticket) => {
      fix = undefined; consentAccepted = false;
      const parsed = link === undefined ? undefined : parseCheckinLink(link);
      if (parsed && !parsed.ok) { publish({ type: 'error', code: 'INVALID_LINK' }, [], null); return; }
      publish({ type: 'loadingSessions' }, [], null);
      const sessions = await deps.api.openSessions();
      if (!current(ticket)) return;
      const frozen = Object.freeze(sessions.map((item) => Object.freeze({ ...item })));
      publish({ type: sessions.length ? 'idle' : 'noOpenSession' }, frozen, null);
      if (parsed?.ok) await select(parsed.sessionId, ticket);
    });
  }
  return {
    getSnapshot() { syncIdentity(); return snapshot; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset,
    loadSessions,
    selectSession(sessionId) { return run((ticket) => select(sessionId, ticket)); },
    acceptConsent() {
      return run(async (ticket) => {
        if (snapshot.state.type !== 'needsConsent') return;
        const response = await deps.api.acceptConsent(snapshot.state.version);
        if (!current(ticket)) return;
        consentAccepted = response.accepted;
        if (response.accepted) publish({ type: 'needsPermission' });
        else if (response.version) publish({ type: 'needsConsent', version: response.version });
        else publish({ type: 'error', code: 'UNKNOWN' });
      });
    },
    acquireLocation() {
      return run(async (ticket) => {
        if (!consentAccepted || !snapshot.selectedSession || ['needsConsent', 'accepted', 'pendingReview', 'alreadyCheckedIn',
          'sessionClosed', 'notEnrolled', 'tooManyAttempts'].includes(snapshot.state.type)) return;
        await acquire(ticket);
      });
    },
    submit(code) {
      // Code exists only in this invocation, never in state, storage, diagnostics or cache.
      return run(async (ticket) => {
        const session = snapshot.selectedSession;
        if (!session || snapshot.state.type !== 'readyForCode') return;
        if (session.requireCode && !/^[0-9]{6}$/.test(code ?? '')) {
          fix = undefined; publish({ type: 'rejected', reason: 'BAD_CODE' }); return;
        }
        if (Date.parse(session.closesAt) <= now()) { fix = undefined; publish({ type: 'sessionClosed' }); return; }
        const installationId = await deps.getInstallationId();
        if (!current(ticket)) return;
        if (!fix || !isFreshFix(fix, now())) await acquire(ticket);
        if (!current(ticket) || !fix) return;
        const position = fix;
        fix = undefined; // Every attempt consumes its position, including failed POSTs.
        postInFlight = true;
        try {
          publish({ type: 'submitting' });
          if (!current(ticket)) return;
          const result = await deps.api.checkin(session.id, {
            ...(session.requireCode ? { code } : {}), latitude: position.latitude, longitude: position.longitude,
            accuracyMeters: position.accuracyMeters, capturedAt: position.capturedAt,
            mockProvider: position.mocked, installationId,
          });
          if (!current(ticket)) return;
          if (result.decision === 'ACCEPTED') publish({ type: 'accepted', status: result.status });
          else if (result.decision === 'PENDING_REVIEW') publish({ type: 'pendingReview' });
          else if (result.decision === 'REJECTED') publish({ type: 'rejected', reason: 'REJECTED' });
          else throw new AttendanceApiError('UNKNOWN');
        } finally { postInFlight = false; }
      });
    },
  };
}
