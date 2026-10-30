import type { CheckinMachine, CheckinSnapshot, CheckinState, OpenAttendanceSession } from '../../attendance-checkin';
import { SESSION_ID_PATTERN } from '../../attendance-checkin';

/**
 * Preview-mode ("Khám phá bản xem thử") stand-in for the real check-in machine.
 * Local only: no network, no location, no SecureStore, no coordinates anywhere.
 * States are simulated so the demo path and the screenshot matrix can reach
 * every surface the live machine can publish.
 */
export const DEMO_SESSIONS: readonly OpenAttendanceSession[] = Object.freeze([
  Object.freeze({
    id: '9e107d9d-372b-4c81-8d1f-8f0b9f9f0001',
    sectionId: 'demo-sec-1',
    sectionLabel: 'CT101 · Cơ sở dữ liệu',
    closesAt: '2099-01-01T10:15:00.000Z',
    requireCode: true,
    geofenceName: 'Tòa A1',
  }),
  Object.freeze({
    id: '9e107d9d-372b-4c81-8d1f-8f0b9f9f0002',
    sectionId: 'demo-sec-2',
    sectionLabel: 'CT201 · Lập trình web',
    closesAt: '2099-01-01T15:45:00.000Z',
    requireCode: false,
    geofenceName: 'Tòa B2',
  }),
]);

/** Scenario ids the demo picker offers; each maps to a simulated machine state. */
export type DemoScenario =
  | 'flow' | 'consent' | 'permissionDenied' | 'permissionBlocked' | 'servicesOff'
  | 'lowAccuracy' | 'outside' | 'badCode' | 'pending' | 'already' | 'rateLimited' | 'offline';

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  'flow', 'consent', 'permissionDenied', 'permissionBlocked', 'servicesOff',
  'lowAccuracy', 'outside', 'badCode', 'pending', 'already', 'rateLimited', 'offline',
];

/** States forced right after session selection — terminal-style results. */
const AT_SELECT: Readonly<Record<string, CheckinState>> = {
  already: { type: 'alreadyCheckedIn' },
  rateLimited: { type: 'tooManyAttempts', retryAfterSeconds: 45 },
};
/** States forced at the acquire step. */
const AT_ACQUIRE: Readonly<Record<string, CheckinState>> = {
  permissionDenied: { type: 'needsPermission' },
  permissionBlocked: { type: 'permissionBlocked' },
  servicesOff: { type: 'servicesOff' },
  lowAccuracy: { type: 'lowAccuracy' },
};
/** States forced at submit. */
const AT_SUBMIT: Readonly<Record<string, CheckinState>> = {
  outside: { type: 'rejected', reason: 'OUTSIDE_AREA' },
  badCode: { type: 'rejected', reason: 'BAD_CODE' },
  pending: { type: 'pendingReview' },
  already: { type: 'alreadyCheckedIn' },
  rateLimited: { type: 'tooManyAttempts', retryAfterSeconds: 45 },
  offline: { type: 'networkError', retryable: true },
};

const CONSENT_VERSION = 'v1';

/** Simulated machine for the preview lane. `scenario` is read live at each step. */
export function createDemoCheckinMachine(scenario: () => DemoScenario): CheckinMachine {
  let snapshot: CheckinSnapshot = { state: { type: 'idle' }, sessions: [], selectedSession: null };
  const listeners = new Set<(snapshot: CheckinSnapshot) => void>();
  function publish(state: CheckinState, sessions = snapshot.sessions, selectedSession = snapshot.selectedSession) {
    snapshot = Object.freeze({ state: Object.freeze(state), sessions, selectedSession });
    for (const listener of listeners) listener(snapshot);
  }
  function pick(sessionId: string) {
    const session = snapshot.sessions.find((item) => item.id === sessionId) ?? null;
    if (!session) { publish({ type: 'error', code: 'INVALID_SESSION' }, snapshot.sessions, null); return; }
    const forced = AT_SELECT[scenario()];
    publish(forced ?? { type: 'needsConsent', version: CONSENT_VERSION }, snapshot.sessions, session);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() { publish({ type: 'idle' }, [], null); },
    async loadSessions(link) {
      if (link !== undefined && !SESSION_ID_PATTERN.test(link.split('/').pop() ?? '')) {
        publish({ type: 'error', code: 'INVALID_LINK' }, [], null);
        return;
      }
      publish({ type: 'loadingSessions' }, [], null);
      if (scenario() === 'offline') { publish({ type: 'networkError', retryable: true }, [], null); return; }
      publish({ type: 'idle' }, DEMO_SESSIONS, null);
      const sessionId = link?.split('/').pop();
      if (sessionId && SESSION_ID_PATTERN.test(sessionId)) pick(sessionId);
    },
    async selectSession(sessionId) { pick(sessionId); },
    async acceptConsent() {
      if (snapshot.state.type !== 'needsConsent') return;
      publish({ type: 'needsPermission' });
    },
    async acquireLocation() {
      if (!snapshot.selectedSession) return;
      const forced = AT_ACQUIRE[scenario()];
      if (forced) { publish(forced); return; }
      publish({ type: 'acquiringFix' });
      publish({ type: 'readyForCode', requireCode: snapshot.selectedSession.requireCode });
    },
    async submit(code) {
      const session = snapshot.selectedSession;
      if (!session || snapshot.state.type !== 'readyForCode') return;
      publish({ type: 'submitting' });
      const forced = AT_SUBMIT[scenario()];
      if (forced) { publish(forced); return; }
      if (session.requireCode && !/^[0-9]{6}$/.test(code ?? '')) {
        publish({ type: 'rejected', reason: 'BAD_CODE' });
        return;
      }
      publish({ type: 'accepted', status: 'PRESENT' });
    },
  };
}
