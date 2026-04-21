const DEFAULT_SITE_URL = 'https://tienson.io.vn';
const DEFAULT_LOCAL_EDGE_ORIGIN = 'http://127.0.0.1:8080';

function normalizeUrl(value: string) {
  return value.replace(/\/$/, '');
}

export function getSiteUrl() {
  return normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL);
}

export function getLocalEdgeOrigin() {
  return normalizeUrl(
    process.env.LOCAL_EDGE_ORIGIN || DEFAULT_LOCAL_EDGE_ORIGIN,
  );
}

export function buildSiteUrl(path = '/') {
  return new URL(path, `${getSiteUrl()}/`).toString();
}

export function isLocalPreviewHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}
