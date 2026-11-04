/**
 * Session token authority (mobile-policy §3, KM-1/KM-6/KM-7). Pure factory —
 * no react-native/expo imports so the same store logic runs against a
 * SecureStore binding (mobile-session-store.ts) or an in-memory test mirror.
 * Owns ALL persistent session I/O and the refresh/revoke calls to the
 * issuer host — `apiClient` never sees a refresh token. Access tokens live
 * in this module's memory only. Disk whitelist: `cu.refresh` + `cu.install`
 * (secure KV) and `installMarker` (sandbox KV).
 */

const REFRESH_KEY = 'cu.refresh';
const INSTALL_KEY = 'cu.install';
const MARKER_KEY = 'installMarker';
const DEFAULT_CLIENT_ID = 'cu-mobile';
/** App-level deadline for refresh, independent of the OIDC code-exchange timeout. */
const DEFAULT_TOKEN_TIMEOUT_MS = 20_000;

export interface SecureKv {
  getItemAsync(key: string, options?: unknown): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: unknown): Promise<void>;
  deleteItemAsync(key: string, options?: unknown): Promise<void>;
}

export interface SandboxKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface BootstrapResult {
  /** Opaque refresh token still bound to this install, or null → signed out. */
  refreshToken: string | null;
  /** Marker missing/mismatch → refresh wiped + identity regenerated (KM-1). */
  wipedForReinstall: boolean;
}

export type RefreshResult =
  | { kind: 'refreshed'; accessToken: string }
  | { kind: 'signedOut' | 'stale'; accessToken: null }
  | { kind: 'reauthRequired'; accessToken: null }
  | { kind: 'unavailable'; accessToken: null; reason: 'network' | 'issuer' | 'configuration' | 'response' | 'storage' };

export interface SessionStoreDeps {
  secure: SecureKv;
  sandbox: SandboxKv;
  /** Issuer ORIGIN — every /oauth2/* call goes here, never the API host (KM-2). */
  issuer: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
  /** Token-request deadline; a dispatched abort requires a fresh sign-in. */
  timeoutMs?: number;
  now?: () => number;
  newId?: () => string;
}

export interface SessionStore {
  /** Resolved issuer origin — the authorize flow must target the same host (KM-2). */
  readonly issuer: string;
  /** Marker check → returns surviving refresh token or null (KM-17 boot step). */
  loadBootstrap(): Promise<BootstrapResult>;
  /** Persist a refresh token from the OIDC code exchange — the ONLY writer. */
  saveRefresh(token: string): Promise<void>;
  clearRefresh(): Promise<void>;
  /**
   * grant_type=refresh_token against {issuer}/oauth2/token (client_id only —
   * KM-3 probe). Epoch check gates the SecureStore WRITE, not just the
   * resolve: the old credential is removed before dispatch, and an in-flight
   * refresh across a sign-out must not persist rotated material over the wipe.
   */
  refreshAccessToken(): Promise<RefreshResult>;
  /**
   * Logout ordering: epoch++ → clear memory → best-effort wipe cu.refresh →
   * best-effort POST {issuer}/oauth2/revoke. Never throws.
   */
  signOut(): Promise<void>;
  setAccessToken(token: string | null): void;
  getAccessToken(): string | null;
  bumpEpoch(): void;
  /** Current session epoch — request-time capture lets callers detect a stale lane. */
  sessionEpoch(): number;
}

