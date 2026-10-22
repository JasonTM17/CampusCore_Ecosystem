// Shared observability contract for browser transports (P03).
// Pure module: no axios/fetch/React dependency so it can back any transport.

export const REQUEST_ID_HEADER = 'X-Request-Id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export interface ApiMetric {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId: string | null;
  at: number;
}

const METRIC_RING_LIMIT = 100;
const metricRing: ApiMetric[] = [];
const listeners = new Set<(metric: ApiMetric) => void>();

export function recordApiMetric(metric: ApiMetric): void {
  metricRing.push(metric);
  if (metricRing.length > METRIC_RING_LIMIT) {
    metricRing.splice(0, metricRing.length - METRIC_RING_LIMIT);
  }
  listeners.forEach((listener) => {
    try {
      listener(metric);
    } catch {
      // A broken observer must never break the request path.
    }
  });
}

export function apiMetricsSnapshot(): readonly ApiMetric[] {
  return metricRing.slice();
}

export function subscribeApiMetrics(listener: (metric: ApiMetric) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Strips credential-bearing material before anything reaches a log/console.
export function redactForLog(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/([?&](?:access_token|refresh_token|token|password|secret)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(cookie|authorization|set-cookie)"\s*:\s*"[^"]*"/gi, '$1":"<redacted>"')
    .replace(/(cookie|authorization|set-cookie)'\s*:\s*'[^']*'/gi, "$1':'<redacted>'");
}

export function pathOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url.split('?')[0] ?? '';
  }
}

// Path segments that look like resource ids collapse to `{id}` so metric
// cardinality stays bounded and no entity id lands in the metric ring.
const IDISH_SEGMENT =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d+|[0-9a-fA-F]{16,})$/;

export function pathTemplate(url: string | undefined): string {
  return pathOf(url)
    .split('/')
    .map((segment) => (IDISH_SEGMENT.test(segment) ? '{id}' : segment))
    .join('/');
}
