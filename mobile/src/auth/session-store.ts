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
  | { kind: 'unavailable'; accessToken: null; reason: 'network' | 'issuer' | 'configuration' | 'response' | 'storage' };

export interface SessionStoreDeps {
  secure: SecureKv;
  sandbox: SandboxKv;
  /** Issuer ORIGIN — every /oauth2/* call goes here, never the API host (KM-2). */
  issuer: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
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
   * resolve: a refresh in-flight across a sign-out must not persist rotated
   * material over the wipe (KM-6).
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
    try {
      const credential = await mutate(async () => epoch === sessionEpoch ? secure.getItemAsync(REFRESH_KEY) : null);
      if (epoch !== sessionEpoch) return stale();
      if (!credential) {
        accessToken = null;
        return { kind: 'signedOut', accessToken: null };
      }
      let response: Response;
      let body: Record<string, unknown> | null;
      try {
        response = await fetchImpl(`${issuer}/oauth2/token`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: oauthForm({ grant_type: 'refresh_token', client_id: clientId, refresh_token: credential }),
        });
        body = parseJson(await response.text());
      } catch {
        return unavailable(epoch, 'network');
      }
      return await mutate(async (): Promise<RefreshResult> => {
        if (epoch !== sessionEpoch) return stale();
        // Only the issuer's terminal refresh-grant rejection destroys credentials.
        // Outage bodies are not authoritative even if they contain that error.
        if (response.status === 400 && body?.error === 'invalid_grant') {
          accessToken = null;
          await secure.deleteItemAsync(REFRESH_KEY);
          return epoch === sessionEpoch ? { kind: 'signedOut', accessToken: null } : stale();
        }
        if (!response.ok) return unavailable(epoch, response.status === 429 || response.status >= 500 ? 'issuer' : 'configuration');
        const nextAccess = typeof body?.access_token === 'string' && body.access_token.trim() ? body.access_token : null;
        if (!nextAccess) return unavailable(epoch, 'response');
        const nextRefresh = typeof body?.refresh_token === 'string' && body.refresh_token.trim() ? body.refresh_token : null;
        if (nextRefresh) await secure.setItemAsync(REFRESH_KEY, nextRefresh);
        if (epoch !== sessionEpoch) return stale();
        accessToken = nextAccess;
        return { kind: 'refreshed', accessToken: nextAccess };
      });
    } catch {
      return unavailable(epoch, 'storage');
    }
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
      if (!credential) {
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
