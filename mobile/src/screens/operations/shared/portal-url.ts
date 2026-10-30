// Web hand-off targets. Pure so the URL rules run under `node --test`.

export const DEFAULT_PORTAL_URL = 'https://portal.localhost:3102';

/**
 * Same-path hand-off: the portal route that owns the work the app does not
 * (contracts/ecosystem/mobile-parity.json, handoff `web-same-path`). Only a
 * fixed app path joins the configured base, so no user data can reach the URL;
 * anything that is not an absolute path without traversal or a query falls
 * back to the portal root.
 */
export function portalUrl(path: string, base: string = DEFAULT_PORTAL_URL): string {
  const root = base.replace(/\/+$/, '');
  const safe = /^\/[A-Za-z0-9/_-]*$/.test(path) && !path.includes('//') ? path : '/';
  return safe === '/' ? root : `${root}${safe}`;
}
