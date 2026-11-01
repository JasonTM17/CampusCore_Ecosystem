type JavaApiEnvironment = {
  [key: string]: string | undefined;
  JAVA_API_ORIGIN?: string;
  BACKEND_INTERNAL_ORIGIN?: string;
};

const DEFAULT_JAVA_API_ORIGIN = 'http://127.0.0.1:4010';

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
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  const upstreamUrl = new URL(`${normalizedOrigin}/api/v1/${encodedPath}`);
  upstreamUrl.search = search;
  return upstreamUrl;
}
