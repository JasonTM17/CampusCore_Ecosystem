const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Accept only a path that stays inside this portal: one leading slash, no
 * protocol-relative or backslash forms, no whitespace/control characters, and
 * no encoded slash/backslash escape at the start. Returns the trimmed path or
 * null when the value is not a safe internal destination.
 */
export function safeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/')) return null;
  if (path.startsWith('//')) return null;
  if (path.includes('\\')) return null;
  if (path.includes('://')) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(path)) return null;
  const lower = path.toLowerCase();
  if (lower.startsWith('/%2f') || lower.startsWith('/%5c')) return null;
  return path;
}

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
