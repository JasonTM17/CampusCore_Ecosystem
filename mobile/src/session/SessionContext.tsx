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
import { AppState } from 'react-native';

import { apiClient, campusApi } from '../api/client';
import { unregisterPushBestEffort } from '../api/push-notifications';
import {
  APPLICANT_UI_ROLE,
  NO_CAPABILITIES,
  capabilityClaimsFromPayload,
  hasApplicantSurface,
  resolveCapabilities,
  type CapabilitySet,
} from '../auth/capabilities';
import { decodeJwtPayload, roleFromClaims } from '../auth/oidc-session';
import { sessionStore } from '../auth/mobile-session-store';
import { LANE_FLAGS } from '../config/lane-flags';
import { clearQueryCache, queryCacheIdentity, syncQueryCacheIdentity } from '../hooks/query-cache';
import type { SessionKind } from '../navigation/route-map';
import type { UserRole } from '../navigation/routes';

/**
 * Session authority for the router world (mobile-policy §3). Owns the
 * session-kind state the guard evaluates, the preview pseudo-session
 * (memory-only, never SecureStore — KM-9), and the sign-out ordering
 * (epoch++ → clear memory → wipe → revoke). The OIDC bootstrap and
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

type BootStatus = 'checking' | 'ready' | 'unavailable';

interface SessionActions {
  retryBoot?(): Promise<void>;
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
  /** Unavailable retains credentials without granting an app session. */
  bootStatus?: BootStatus;
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
  const claims = claimsOf(accessToken);
  return resolveCapabilities({
    claims,
    lanes: LANE_FLAGS,
    capabilityClaims: capabilityClaimsFromPayload(
      accessToken ? decodeJwtPayload(accessToken) : null,
    ),
    // The resolved UI role comes from the token itself, never from the
    // caller — a hand-picked selector cannot smuggle a real session out of
    // the applicant surface.
    role: roleFromClaims(claims),
  });
}

/**
 * F4: drop this device's push registration on sign-out whatever the opt-in
 * flag says now (it may have been on when the device registered). The access
 * token is the caller's pre-wipe snapshot; nothing here is awaited by sign-out
 * and no failure can reach it.
 */
