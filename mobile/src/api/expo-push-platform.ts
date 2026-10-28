import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Notification, NotificationBehavior } from 'expo-notifications';

import type { PushPlatform } from './push-notifications';

const INSTALL_KEY = 'cu.install';
const INSTALL_MARKER_KEY = 'installMarker';
const FOREGROUND_DEADLINE_MS = 2500;
const FOREGROUND_FALLBACK: NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

type ExpoNotificationsModule = typeof import('expo-notifications');
let notificationsModule: Promise<ExpoNotificationsModule> | undefined;

async function loadNotifications(): Promise<ExpoNotificationsModule> {
  notificationsModule ??= (async () => await import('expo-notifications'))();
  return notificationsModule;
}

function parseAppInstanceId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value && typeof value === 'object'
      && typeof (value as { appInstanceId?: unknown }).appInstanceId === 'string'
    ) {
      return (value as { appInstanceId: string }).appInstanceId;
    }
  } catch {
    // A missing/malformed existing marker must not create a second identity.
  }
  return null;
}

async function readInstallationId(): Promise<string> {
  const [secureInstall, sandboxMarker] = await Promise.all([
    SecureStore.getItemAsync(INSTALL_KEY),
    AsyncStorage.getItem(INSTALL_MARKER_KEY),
  ]);
  const secureId = parseAppInstanceId(secureInstall);
  const sandboxId = parseAppInstanceId(sandboxMarker);
  if (!secureId || secureId !== sandboxId) {
    throw new Error('INSTALLATION_ID_UNAVAILABLE');
  }
  return secureId;
}

const nativePlatform: PushPlatform['platform'] = Platform.OS === 'ios'
  ? 'IOS'
  : Platform.OS === 'android' ? 'ANDROID' : null;

export const expoPushPlatform: PushPlatform = {
  provider: 'EXPO',
  platform: nativePlatform,

  getInstallationId: readInstallationId,

  async getPermissionsAsync() {
    const notifications = await loadNotifications();
    const result = await notifications.getPermissionsAsync();
    return { granted: result.granted, canAskAgain: result.canAskAgain };
  },

  async requestPermissionsAsync() {
    const notifications = await loadNotifications();
    const result = await notifications.requestPermissionsAsync();
    return { granted: result.granted, canAskAgain: result.canAskAgain };
  },

  async getPushToken() {
    const notifications = await loadNotifications();
    const token = await notifications.getExpoPushTokenAsync();
    return token.data;
  },
};

/**
 * Install a fast foreground policy. Slow or rejected callbacks resolve to a
 * quiet result before the SDK's three-second notification deadline.
 */
export async function configureForegroundHandler(
  handler: (notification: Notification) => NotificationBehavior | Promise<NotificationBehavior>,
): Promise<void> {
  const notifications = await loadNotifications();
  notifications.setNotificationHandler({
    handleNotification: (notification) => new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        resolve(FOREGROUND_FALLBACK);
      }, FOREGROUND_DEADLINE_MS);
      Promise.resolve(handler(notification)).then(
        (behavior) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(behavior);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(FOREGROUND_FALLBACK);
        },
      );
    }),
  });
}
