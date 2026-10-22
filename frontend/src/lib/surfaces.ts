/**
 * Browser-surface registry projection — docs/ecosystem/host-policy.md §6.
 *
 * The Java-side `identity.bff.surfaces[]` list is the authority; this file is
 * the build-time projection the Next edge uses to resolve which surface a
 * request Host belongs to (apex redirect, BFF session, or no-session). The
 * host map arrives as `NEXT_PUBLIC_SURFACE_HOSTS` JSON so a deployment can
 * repoint hosts without a code change. The static defaults mirror the
 * contract table so local dev works with no env.
 */

export type SurfaceMode = 'bff' | 'redirect' | 'none' | 'issuer';

export interface Surface {
  id: string;
  mode: SurfaceMode;
  /** Production host (apex → www redirect target, etc.). */
  host: string;
  /** Dev/preview host (*.localhost). */
  devHost: string;
  /** For mode `redirect`: the surface id requests are sent to. */
  redirectTo?: string;
}

/** Canonical surface table — keep in sync with host-policy.md §1. */
export const SURFACES: readonly Surface[] = [
  { id: 'apex', mode: 'redirect', host: 'campusute.io.vn', devHost: 'apex.localhost', redirectTo: 'portal' },
  { id: 'portal', mode: 'bff', host: 'www.campusute.io.vn', devHost: 'portal.localhost' },
  { id: 'learn', mode: 'bff', host: 'learn.campusute.io.vn', devHost: 'learn.localhost' },
  { id: 'apply', mode: 'bff', host: 'apply.campusute.io.vn', devHost: 'apply.localhost' },
  { id: 'news', mode: 'none', host: 'news.campusute.io.vn', devHost: 'news.localhost' },
  { id: 'docs', mode: 'none', host: 'docs.campusute.io.vn', devHost: 'docs.localhost' },
  { id: 'identity', mode: 'issuer', host: 'id.campusute.io.vn', devHost: 'id.localhost' },
];

interface HostMapEntry {
  surface: string;
  host: string;
  devHost?: string;
}

function envHostMap(): Map<string, string> | null {
  const raw = process.env.NEXT_PUBLIC_SURFACE_HOSTS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HostMapEntry[];
    const map = new Map<string, string>();
    for (const entry of parsed) {
      if (!entry || typeof entry.surface !== 'string' || typeof entry.host !== 'string') {
        return null;
      }
      map.set(entry.host.toLowerCase(), entry.surface);
      if (entry.devHost) map.set(entry.devHost.toLowerCase(), entry.surface);
    }
    return map;
  } catch {
    return null;
  }
}

const STATIC_HOST_MAP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const surface of SURFACES) {
    map.set(surface.host.toLowerCase(), surface.id);
    map.set(surface.devHost.toLowerCase(), surface.id);
  }
  return map;
})();

/** Strip a port suffix and lowercase — Host headers may carry :port. */
function normalizeHost(host: string | null | undefined): string {
  if (!host) return '';
  const bare = host.split(':')[0].trim().toLowerCase();
  return bare === 'localhost' ? '' : bare;
}

/** Resolve a request Host to a surface id, or null when unmapped. */
export function surfaceFromHost(host: string | null | undefined): Surface | null {
  const normalized = normalizeHost(host);
  if (!normalized) return null;
  const map = envHostMap() ?? STATIC_HOST_MAP;
  const id = map.get(normalized);
  return id ? SURFACES.find((s) => s.id === id) ?? null : null;
}

export function isKnownSurface(host: string | null | undefined): boolean {
  return surfaceFromHost(host) !== null;
}

/** Public base URL for a surface on the given scheme — no trailing slash. */
export function baseFor(surface: Surface | string, dev = false): string {
  const s = typeof surface === 'string'
    ? SURFACES.find((entry) => entry.id === surface)
    : surface;
  if (!s) throw new Error(`unknown surface ${String(surface)}`);
  const host = dev ? s.devHost : s.host;
  return `${dev ? 'http' : 'https'}://${host}`;
}

/**
 * Dev/preview base for a surface as seen through the serving edge: the
 * *.localhost surfaces share one dev server, so the port (and scheme) are
 * inherited from the incoming request — `apex.localhost:3102` must redirect
 * to `portal.localhost:3102` on the same scheme, not a bare default port.
 */
export function devBaseFor(
  surface: Surface | string,
  scheme: string,
  requestHost: string,
): string {
  const s = typeof surface === 'string'
    ? SURFACES.find((entry) => entry.id === surface)
    : surface;
  if (!s) throw new Error(`unknown surface ${String(surface)}`);
  const port = requestHost.split(':')[1];
  return `${scheme}://${s.devHost}${port ? `:${port}` : ''}`;
}
