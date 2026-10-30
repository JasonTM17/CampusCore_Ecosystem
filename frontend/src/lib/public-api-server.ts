import { getSiteUrl } from '@/lib/site';
import { resolvePublicApiBaseUrl } from '@/lib/public-api-url';

export function buildPublicApiUrl(
  apiBaseUrl: string,
  siteUrl: string,
  pathSegments: readonly string[],
  params?: Readonly<Record<string, string>>,
) {
  const encodedPath = pathSegments.map((segment) => {
    // URL normalizes dot-only segments even when encodeURIComponent is used.
    if (segment === '.' || segment === '..') {
      throw new TypeError('Invalid public API path segment');
    }
    return encodeURIComponent(segment);
  }).join('/');
  const baseUrl = new URL(apiBaseUrl, siteUrl);
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new TypeError('Invalid public API base URL');
  }

  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  const url = new URL(`${baseUrl.origin}${basePath}/${encodedPath}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function fetchPublicApiJson(
  pathSegments: readonly string[],
  params?: Readonly<Record<string, string>>,
) {
  try {
    const siteUrl = getSiteUrl();
    const apiBaseUrl = resolvePublicApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
    const url = buildPublicApiUrl(apiBaseUrl, siteUrl, pathSegments, params);
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  }
}
