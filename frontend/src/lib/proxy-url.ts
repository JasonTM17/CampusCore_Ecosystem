type JavaApiEnvironment = {
  [key: string]: string | undefined;
  JAVA_API_ORIGIN?: string;
  BACKEND_INTERNAL_ORIGIN?: string;
};

const DEFAULT_JAVA_API_ORIGIN = 'http://127.0.0.1:4010';

// A decoded segment must never be able to change the upstream path shape:
// `/` and `\` create extra segments, `?`/`#` start a query or fragment, and a
// NUL is rejected by several runtimes. Dot segments are rejected separately
// because the URL parser resolves them before the request leaves this process.
const FORBIDDEN_SEGMENT_CHARACTERS = /[/\\?#\u0000]/;
const MAX_DECODE_PASSES = 5;

export class InvalidProxyPathError extends Error {
  constructor(segment: string) {
    super(`Invalid proxy path segment: ${segment}`);
    this.name = 'InvalidProxyPathError';
  }
}

/**
 * Decode a route segment until it stops changing. Next decodes the routed
 * params once, so a double-encoded traversal still arrives as `%2e%2e` here.
 * Malformed escapes are left as literals — they are then percent-encoded on
 * the way upstream and cannot become a dot segment.
 */
function decodeSegment(segment: string): string {
  let decoded = segment;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return decoded;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function encodeProxyPathSegment(segment: string): string {
  const decoded = decodeSegment(segment);
  if (
    decoded === '.'
    || decoded === '..'
    || FORBIDDEN_SEGMENT_CHARACTERS.test(decoded)
  ) {
    throw new InvalidProxyPathError(segment);
  }
  // Encode the segment as received, not the decoded form: a literal `%20`
  // in an already-encoded name must stay distinguishable from a space.
  return encodeURIComponent(segment);
}

export function encodeProxyPathSegments(path: readonly string[]): string[] {
  return path.map(encodeProxyPathSegment);
}

export function resolveJavaApiOrigin(env: JavaApiEnvironment = process.env): string {
  const configuredOrigin = env.JAVA_API_ORIGIN?.trim() || env.BACKEND_INTERNAL_ORIGIN?.trim();
  return (configuredOrigin || DEFAULT_JAVA_API_ORIGIN).replace(/\/+$/, '');
}

export function buildApiProxyUrl(
  origin: string,
  path: readonly string[],
  search: string,
): URL {
  const normalizedOrigin = origin.replace(/\/$/, '');
  const encodedPath = encodeProxyPathSegments(path).join('/');
  const upstreamUrl = new URL(`${normalizedOrigin}/api/v1/${encodedPath}`);
  upstreamUrl.search = search;
  return upstreamUrl;
}
