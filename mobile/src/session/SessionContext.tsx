import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { apiClient, campusApi } from '../api/client';
import { unregisterPushBestEffort } from '../api/push-notifications';
import {
  NO_CAPABILITIES,
  resolveCapabilities,
  type CapabilitySet,
} from '../auth/capabilities';
import { decodeJwtPayload, roleFromClaims } from '../auth/oidc-session';
import { sessionStore } from '../auth/mobile-session-store';
import { PUSH_OPT_IN_ENABLED } from '../config/features';
import { LANE_FLAGS } from '../config/lane-flags';
import { clearQueryCache } from '../hooks/query-cache';
import type { SessionKind } from '../navigation/route-map';
import type { UserRole } from '../navigation/routes';

/**
 * Session authority for the router world (mobile-policy §3). Owns the
 * session-kind state the guard evaluates, the preview pseudo-session
 * (memory-only, never SecureStore — KM-9), and the sign-out ordering
 * (KM-6: epoch++ → wipe → clear memory → revoke). The OIDC bootstrap and
 * SecureStore I/O plug in via `session-store.ts` — this context holds no
 * token material itself.
 */

export interface SessionState {
  kind: SessionKind;
  role: UserRole;
  /** id_token sub — per-account cache key; null while signed out/preview. */
  accountId: string | null;
  /** Reason a sign-in attempt terminated without a session (KM-12 UX). */
  blockedReason: string | null;
  /**
   * Flag-gated lane grants resolved from the access-token claims. Empty while
   * signed out/preview: preview is never an authorization substitute. Absent
   * means none (fail closed) so a bare session value stays valid.
   */
  capabilities?: CapabilitySet;
}

interface SessionActions {
  enterPreview(): boolean;
  completeSignIn(role: UserRole, accountId: string | null): void;
  switchRole(role: UserRole): void;
  signOut(): Promise<void>;
  markBlocked(reason: string | null): void;
  setRole(role: UserRole): void;
}

export interface SessionValue extends SessionState, SessionActions {
  /** Epoch mirrors the store's session epoch: sign-in/out bump it. */
  epoch: number;
  /** KM-17: false until marker-check + bootstrap + optional silent refresh. */
  booted: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

const initialState: SessionState = {
  kind: 'signedOut',
  role: 'student',
  accountId: null,
  blockedReason: null,
  capabilities: NO_CAPABILITIES,
};

function claimsOf(accessToken: string | null): string[] {
  const claims = accessToken ? decodeJwtPayload(accessToken) : null;
  return Array.isArray(claims?.roles)
    ? claims.roles.filter((r): r is string => typeof r === 'string')
    : [];
}

function capabilitiesOf(accessToken: string | null): CapabilitySet {
  return resolveCapabilities({ claims: claimsOf(accessToken), lanes: LANE_FLAGS });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);
  const [epoch, setEpoch] = useState(0);
  const [booted, setBooted] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // KM-17 boot: marker-check (may wipe cu.refresh) → loadBootstrap → one
  // silent refresh → session state → only then render children so no guard
  // or screen evaluates pre-bootstrap. A failed refresh is signedOut, never
  // a crash.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // KM-9: preview never touches SecureStore — skip bootstrap entirely.
        if (apiClient.mode !== 'live') {
          return;
        }
        const { refreshToken } = await sessionStore.loadBootstrap();
        if (refreshToken) {
          // A transport throw (offline at boot) is a failed refresh, not a
          // crash — swallow to signed-out exactly like a rejected grant.
          const result = await sessionStore.refreshAccessToken().catch(() => ({ accessToken: null }));
          const claims = result.accessToken
            ? decodeJwtPayload(result.accessToken)
            : null;
          const role = roleFromClaims(claimsOf(result.accessToken));
          const accountId = typeof claims?.sub === 'string' ? claims.sub : null;
          if (role && accountId && !cancelled) {
            setEpoch((e) => e + 1);
            setState({
              kind: 'authenticated',
              role,
              accountId,
              blockedReason: null,
              capabilities: capabilitiesOf(result.accessToken),
            });
          }
        }
      } finally {
        if (!cancelled) {
          setBooted(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A failed refresh clears the client tokens; without this bridge every
  // screen keeps retry states that can never succeed. Epoch-gated so a late
  // callback from a previous session cannot kill the new one (KM-6).
  useEffect(() => {
    apiClient.setOnSessionExpired(() => {
      clearQueryCache();
      setEpoch((e) => e + 1);
      setState((current) =>
        current.kind === 'authenticated' ? { ...initialState } : current);
    });
    return () => apiClient.setOnSessionExpired(undefined);
  }, []);

  const enterPreview = useCallback(() => {
    if (stateRef.current.kind !== 'signedOut' || apiClient.mode !== 'preview') {
      return false;
    }
    setEpoch((e) => e + 1);
    setState({ ...initialState, kind: 'preview' });
    return true;
  }, []);

  const completeSignIn = useCallback((role: UserRole, accountId: string | null) => {
    if (stateRef.current.kind !== 'signedOut' || apiClient.mode !== 'live') {
      return;
    }
    setEpoch((e) => e + 1);
    setState({
      kind: 'authenticated',
      role,
      accountId,
      blockedReason: null,
      capabilities: capabilitiesOf(sessionStore.getAccessToken()),
    });
  }, []);

  const switchRole = useCallback((role: UserRole) => {
    setState((current) =>
      current.kind === 'preview' ? { ...current, role } : current);
  }, []);

  const setRole = useCallback((role: UserRole) => {
    // Preview-only mutation (KM-9): flipping the surface selector on a real
    // session would be a client-side privilege switch — same gate as
    // switchRole.
    setState((current) =>
      current.kind === 'preview' ? { ...current, role } : current);
  }, []);

  const markBlocked = useCallback((reason: string | null) => {
    setState((current) => ({ ...current, blockedReason: reason }));
  }, []);

  const signOut = useCallback(async () => {
    // KM-6 ordering lives in sessionStore.signOut (epoch++ → wipe cu.refresh
    // → clear memory → best-effort revoke); preview never touches the store
    // (KM-9) so it resets locally only.
    if (stateRef.current.kind === 'preview') {
      setEpoch((e) => e + 1);
      clearQueryCache();
      setState(initialState);
      return;
    }
    if (PUSH_OPT_IN_ENABLED) {
      // Best effort and never awaited: the access token is captured before the
      // wipe so the server can drop this device's registration (R23).
      const accessTokenSnapshot = sessionStore.getAccessToken();
      void import('../api/expo-push-platform')
        .then(({ expoPushPlatform }) => expoPushPlatform.getInstallationId())
        .then((installationId) => unregisterPushBestEffort(campusApi, installationId, accessTokenSnapshot))
        .catch(() => undefined);
    }
    try {
      await sessionStore.signOut();
    } finally {
      // The wipe must not depend on the store call succeeding: a throwing
      // revoke/storage error would otherwise leave this account's cached data
      // and authenticated state behind.
      clearQueryCache();
      setEpoch((e) => e + 1);
      setState(initialState);
    }
  }, []);

  const value = useMemo<SessionValue>(() => ({
    ...state,
    epoch,
    booted,
    enterPreview,
    completeSignIn,
    switchRole,
    signOut,
    markBlocked,
    setRole,
  }), [state, epoch, booted, enterPreview, completeSignIn, switchRole, signOut, markBlocked, setRole]);

  if (!booted) {
    return null;
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return value;
}
