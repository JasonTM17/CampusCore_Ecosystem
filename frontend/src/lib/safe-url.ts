const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * True only for an absolute http(s) URL. Server-provided artifacts (report
 * links, redirects) must pass this before reaching `href`; the URL parser
 * strips whitespace and control characters the browser would also ignore.
 */
export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return HTTP_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
