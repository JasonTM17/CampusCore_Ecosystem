import type { components } from './generated-api';

export type PushDeviceRegistrationResponse =
  components['schemas']['PushDeviceRegistrationResponse'];
export type PushProvider = 'EXPO';
export type PushDevicePlatform = 'IOS' | 'ANDROID';

export interface PushDeviceRegistrationBody {
  provider: PushProvider;
  platform: PushDevicePlatform;
  token: string;
}

export interface PushPermissionStatus {
  granted: boolean;
  canAskAgain?: boolean;
}

export interface PushPlatform {
  readonly provider: PushProvider;
  readonly platform: PushDevicePlatform | null;
  getInstallationId(): Promise<string>;
  getPermissionsAsync(): Promise<PushPermissionStatus>;
  requestPermissionsAsync(): Promise<PushPermissionStatus>;
  getPushToken(): Promise<string>;
}

export interface PushApi {
  registerPushDevice(
    installationId: string,
    body: PushDeviceRegistrationBody,
  ): Promise<PushDeviceRegistrationResponse>;
  unregisterPushDevice(installationId: string, accessToken?: string): Promise<void>;
}

export type PushRegistrationResult =
  | { status: 'confirmation-required' }
  | { status: 'unavailable' }
  | { status: 'permission-denied' }
  | { status: 'registered'; installationId: string }
  | { status: 'registration-failed' };

export interface PushNotificationClient {
  register(userConfirmed: boolean): Promise<PushRegistrationResult>;
  unregister(): Promise<boolean>;
}

/** The UI calls this only after it has explained the permission request. */
export function createPushNotificationClient(
  platform: PushPlatform,
  api: PushApi,
): PushNotificationClient {
  return {
    async register(userConfirmed) {
      if (!userConfirmed) return { status: 'confirmation-required' };
      if (!platform.platform) return { status: 'unavailable' };

      try {
        let permission = await platform.getPermissionsAsync();
        if (!permission.granted && permission.canAskAgain !== false) {
          permission = await platform.requestPermissionsAsync();
        }
        if (!permission.granted) return { status: 'permission-denied' };

        const installationId = await platform.getInstallationId();
        if (!installationId) return { status: 'registration-failed' };
        const token = await platform.getPushToken();
        if (!token) return { status: 'registration-failed' };
        await api.registerPushDevice(installationId, {
          provider: platform.provider,
          platform: platform.platform,
          token,
        });
        return { status: 'registered', installationId };
      } catch {
        // Provider/API errors can contain device or credential data; return a
        // stable state and leave diagnostics to the redacted API metric lane.
        return { status: 'registration-failed' };
      }
    },

    async unregister() {
      try {
        const installationId = await platform.getInstallationId();
        if (!installationId) return false;
        await api.unregisterPushDevice(installationId);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Call before wiping the session. `accessToken` is the snapshot captured by
 * the caller; this helper deliberately never waits on or throws to sign-out.
 */
export function unregisterPushBestEffort(
  api: Pick<PushApi, 'unregisterPushDevice'>,
  installationId: string | null | undefined,
  accessToken: string | null | undefined,
): void {
  if (!installationId || !accessToken) return;
  try {
    void Promise.resolve(api.unregisterPushDevice(installationId, accessToken)).catch(() => undefined);
  } catch {
    // Local session teardown must not depend on a push API request.
  }
}

export interface NotificationTargetRecord {
  targetPath?: unknown;
  /** Inbox column `notifications.notification.link`; resolved by `push-routes.ts`. */
  link?: unknown;
}

/** Fetch the authenticated inbox record and return only an injected safe path. */
export async function resolveNotificationTarget(
  notificationId: string,
  fetchNotification: (notificationId: string) => Promise<NotificationTargetRecord>,
  allowedPaths: readonly string[],
): Promise<string | null> {
  const record = await fetchNotification(notificationId);
  const candidate = record && typeof record.targetPath === 'string'
    ? record.targetPath
    : null;
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return null;
  }
  return allowedPaths.includes(candidate) ? candidate : null;
}
