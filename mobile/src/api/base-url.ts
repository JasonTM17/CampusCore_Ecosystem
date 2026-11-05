import { Platform } from 'react-native';

export const DEFAULT_API_BASE_URL = Platform.OS === 'android'
  ? 'http://10.0.2.2:4010/api/v1'
  : 'http://127.0.0.1:4010/api/v1';

export function isLocalCleartextUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '10.0.2.2', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

export function resolveApiBaseUrl(
  configured: string | undefined,
  development: boolean,
  platform: string = Platform.OS,
  allowCleartextLocal = false,
): string | undefined {
  const candidate = configured?.trim();
  if (!candidate) {
    if (!development) return undefined;
    return platform === 'android'
      ? 'http://10.0.2.2:4010/api/v1'
      : 'http://127.0.0.1:4010/api/v1';
  }

  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username || url.password || /[?#]/.test(candidate)) return undefined;
    if (!development && url.protocol !== 'https:' && !(allowCleartextLocal && isLocalCleartextUrl(candidate))) return undefined;
    // A base typed with `//api//v1` must not double the slash at every join.
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}
