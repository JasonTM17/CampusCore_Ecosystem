export type LocationPermission = 'granted' | 'denied-can-ask' | 'denied-blocked';
export type LocationErrorCode = 'PERMISSION_DENIED' | 'PERMISSION_BLOCKED' | 'SERVICES_OFF'
  | 'TIMEOUT' | 'LOW_ACCURACY' | 'STALE_FIX';

export class LocationServiceError extends Error {
  constructor(readonly code: LocationErrorCode) { super(code); this.name = 'LocationServiceError'; }
}

export interface FreshFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  mocked: boolean;
  provider?: Readonly<{ gpsAvailable?: boolean; networkAvailable?: boolean; passiveAvailable?: boolean }>;
}
export interface FreshFixOptions { timeoutMs?: number; maxAgeMs?: number }
export interface LocationProvider {
  ensurePermission(): Promise<LocationPermission>;
  isServicesEnabled(): Promise<boolean>;
  getFreshFix(options?: FreshFixOptions): Promise<FreshFix>;
}
export interface LocationSource {
  permission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  servicesEnabled(): Promise<boolean>;
  currentPosition(): Promise<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
    timestamp: number;
    mocked?: boolean;
  }>;
  providerStatus?(): Promise<NonNullable<FreshFix['provider']>>;
}

export function isFreshFix(fix: FreshFix, now: number, maxAgeMs = 30000): boolean {
  const timestamp = Date.parse(fix.capturedAt);
  return Number.isFinite(timestamp) && now - timestamp <= Math.min(maxAgeMs, 30000)
    && timestamp - now <= 10000;
}

/** Fakeable native boundary. Nothing here imports or caches a native position. */
export function createLocationProvider(source: LocationSource, options: {
  platform: 'android' | 'ios'; now?: () => number;
}): LocationProvider {
  const now = options.now ?? Date.now;
  async function ensurePermission(): Promise<LocationPermission> {
    let permission = await source.permission();
    if (!permission.granted && permission.canAskAgain) permission = await source.requestPermission();
    return permission.granted ? 'granted' : permission.canAskAgain ? 'denied-can-ask' : 'denied-blocked';
  }
  return {
    ensurePermission,
    isServicesEnabled: () => source.servicesEnabled(),
    async getFreshFix({ timeoutMs = 15000, maxAgeMs = 30000 } = {}) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
        throw new LocationServiceError('TIMEOUT');
      }
      let best: FreshFix | undefined;
      let mocked = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      const deadline = now() + timeoutMs;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new LocationServiceError('TIMEOUT')); }, timeoutMs);
      });
      const acquire = async () => {
        const permission = await ensurePermission();
        if (permission !== 'granted') throw new LocationServiceError(
          permission === 'denied-blocked' ? 'PERMISSION_BLOCKED' : 'PERMISSION_DENIED');
        if (!await source.servicesEnabled()) throw new LocationServiceError('SERVICES_OFF');
        let provider: FreshFix['provider'];
        try { provider = await source.providerStatus?.(); } catch { /* Advisory only. */ }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (expired || now() >= deadline) throw new LocationServiceError('TIMEOUT');
          const raw = await source.currentPosition();
          if (expired || now() >= deadline) throw new LocationServiceError('TIMEOUT');
          mocked ||= options.platform === 'android' && raw.mocked === true;
          const { latitude, longitude, accuracy } = raw.coords;
          if (!Number.isFinite(raw.timestamp) || now() - raw.timestamp > Math.min(maxAgeMs, 30000)
            || raw.timestamp - now() > 10000) throw new LocationServiceError('STALE_FIX');
          const fix: FreshFix = { latitude, longitude, accuracyMeters: accuracy ?? Infinity,
            capturedAt: new Date(raw.timestamp).toISOString(), mocked, ...(provider ? { provider } : {}) };
          if (!isFreshFix(fix, now(), maxAgeMs)) throw new LocationServiceError('STALE_FIX');
          if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude)
            || Math.abs(longitude) > 180) throw new LocationServiceError('STALE_FIX');
          if (fix.accuracyMeters < 0 || !Number.isFinite(fix.accuracyMeters)) fix.accuracyMeters = Infinity;
          if (!best || fix.accuracyMeters < best.accuracyMeters) best = fix;
          if (best.accuracyMeters <= 50) break;
        }
        return best;
      };
      try {
        await Promise.race([acquire(), timeout]);
      } catch (error) {
        // A later refinement timing out must not discard an already usable fresh fix.
        if (!(error instanceof LocationServiceError) || error.code !== 'TIMEOUT' || !best) throw error;
      } finally {
        expired = true;
        if (timer !== undefined) clearTimeout(timer);
      }
      if (!best) throw new LocationServiceError('TIMEOUT');
      if (!isFreshFix(best, now(), maxAgeMs)) throw new LocationServiceError('STALE_FIX');
      if (best.accuracyMeters > 100) throw new LocationServiceError('LOW_ACCURACY');
      // Provider metadata is advisory; do not extend the acquisition deadline for it.
      return { ...best, mocked };
    },
  };
}

/** Native modules load only when a real provider is requested, never in pure tests. */
export function createExpoLocationProvider(): LocationProvider {
  const location = require('expo-location') as typeof import('expo-location');
  const { Platform } = require('react-native') as typeof import('react-native');
  return createLocationProvider({
    permission: () => location.getForegroundPermissionsAsync(),
    requestPermission: () => location.requestForegroundPermissionsAsync(),
    servicesEnabled: () => location.hasServicesEnabledAsync(),
    providerStatus: () => location.getProviderStatusAsync(),
    currentPosition: () => location.getCurrentPositionAsync({ accuracy: location.Accuracy.High }),
  }, { platform: Platform.OS === 'android' ? 'android' : 'ios' });
}
