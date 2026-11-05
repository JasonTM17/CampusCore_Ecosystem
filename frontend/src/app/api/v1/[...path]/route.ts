import type { NextRequest } from 'next/server';

import {
  buildApiProxyUrl,
  encodeProxyPathSegments,
  InvalidProxyPathError,
  resolveJavaApiOrigin,
} from '@/lib/proxy-url';
import { checkProxyRequestOrigin } from '@/lib/proxy-request-origin';
import { buildProxyRequestHeaders } from '@/lib/proxy-request-headers';
import { surfaceFromHost } from '@/lib/surfaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

// Truly public GET endpoints whose payload is identical for every caller may
// carry a short shared cache window; authenticated/private responses must
// never gain a cache directive here.
const PUBLIC_GET_PATHS = new Set(['site-appearance', 'article-taxonomy/v2/categories']);

function rejected(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

// Mirrors JsonBodyCapFilter and spring.servlet.multipart.max-request-size so
// the edge refuses an oversized body before allocating it. The tightest
// applicable ceiling wins, exactly as it does in the Java filter.
const BODY_CAP_JSON_AUTH = 4 * 1024;
const BODY_CAP_JSON_ASSISTANT = 64 * 1024;
const BODY_CAP_JSON = 1024 * 1024;
const BODY_CAP_UPLOAD = 21 * 1024 * 1024;
const BODY_CAP_AUTH_PATHS = new Set([
  'auth/login',
  'auth/refresh',
  'auth/change-password',
  'auth/forgot-password',
  'auth/reset-password',
  'auth/logout',
]);

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the accepted size');
    this.name = 'RequestBodyTooLargeError';
  }
}

function bodyCapFor(path: readonly string[], contentType: string | null): number {
  const type = (contentType ?? '').toLowerCase();
  if (type.startsWith('multipart/form-data')) return BODY_CAP_UPLOAD;
  if (!type.includes('application/json')) return BODY_CAP_UPLOAD;
  const route = (path[0] === 'v1' ? path.slice(1) : path).join('/');
  if (BODY_CAP_AUTH_PATHS.has(route)) return BODY_CAP_JSON_AUTH;
  if (route.startsWith('assistant/') || route.startsWith('thesis/assistant/')) {
    return BODY_CAP_JSON_ASSISTANT;
  }
  return BODY_CAP_JSON;
}

async function readRequestBody(request: NextRequest, cap: number): Promise<ArrayBuffer> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > cap) throw new RequestBodyTooLargeError();
  }

  const stream = request.body;
  if (!stream) {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > cap) throw new RequestBodyTooLargeError();
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const origin = resolveJavaApiOrigin();

  // BFF lane (docs/ecosystem/host-policy.md §5): on a BFF surface host the
  // browser's opaque __Host-cu_session rides the cookie header as usual, but
  // the request must land on /bff/api/** so the Java BFF resolves the
  // surface, refreshes the server-side grant, and injects the bearer token.
  // Every caller-stamped x-campuscore-* is stripped before the edge pair is
  // set — the proxy token authenticates the pair to the BFF chain.
  const surface = surfaceFromHost(request.headers.get('host'));
  const bffLane = surface?.mode === 'bff'
    && process.env.NEXT_PUBLIC_BFF_LANE !== 'false';

  // /bff/api/<suffix> maps to /api/v1<suffix> on the Java side — the v1
  // prefix lives in the Java mapping, so the leading v1 segment of the
  // public path is dropped here instead of doubled upstream.
  const bffSuffix = path[0] === 'v1' ? path.slice(1) : path;

  // Every segment is validated (dot segments, separators, query/fragment
  // markers) and encoded before it can reach either upstream path. A crafted
  // segment must not be able to escape the prefix or inject a query.
  let upstreamUrl: string | URL;
  try {
    upstreamUrl = bffLane
      ? `${origin}/bff/api/${encodeProxyPathSegments(bffSuffix).join('/')}${request.nextUrl.search}`
      : buildApiProxyUrl(origin, path, request.nextUrl.search);
  } catch (error) {
    if (error instanceof InvalidProxyPathError
      || (error instanceof Error && error.name === 'InvalidProxyPathError')) {
      return rejected(400, { error: 'INVALID_PROXY_PATH' });
    }
    throw error;
  }

  // Origin guard: mutating methods only, before any body buffering or
  // upstream fetch. Headerless server/native callers stay compatible; the
  // Java BFF's authentication and CSRF checks still run upstream.
  if (request.headers.has('origin') || request.headers.has('sec-fetch-site')) {
    const originCheck = checkProxyRequestOrigin(request);
    if (!originCheck.allowed) {
      return rejected(403, {
        error: 'REQUEST_ORIGIN_REJECTED',
        reason: originCheck.reason,
      });
    }
  }

  const headers = buildProxyRequestHeaders(request);

  if (bffLane) {
    headers.set('x-campuscore-surface', surface.id);
    headers.set(
      'x-campuscore-scheme',
      request.nextUrl.protocol.replace(':', ''),
    );
    headers.set('x-campuscore-host', request.headers.get('host') ?? '');
  }

  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    try {
      body = await readRequestBody(
        request,
        bodyCapFor(path, request.headers.get('content-type')),
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return rejected(413, { error: 'REQUEST_BODY_TOO_LARGE' });
      }
      throw error;
    }
  }

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
    signal: request.signal,
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('transfer-encoding');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('connection');

  const publicGet = request.method === 'GET' && PUBLIC_GET_PATHS.has(path.join('/'));
  if (publicGet) {
    const upstreamCacheControl = response.headers.get('cache-control');
    responseHeaders.set(
      'Cache-Control',
      upstreamCacheControl || 'public, max-age=300, stale-while-revalidate=600',
    );
  } else {
    // Authenticated/private API traffic must never be stored by a browser or
    // shared cache, even when upstream omits the directive.
    responseHeaders.set('Cache-Control', 'no-store');
  }

  // The BFF lane must never hand an upstream Set-Cookie to the browser
  // (contract §5): the opaque session is the only cookie this lane owns.
  if (!bffLane && typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      responseHeaders.delete('set-cookie');
      for (const cookie of cookies) {
        responseHeaders.append('set-cookie', cookie);
      }
    }
  }

  // Fetch forbids even an empty ArrayBuffer for these statuses. In particular,
  // a missing thesis report is a legitimate 204, not a proxy server error.
  if (request.method === 'HEAD' || [204, 205, 304].includes(response.status)) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

  // SSE must reach the caller before upstream EOF: buffering hides every
  // delta and heartbeat until the complete answer has been generated.
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream') {
    responseHeaders.set('Cache-Control', 'no-store, no-transform');
    responseHeaders.set('X-Accel-Buffering', 'no');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

  // Buffer non-streaming responses instead of piping `response.body`. Streaming the
  // body made the platform flush the outgoing headers from a different task
  // than the one that appended `set-cookie`, and on Vercel's Node runtime the
  // session cookies were dropped intermittently: the login POST answered 200
  // with no Set-Cookie, so the very next page load redirected the user to
  // /login?reason=session-expired (production repro 4/5 runs, fixed by this
  // buffering — response bodies here are JSON-sized, so memory is a non-issue).
  const bodyBuffer = await response.arrayBuffer();

  return new Response(bodyBuffer, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
