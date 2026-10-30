import type { SecureKv } from '../auth/session-store';

export const INSTALLATION_ID_KEY = 'cu.attendance.installation';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Device-scoped, like cu.install: sign-out clears refresh tokens, not device IDs. */
export function createInstallationIdStore(secure: Pick<SecureKv, 'getItemAsync' | 'setItemAsync'>,
  randomUUID: () => string): { getInstallationId(): Promise<string> } {
  let pending: Promise<string> | undefined;
  return {
    getInstallationId() {
      if (!pending) {
        pending = (async () => {
          const stored = await secure.getItemAsync(INSTALLATION_ID_KEY);
          if (stored && UUID_V4.test(stored)) return stored;
          const id = randomUUID();
          if (!UUID_V4.test(id)) throw new Error('INSTALLATION_ID_UNAVAILABLE');
          await secure.setItemAsync(INSTALLATION_ID_KEY, id);
          return id;
        })().catch((error: unknown) => { pending = undefined; throw error; });
      }
      return pending;
    },
  };
}

let nativeStore: ReturnType<typeof createInstallationIdStore> | undefined;
export function getInstallationId(): Promise<string> {
  if (!nativeStore) {
    const secure = require('expo-secure-store') as typeof import('expo-secure-store');
    // Expo's native UUID v4 generator uses OS randomness; never Math.random/hardware IDs.
    require('expo');
    nativeStore = createInstallationIdStore({
      getItemAsync: (key) => secure.getItemAsync(key),
      setItemAsync: (key, value) => secure.setItemAsync(key, value, {
        keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    }, () => {
      const runtime = globalThis as typeof globalThis & { expo?: { uuidv4?: () => string } };
      const id = runtime.expo?.uuidv4?.();
      if (!id) throw new Error('INSTALLATION_ID_UNAVAILABLE');
      return id;
    });
  }
  return nativeStore.getInstallationId();
}
