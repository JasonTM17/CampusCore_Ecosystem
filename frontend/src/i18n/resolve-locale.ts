import { defaultLocale, isLocale, type Locale } from '@/i18n/config';

const LOCALE_COOKIE_NAME = 'cc_locale';

/**
 * Reads the persisted locale cookie on the client. Accepts an explicit cookie
 * string so the parser stays pure and testable; falls back to document.cookie
 * and returns null on the server or when the cookie is absent/malformed.
 */
export function readLocaleCookie(cookieSource?: string): string | null {
  const source =
    cookieSource ??
    (typeof document !== 'undefined' ? document.cookie : null);
  if (source === null) {
    return null;
  }

  const match = source.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=([^;]*)`),
  );
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Single locale decision for client code, mirroring the middleware order so
 * SSR and hydration can never disagree:
 * 1. the URL locale prefix always wins (a prefixed URL means the visitor or a
 *    link explicitly chose that locale);
 * 2. otherwise a valid persisted cc_locale cookie;
 * 3. otherwise the locale the server already rendered with;
 * 4. otherwise the default locale.
 */
export function resolveClientLocale({
  routeLocale,
  cookieLocale,
  serverLocale,
}: {
  routeLocale?: string | null;
  cookieLocale?: string | null;
  serverLocale?: string | null;
}): Locale {
  if (isLocale(routeLocale)) {
    return routeLocale;
  }
  if (isLocale(cookieLocale)) {
    return cookieLocale;
  }
  if (isLocale(serverLocale)) {
    return serverLocale;
  }
  return defaultLocale;
}