function defaultId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
  const { secure, sandbox, fetchImpl = fetch, now = () => Date.now(), newId = defaultId } = deps;
  const issuer = deps.issuer.replace(/\/+$/, '');
  const clientId = deps.clientId ?? DEFAULT_CLIENT_ID;
  const tokenTimeoutMs = deps.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;

  let accessToken: string | null = null;
  // Bumped on sign-in/sign-out; a late refresh resolving under a newer epoch
  // is a no-op BEFORE it can touch disk (KM-6).
  let sessionEpoch = 0;
  let mutationTail: Promise<unknown> = Promise.resolve();
  let refreshFlight: { epoch: number; promise: Promise<RefreshResult> } | null = null;

  // Native writes cannot be cancelled. A later wipe/sign-in must run after
  // any already-started rotation, including a write paused inside SecureStore.
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const pending = mutationTail.then(operation);
    mutationTail = pending.catch(() => undefined);
    return pending;
  }

  const stale = (): RefreshResult => ({ kind: 'stale', accessToken: null });
  function reauthRequired(epoch: number): RefreshResult {
    if (epoch !== sessionEpoch) return stale();
    accessToken = null;
    return { kind: 'reauthRequired', accessToken: null };
  }

  function unavailable(epoch: number, reason: Extract<RefreshResult, { kind: 'unavailable' }>['reason']): RefreshResult {
    if (epoch !== sessionEpoch) return stale();
    accessToken = null;
    return { kind: 'unavailable', accessToken: null, reason };
  }

  function oauthForm(fields: Record<string, string>) {
    return Object.entries(fields)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
  }

  async function refresh(epoch: number): Promise<RefreshResult> {
    let tokenUrl: string | null = null;
    try {
      const parsedIssuer = new URL(issuer);
      if ((parsedIssuer.protocol === 'https:' || parsedIssuer.protocol === 'http:')
        && parsedIssuer.host && !parsedIssuer.username && !parsedIssuer.password) {
        tokenUrl = `${issuer}/oauth2/token`;
      }
    } catch {
      tokenUrl = null;
    }

    let prepared: {
      kind: 'ready';
      credential: string;
      url: string;
      body: string;
    } | { kind: 'stale' } | { kind: 'signedOut' }
      | { kind: 'unavailable'; reason: 'configuration' };
    try {
      prepared = await mutate(async () => {
        if (epoch !== sessionEpoch) return { kind: 'stale' } as const;
        const credential = await secure.getItemAsync(REFRESH_KEY);
        if (epoch !== sessionEpoch) return { kind: 'stale' } as const;
        if (!credential) {
          accessToken = null;
          return { kind: 'signedOut' } as const;
        }
        if (!tokenUrl || !clientId.trim()) {
          return { kind: 'unavailable', reason: 'configuration' } as const;
        }
        let body: string;
        try {
          body = oauthForm({ grant_type: 'refresh_token', client_id: clientId, refresh_token: credential });
        } catch {
          return { kind: 'unavailable', reason: 'configuration' } as const;
        }
        await secure.deleteItemAsync(REFRESH_KEY);
        if (epoch !== sessionEpoch) return { kind: 'stale' } as const;
        return { kind: 'ready', credential, url: tokenUrl, body } as const;
      });
    } catch {
      return unavailable(epoch, 'storage');
    }
    if (prepared.kind === 'stale') return stale();
    if (prepared.kind === 'signedOut') return { kind: 'signedOut', accessToken: null };
    if (prepared.kind === 'unavailable') return unavailable(epoch, prepared.reason);
    if (epoch !== sessionEpoch) return stale();

    // The credential is absent from persistent storage before this dispatch.
    let response: Response;
    let body: Record<string, unknown> | null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: 'timeout' });
      }, tokenTimeoutMs);
    });
    try {
      if (epoch !== sessionEpoch) return stale();
      const result = await Promise.race([
        (async () => {
          const received = await fetchImpl(prepared.url, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: prepared.body,
            signal: controller.signal,
          });
          const parsed = parseJson(await received.text());
          return { kind: 'response' as const, response: received, body: parsed };
        })(),
        deadline,
      ]);
      if (result.kind === 'timeout') return reauthRequired(epoch);
      response = result.response;
      body = result.body;
    } catch {
      return reauthRequired(epoch);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return await mutate(async (): Promise<RefreshResult> => {
      if (epoch !== sessionEpoch) return stale();
      // A terminal rejection is known; other dispatched responses may have
      // committed rotation, so their credential remains quarantined.
      if (!response.ok && (response.status === 400 || response.status === 401)) {
        accessToken = null;
        return epoch === sessionEpoch ? { kind: 'signedOut', accessToken: null } : stale();
      }
      if (!response.ok) return reauthRequired(epoch);
      const nextAccess = typeof body?.access_token === 'string' && body.access_token.trim() ? body.access_token : null;
      const nextRefresh = typeof body?.refresh_token === 'string' && body.refresh_token.trim() ? body.refresh_token : null;
      if (!nextAccess || !nextRefresh || nextRefresh === prepared.credential) return reauthRequired(epoch);
      try {
        await secure.setItemAsync(REFRESH_KEY, nextRefresh);
      } catch {
        // A native write can commit even when its acknowledgement rejects.
        await secure.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
        return reauthRequired(epoch);
      }
      if (epoch !== sessionEpoch) return stale();
      accessToken = nextAccess;
      return { kind: 'refreshed', accessToken: nextAccess };
    });
  }

  return {
    issuer,

    loadBootstrap() {
      const epoch = sessionEpoch;
      return mutate(async () => {
        if (epoch !== sessionEpoch) return { refreshToken: null, wipedForReinstall: false };
        const install = parseJson(await secure.getItemAsync(INSTALL_KEY));
        const marker = parseJson(await sandbox.getItem(MARKER_KEY));
        if (epoch !== sessionEpoch) return { refreshToken: null, wipedForReinstall: false };
        const installId = typeof install?.appInstanceId === 'string' ? install.appInstanceId : null;
        const markerId = typeof marker?.appInstanceId === 'string' ? marker.appInstanceId : null;

        if (!installId || markerId !== installId) {
          sessionEpoch += 1;
          accessToken = null;
          // Reinstall or sandbox wipe: surviving credentials belong to the old
          // identity. Wipe before any request and regenerate both marker layers.
          await secure.deleteItemAsync(REFRESH_KEY);
          const appInstanceId = newId();
          await secure.setItemAsync(
            INSTALL_KEY,
            JSON.stringify({ appInstanceId, createdAt: new Date(now()).toISOString() }),
          );
          await sandbox.setItem(MARKER_KEY, JSON.stringify({ appInstanceId }));
          return { refreshToken: null, wipedForReinstall: true };
        }

        return {
          refreshToken: await secure.getItemAsync(REFRESH_KEY),
          wipedForReinstall: false,
        };
      });
    },

    saveRefresh(token) {
      const epoch = sessionEpoch;
      return mutate(async () => {
        if (epoch !== sessionEpoch) throw new Error('Session changed before credential storage.');
        await secure.setItemAsync(REFRESH_KEY, token);
        if (epoch !== sessionEpoch) throw new Error('Session changed during credential storage.');
      });
    },

    clearRefresh() {
      return mutate(() => secure.deleteItemAsync(REFRESH_KEY));
    },

    refreshAccessToken() {
      const epoch = sessionEpoch;
      if (refreshFlight?.epoch === epoch) return refreshFlight.promise;
      const promise = refresh(epoch).finally(() => {
        if (refreshFlight?.promise === promise) refreshFlight = null;
      });
      refreshFlight = { epoch, promise };
      return promise;
    },

    async signOut() {
      // Local authorization ends synchronously, even when native storage fails.
      sessionEpoch += 1;
      accessToken = null;
      const credential = await mutate(async () => {
        const stored = await secure.getItemAsync(REFRESH_KEY).catch(() => null);
        await secure.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
        return stored;
      });
      if (!credential || !issuer) {
        return;
      }
      // Best-effort revoke — NOT awaited: the contract ordering puts every
      // local clear before revoke precisely so a hung issuer call can never
      // hold the UI in an authenticated state (review F6).
      void Promise.resolve().then(() => fetchImpl(`${issuer}/oauth2/revoke`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: oauthForm({
          token: credential,
          client_id: clientId,
        }),
      })).catch(() => {
        // Revoke is best-effort — local sign-out already happened.
      });
    },

    setAccessToken(token) {
      accessToken = token;
    },
    getAccessToken() {
      return accessToken;
    },
    bumpEpoch() {
      sessionEpoch += 1;
    },
    sessionEpoch() {
      return sessionEpoch;
    },
  };
}
