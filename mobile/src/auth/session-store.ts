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

export interface RefreshResult {
  /** Fresh access token, or null when the session is dead (signed out). */
  accessToken: string | null;
}

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
   * KM-6 logout ordering: epoch++ → wipe cu.refresh → clear memory →
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

  function oauthForm(fields: Record<string, string>) {
    return Object.entries(fields)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
  }

  return {
    issuer,

    async loadBootstrap() {
      const install = parseJson(await secure.getItemAsync(INSTALL_KEY));
      const marker = parseJson(await sandbox.getItem(MARKER_KEY));
      const installId = typeof install?.appInstanceId === 'string' ? install.appInstanceId : null;
      const markerId = typeof marker?.appInstanceId === 'string' ? marker.appInstanceId : null;

      if (!installId || markerId !== installId) {
        // Reinstall or sandbox wipe (KM-1): the surviving keychain refresh is
        // bound to a dead install identity — wipe it before any request,
        // regenerate the identity, and write BOTH layers back.
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
    },

    saveRefresh(token) {
      return secure.setItemAsync(REFRESH_KEY, token);
    },

    clearRefresh() {
      return secure.deleteItemAsync(REFRESH_KEY);
    },

    async refreshAccessToken() {
      const epoch = sessionEpoch;
      const refresh = await secure.getItemAsync(REFRESH_KEY);
      if (!refresh) {
        return { accessToken: null };
      }

      const response = await fetchImpl(`${issuer}/oauth2/token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: oauthForm({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refresh,
        }),
      });
      const body = parseJson(await response.text());

      // Epoch gate #1 — session changed while the request was in flight.
      if (epoch !== sessionEpoch) {
        return { accessToken: null };
      }

      const nextAccess = typeof body?.access_token === 'string' ? body.access_token : null;
      if (!response.ok || !nextAccess) {
        await secure.deleteItemAsync(REFRESH_KEY);
        accessToken = null;
        return { accessToken: null };
      }

      const nextRefresh = typeof body?.refresh_token === 'string' ? body.refresh_token : null;
      // Epoch gate #2 — guards the disk write itself (KM-6).
      if (epoch !== sessionEpoch) {
        return { accessToken: null };
      }
      if (nextRefresh) {
        await secure.setItemAsync(REFRESH_KEY, nextRefresh);
      }
      accessToken = nextAccess;
      return { accessToken: nextAccess };
    },

    async signOut() {
      // KM-6 ordering: epoch++ first so any in-flight refresh resolves as a
      // no-op, then disk wipe, then memory clear, then best-effort revoke.
      sessionEpoch += 1;
      const refresh = await secure.getItemAsync(REFRESH_KEY);
      await secure.deleteItemAsync(REFRESH_KEY);
      accessToken = null;
      if (!refresh) {
        return;
      }
      // Best-effort revoke — NOT awaited: the contract ordering puts every
      // local clear before revoke precisely so a hung issuer call can never
      // hold the UI in an authenticated state (review F6).
      void fetchImpl(`${issuer}/oauth2/revoke`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: oauthForm({
          token: refresh,
          client_id: clientId,
        }),
      }).catch(() => {
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
