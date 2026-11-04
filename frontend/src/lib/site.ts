const DEFAULT_SITE_URL = 'http://localhost:3000';

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return normalizeUrl(configuredUrl || DEFAULT_SITE_URL);
}

export function buildSiteUrl(path = '/') {
  return new URL(path, `${getSiteUrl()}/`).toString();
}

