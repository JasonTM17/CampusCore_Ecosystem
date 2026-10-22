import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { createSessionStore, type SecureKv } from './session-store';

/**
 * Production binding (mobile-policy §3): expo-secure-store as the secure KV —
 * refresh + install marker are WHEN_UNLOCKED_THIS_DEVICE_ONLY (device-only,
 * no backup/sync); AsyncStorage holds only the `installMarker` twin (KM-1).
 * Issuer comes from EXPO_PUBLIC_ISSUER_URL, mandatory when the issuer host
 * differs from the API host (KM-2); the platform default covers emulator dev.
 */

declare const process: { env: Record<string, string | undefined> };

function defaultIssuer(): string {
  const configured = process.env.EXPO_PUBLIC_ISSUER_URL;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:4010'
    : 'http://127.0.0.1:4010';
}

const secureKv: SecureKv = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

export const sessionStore = createSessionStore({
  secure: secureKv,
  sandbox: AsyncStorage,
  issuer: defaultIssuer(),
});
