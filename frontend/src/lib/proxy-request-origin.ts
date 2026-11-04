/**
 * Request-origin guard for the Next edge proxy (edge proxy hardening).
 *
 * Policy (plans/reports/orchestrate-261101-w14/sol-p4/result.md §3):
 * - Only mutating methods are checked; GET/HEAD/OPTIONS pass through.
 * - `Sec-Fetch-Site` present must be a known non-sibling value. Cross-site,
 *   same-site and unknown values are rejected: a sibling surface is same-site
 *   but still a different origin, so the old "not cross-site" check was too
 *   weak.
 * - `Origin` present must exactly equal the target origin resolved from the
 *   configured surface registry plus the serving scheme/port. `null`,
 *   malformed, multiple and sibling origins are rejected.
 * - Missing `Origin` and missing Fetch Metadata may pass for server/native
 *   callers; the Java BFF authentication and CSRF guards still apply there.
 *
 * The target is never taken from JAVA_API_ORIGIN, forwarded headers or the
 * request URL's host: Next builds its request URL from the server bind address,
 * so only the scheme component is usable here. The host comes from the Host
 * header, but only after it matches a configured surface host or the local
 * development host set.
 */

import { surfaceFromHost } from '@/lib/surfaces';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Mirrors the Java BFF guard: only same-origin Fetch Metadata may accompany a
// mutation. `none` (user-initiated navigation), cross-site, same-site and
// unknown values are all rejected.
const ALLOWED_FETCH_SITES = new Set(['same-origin']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export type ProxyOriginFailure = 'FETCH_SITE' | 'ORIGIN';

export type ProxyOriginResult =
  | { allowed: true; targetOrigin: string | null }
  | { allowed: false; reason: ProxyOriginFailure };

export interface ProxyOriginRequest {
  method: string;
  headers: Headers;
  nextUrl: { protocol: string };
}

interface HostParts {
  hostname: string;
  port: string;
}

function validPort(port: string): boolean {
  if (!/^\d{1,5}$/.test(port)) return false;
  const value = Number(port);
  return value > 0 && value <= 65535;
}

/** Parse a Host header without trusting forwarded host headers. */
function parseHostHeader(rawHost: string | null): HostParts | null {
  if (rawHost === null) return null;
  const host = rawHost.trim();
  if (!host || /[\s,/@]/.test(host)) return null;

  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end <= 1) return null;
    const hostname = host.slice(0, end + 1).toLowerCase();
    if (!/^\[[0-9a-f:.]+\]$/.test(hostname)) return null;
    const rest = host.slice(end + 1);
    if (!rest) return { hostname, port: '' };
    if (!/^:\d{1,5}$/.test(rest)) return null;
    const port = rest.slice(1);
    return validPort(port) ? { hostname, port } : null;
  }

  const colon = host.indexOf(':');
  if (colon !== -1 && colon !== host.lastIndexOf(':')) return null;
  const hostname = (colon === -1 ? host : host.slice(0, colon)).toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
  if (colon === -1) return { hostname, port: '' };
  const port = host.slice(colon + 1);
  return validPort(port) ? { hostname, port } : null;
}

function servingScheme(request: ProxyOriginRequest): 'http' | 'https' | null {
  const protocol = request.nextUrl?.protocol;
  if (typeof protocol !== 'string') return null;
  const scheme = protocol.replace(':', '').toLowerCase();
  return scheme === 'http' || scheme === 'https' ? scheme : null;
}

function formatOrigin(scheme: string, hostname: string, port: string): string {
  return `${scheme}://${hostname}${port ? `:${port}` : ''}`;
}

/**
 * Resolve the origin this proxy is serving. Surface hosts come from the
 * configured registry; the legacy localhost lane accepts only the local
 * development names. Unknown hosts resolve to null and cannot authorize a
 * mutating request that carries an Origin header.
 */
export function resolveProxyTargetOrigin(request: ProxyOriginRequest): string | null {
  const host = parseHostHeader(request.headers.get('host'));
  if (!host) return null;
  const scheme = servingScheme(request);
  if (!scheme) return null;

  const surface = surfaceFromHost(host.hostname);
  if (surface) {
    const production = surface.host.toLowerCase();
    const preview = surface.devHost.toLowerCase();
    if (host.hostname === production) {
      // Configured production surface hosts are HTTPS-only (host-policy §1/§6);
      // never let a caller-controlled scheme header downgrade the target.
      return formatOrigin('https', host.hostname, host.port);
    }
    if (host.hostname === preview) {
      // Local preview shares one dev server, so its scheme and port come from
      // the serving request (HTTP dev or --experimental-https preview).
      return formatOrigin(scheme, host.hostname, host.port);
    }
    return null;
  }

  if (!LOCAL_HOSTNAMES.has(host.hostname)) return null;
  return formatOrigin(scheme, host.hostname, host.port);
}

/**
 * Exact origin comparison: one http(s) origin, no path/query/fragment, no
 * credentials, no comma-joined list, and byte-for-byte equality with the
 * resolved target (scheme and port included).
 */
export function isExactRequestOrigin(origin: string, targetOrigin: string): boolean {
  if (!origin || origin === 'null' || origin !== origin.trim()) return false;
  if (/[\s,]/.test(origin)) return false;
  if (!/^https?:\/\//.test(origin)) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
  return origin === targetOrigin;
}

export function checkProxyRequestOrigin(request: ProxyOriginRequest): ProxyOriginResult {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
    return { allowed: true, targetOrigin: null };
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    fetchSite !== null
    && !ALLOWED_FETCH_SITES.has(fetchSite.trim().toLowerCase())
  ) {
    return { allowed: false, reason: 'FETCH_SITE' };
  }

  const origin = request.headers.get('origin');
  if (origin === null) {
    return { allowed: true, targetOrigin: null };
  }

  const targetOrigin = resolveProxyTargetOrigin(request);
  if (!targetOrigin || !isExactRequestOrigin(origin, targetOrigin)) {
    return { allowed: false, reason: 'ORIGIN' };
  }
  return { allowed: true, targetOrigin };
}
