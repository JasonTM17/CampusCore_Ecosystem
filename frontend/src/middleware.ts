import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { defaultLocale, isLocale } from '@/i18n/config';
import {
  isBypassedPath,
  stripLocaleFromPathname,
} from '@/i18n/paths';
import { baseFor, devBaseFor, surfaceFromHost } from '@/lib/surfaces';

const LOCALE_COOKIE = 'cc_locale';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Legacy session cookie names: on a BFF surface host these must be deleted
// host-only so a stale cc_* can never shadow the opaque lane (§2 contract).
const LEGACY_COOKIE_PREFIX = 'cc_';

interface HostRouting {
  /** Terminal response (not-found rewrite or apex redirect) — skip the rest. */
  terminal?: NextResponse;
  /** Resolved surface for this host; null for the legacy localhost lane. */
  surface?: ReturnType<typeof surfaceFromHost>;
}

/**
 * Host routing (docs/ecosystem/host-policy.md §1/§6) runs before any locale
 * handling: the edge is the single point that knows the public host, so it
 * resolves the surface here and stamps x-campuscore-surface for downstream
 * route handlers. Unknown hosts get a not-found rewrite, never a redirect —
 * an open redirect by host header is exactly what this guard exists for.
 * Plain localhost/127.0.0.1 stays routable so the existing dev/CI loops keep
 * working against the legacy single-host lane.
 */
function routeByHost(request: NextRequest): HostRouting {
  const host = request.headers.get('host') ?? '';
  const bare = host.split(':')[0].toLowerCase();
  const surface = surfaceFromHost(host);
  if (surface === null) {
    if (bare === 'localhost' || bare === '127.0.0.1' || bare === '[::1]') {
      return { surface: null };
    }
    // Fail closed with a bare 404 — never a redirect (an open redirect by
    // host header is exactly what this guard exists for). A rewrite into the
    // locale-aware not-found tree is intentionally avoided: it must resolve
    // the [locale] layout and proved flaky (500) under the preview stack.
    return {
      terminal: new NextResponse('SURFACE_UNKNOWN', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      }),
    };
  }
  if (surface.mode === 'redirect' && surface.redirectTo) {
    const target = bare.endsWith('.localhost')
      ? devBaseFor(surface.redirectTo,
          request.nextUrl.protocol.replace(':', ''), host)
      : baseFor(surface.redirectTo);
    return {
      terminal: NextResponse.redirect(
        `${target}${request.nextUrl.pathname}${request.nextUrl.search}`, 301),
    };
  }
  return { surface };
}

/** Delete each legacy cc_* cookie on this surface host — host-only delete. */
function expireLegacyCookies(request: NextRequest, response: NextResponse) {
  const seen = new Set<string>();
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith(LEGACY_COOKIE_PREFIX) && cookie.name !== LOCALE_COOKIE
        && !seen.has(cookie.name)) {
      seen.add(cookie.name);
      response.cookies.set(cookie.name, '', { path: '/', maxAge: 0 });
    }
  }
}

// RT-P2-4 graduation: the report-only CSP is now enforced with a per-request
// nonce. Setting the policy on the *request* headers is what lets Next.js
// thread the nonce into its own scripts (flight data, webpack bootstrap);
// the response header is what the browser enforces. 'strict-dynamic' extends
// trust to scripts created by already-nonced code (TinyMCE's ScriptLoader);
// 'self' remains as the fallback for browsers that predate strict-dynamic.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildContentSecurityPolicy(nonce: string): string {
  // Dev mode keeps the same enforced shape but must additionally allow
  // webpack/react-refresh eval chunks and the HMR websocket, otherwise the
  // dev server hydrates nothing (CI portal-shell runs `next dev`).
  const dev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Next injects inline styles; TinyMCE composes with inline content_style.
    "style-src 'self' 'unsafe-inline'",
    // Announcements may embed https images and the editor inlines data:/blob:.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' data: blob: https:",
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

const DOCUMENT_FETCH_DESTINATIONS = new Set([
  'document',
  'frame',
  'iframe',
  'nested-document',
]);

function isNonDocumentFetch(secFetchDest: string | null) {
  return (
    secFetchDest !== null && !DOCUMENT_FETCH_DESTINATIONS.has(secFetchDest)
  );
}

function withRequestLocaleCookie(request: NextRequest, locale: string) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieParts = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith(`${LOCALE_COOKIE}=`));

  return [...cookieParts, `${LOCALE_COOKIE}=${locale}`].join('; ');
}

export function middleware(request: NextRequest) {
  const routing = routeByHost(request);
  if (routing.terminal) {
    return routing.terminal;
  }

  const { pathname } = request.nextUrl;

  if (isBypassedPath(pathname)) {
    return NextResponse.next();
  }

  const localeMatch = stripLocaleFromPathname(pathname);
  // Unprefixed URLs honor the saved preference: previously they forced the
  // default locale AND overwrote the request cookie with it, so a reload
  // silently reverted the visitor to Vietnamese.
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale =
    localeMatch.locale ?? (isLocale(cookieLocale) ? cookieLocale : defaultLocale);
  const strippedPath = localeMatch.pathname;
  const requestHeaders = new Headers(request.headers);

  // The edge is the only writer of the routing headers — caller-stamped
  // x-campuscore-* is stripped before the surface pair is stamped, and the
  // BFF session lane trusts only this pair (validated by the proxy token).
  for (const name of [...requestHeaders.keys()]) {
    if (name.toLowerCase().startsWith('x-campuscore-')) {
      requestHeaders.delete(name);
    }
  }
  if (routing.surface) {
    requestHeaders.set('x-campuscore-surface', routing.surface.id);
    requestHeaders.set(
      'x-campuscore-scheme',
      request.nextUrl.protocol.replace(':', ''),
    );
  }

  requestHeaders.set('x-cc-locale', locale);
  requestHeaders.set('x-cc-visible-pathname', pathname);
  requestHeaders.set('x-cc-stripped-pathname', strippedPath);
  requestHeaders.set('x-cc-locale-prefixed', localeMatch.locale ? '1' : '0');
  requestHeaders.set(
    'cookie',
    withRequestLocaleCookie(request, locale),
  );

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce);
  // x-nonce is consumed by layout.tsx for hand-written inline scripts; the CSP
  // request header is what Next.js parses to nonce its own framework scripts.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  if (localeMatch.locale) {
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    response.headers.set('Content-Security-Policy', csp);

    const isPrefetch =
      request.headers.has('rsc') ||
      request.headers.has('next-router-prefetch') ||
      request.headers.get('purpose')?.toLowerCase() === 'prefetch' ||
      /(?:^|[\s,;])prefetch(?:$|[\s,;])/.test(
        request.headers.get('sec-purpose')?.toLowerCase() ?? '',
      ) ||
      isNonDocumentFetch(request.headers.get('sec-fetch-dest'));

    if (!isPrefetch) {
      response.cookies.set(LOCALE_COOKIE, locale, {
        path: '/',
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
      });
    }

    if (routing.surface) {
      expireLegacyCookies(request, response);
    }
    return response;
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('Content-Security-Policy', csp);
  if (routing.surface) {
    expireLegacyCookies(request, response);
  }
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};
