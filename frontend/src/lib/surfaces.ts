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

interface SurfaceRegistry {
  hostMap: Map<string, string>;
  surfaces: Map<string, Surface>;
}

const STATIC_SURFACE_REGISTRY: SurfaceRegistry = (() => {
  const hostMap = new Map<string, string>();
  const surfaces = new Map<string, Surface>();
  for (const surface of SURFACES) {
    surfaces.set(surface.id, surface);
    hostMap.set(surface.host.toLowerCase(), surface.id);
    hostMap.set(surface.devHost.toLowerCase(), surface.id);
  }
  return { hostMap, surfaces };
})();

function envHostOverrides(): HostMapEntry[] | null {
  const raw = process.env.NEXT_PUBLIC_SURFACE_HOSTS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HostMapEntry[];
    if (!Array.isArray(parsed)) return null;
    for (const entry of parsed) {
      if (
        !entry
        || typeof entry.surface !== 'string'
        || typeof entry.host !== 'string'
        || (entry.devHost !== undefined && typeof entry.devHost !== 'string')
      ) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function effectiveSurfaceRegistry(): SurfaceRegistry {
  const overrides = envHostOverrides();
  if (!overrides) return STATIC_SURFACE_REGISTRY;

  const registry: SurfaceRegistry = {
    hostMap: new Map(STATIC_SURFACE_REGISTRY.hostMap),
    surfaces: new Map(STATIC_SURFACE_REGISTRY.surfaces),
  };
  for (const entry of overrides) {
    registry.hostMap.set(entry.host.toLowerCase(), entry.surface);
    if (entry.devHost) registry.hostMap.set(entry.devHost.toLowerCase(), entry.surface);

    const surface = registry.surfaces.get(entry.surface);
    if (surface) {
      registry.surfaces.set(entry.surface, {
        ...surface,
        host: entry.host,
        devHost: entry.devHost || surface.devHost,
      });
    }
  }
  return registry;
}

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
  const registry = effectiveSurfaceRegistry();
  const id = registry.hostMap.get(normalized);
  return id ? registry.surfaces.get(id) ?? null : null;
}

export function isKnownSurface(host: string | null | undefined): boolean {
  return surfaceFromHost(host) !== null;
}

/** Public base URL for a surface on the given scheme — no trailing slash. */
export function baseFor(surface: Surface | string, dev = false): string {
  const s = resolveSurface(surface);
  const host = dev ? s.devHost : s.host;
  return `${dev ? 'http' : 'https'}://${host}`;
}

function resolveSurface(surface: Surface | string): Surface {
  const id = typeof surface === 'string' ? surface : surface.id;
  const configured = effectiveSurfaceRegistry().surfaces.get(id);
  const resolved = configured ?? (typeof surface === 'string' ? undefined : surface);
  if (!resolved) throw new Error(`unknown surface ${String(surface)}`);
  return resolved;
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
  const s = resolveSurface(surface);
  const port = requestHost.split(':')[1];
  return `${scheme}://${s.devHost}${port ? `:${port}` : ''}`;
}