function scheduleDevicePushUnregister(accessTokenSnapshot: string | null): void {
  if (!accessTokenSnapshot) return;
  try {
    void import('../api/expo-push-platform')
      .then(({ expoPushPlatform }) => expoPushPlatform.getInstallationId())
      .then((installationId) => unregisterPushBestEffort(campusApi, installationId, accessTokenSnapshot))
      .catch(() => undefined);
  } catch {
    // Local session teardown must not depend on the push adapter loading.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);
  const [epoch, setEpoch] = useState(0);
  const [booted, setBooted] = useState(false);
  const [bootStatus, setBootStatus] = useState<BootStatus>('checking');
  const bootStatusRef = useRef(bootStatus);
  const bootFlight = useRef<Promise<void> | null>(null);
  const foregroundRetrySafe = useRef(false);
  const mounted = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Account, role or grant changes drop every cached read model; the cache
  // keys carry the same dimensions, so this is the memory-hygiene half.
  useEffect(() => {
    syncQueryCacheIdentity(
      queryCacheIdentity(state.kind, state.accountId, state.role, state.capabilities ?? NO_CAPABILITIES),
    );
  }, [state.kind, state.accountId, state.role, state.capabilities]);

  const updateBootStatus = useCallback((status: BootStatus) => {
    bootStatusRef.current = status;
    setBootStatus(status);
  }, []);

  // One attempt per boot, manual retry or foreground transition. No timers or
  // API mutation replay; unavailable credentials remain locally recoverable.
  const runBoot = useCallback((): Promise<void> => {
    if (bootFlight.current) return bootFlight.current;
    const epoch = sessionStore.sessionEpoch();
    const current = () => mounted.current && epoch === sessionStore.sessionEpoch();
    foregroundRetrySafe.current = false;
    updateBootStatus('checking');
    const pending = (async () => {
      try {
        if (apiClient.mode !== 'live') {
          updateBootStatus('ready');
          return;
        }
        const { refreshToken, wipedForReinstall } = await sessionStore.loadBootstrap();
        if (wipedForReinstall && mounted.current) {
          updateBootStatus('ready');
          return;
        }
        if (!current()) return;
        if (!refreshToken) {
          updateBootStatus('ready');
          return;
        }
        const result = await sessionStore.refreshAccessToken();
        if (!current()) return;
        if (result.kind === 'unavailable') {
          // A lost response or malformed success may already have rotated the
          // grant. Only an explicit issuer outage response permits auto retry.
          foregroundRetrySafe.current = result.reason === 'issuer';
          updateBootStatus('unavailable');
        } else if (result.kind === 'refreshed') {
          const claims = decodeJwtPayload(result.accessToken);
          const capabilities = capabilitiesOf(result.accessToken);
          const role = roleFromClaims(claimsOf(result.accessToken))
            ?? (hasApplicantSurface(capabilities) ? APPLICANT_UI_ROLE : null);
          const accountId = typeof claims?.sub === 'string' && claims.sub.trim() ? claims.sub : null;
          const unexpired = typeof claims?.exp === 'number' && Number.isFinite(claims.exp) && claims.exp > Date.now() / 1000;
          if (role && accountId && unexpired) {
            // Restored identity wins: fence pending OIDC before it can store credentials.
            sessionStore.bumpEpoch();
            setEpoch((e) => e + 1);
            setState({
              kind: 'authenticated',
              role,
              accountId,
              blockedReason: null,
              capabilities,
            });
            updateBootStatus('ready');
          } else {
            sessionStore.setAccessToken(null);
            updateBootStatus('unavailable');
          }
        } else {
          updateBootStatus('ready');
        }
      } catch {
        if (current()) {
          sessionStore.setAccessToken(null);
          updateBootStatus('unavailable');
        }
      } finally {
        if (mounted.current) setBooted(true);
      }
    })().finally(() => { if (bootFlight.current === pending) bootFlight.current = null; });
    bootFlight.current = pending;
    return pending;
  }, [updateBootStatus]);

  const retryBoot = useCallback(() => {
    if (apiClient.mode !== 'live' || stateRef.current.kind !== 'signedOut') return Promise.resolve();
    if (bootFlight.current) return bootFlight.current;
    return bootStatusRef.current === 'unavailable' ? runBoot() : Promise.resolve();
  }, [runBoot]);

  useEffect(() => {
    mounted.current = true;
    void runBoot();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && foregroundRetrySafe.current) void retryBoot();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [runBoot, retryBoot]);

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
    updateBootStatus('ready');
    setState({
      kind: 'authenticated',
      role,
      accountId,
      blockedReason: null,
      capabilities: capabilitiesOf(sessionStore.getAccessToken()),
    });
  }, [updateBootStatus]);

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
    updateBootStatus('ready');
    // Preview never touches the credential store.
    if (stateRef.current.kind === 'preview') {
      setEpoch((e) => e + 1);
      clearQueryCache();
      setState(initialState);
      return;
    }
    // Captured before the wipe so the server can drop this device's registration.
    let accessTokenSnapshot: string | null = null;
    try {
      accessTokenSnapshot = sessionStore.getAccessToken();
    } catch {
      accessTokenSnapshot = null;
    }
    scheduleDevicePushUnregister(accessTokenSnapshot);
    // Local wipe first: it must not wait on, or depend on, the store call below.
    clearQueryCache();
    setEpoch((e) => e + 1);
    stateRef.current = initialState;
    setState(initialState);
    // No post-await state write: a new sign-in may complete during the disk wipe.
    await sessionStore.signOut();
  }, [updateBootStatus]);

  const value = useMemo<SessionValue>(() => ({
    ...state,
    epoch,
    booted,
    bootStatus,
    retryBoot,
    enterPreview,
    completeSignIn,
    switchRole,
    signOut,
    markBlocked,
    setRole,
  }), [state, epoch, booted, bootStatus, retryBoot, enterPreview, completeSignIn, switchRole, signOut, markBlocked, setRole]);

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
