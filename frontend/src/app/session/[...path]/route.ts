import type { NextRequest } from 'next/server';

import { surfaceFromHost } from '@/lib/surfaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

// Only these segments may reach the Java BFF session layer — the route is
// an allowlist, not a pass-through (docs/ecosystem/host-policy.md §3/§6).
// `logged-out` is intentionally absent: a Next page owns that path.
const ALLOWED_SEGMENTS = new Set(['login', 'callback', 'state', 'logout']);

function upstreamOrigin(): string {
  return (process.env.JAVA_API_ORIGIN ||
    process.env.BACKEND_INTERNAL_ORIGIN ||
    (process.env.NODE_ENV === 'production' ? 'https://campuscore-backend-p4em.onrender.com' : 'http://127.0.0.1:4010')).replace(/\/$/, '');
}

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const joined = path.join('/');

  if (path.length !== 1 || !ALLOWED_SEGMENTS.has(joined)) {
    return new Response(JSON.stringify({ error: 'SESSION_PATH_UNKNOWN' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const surface = surfaceFromHost(request.headers.get('host'));
  if (!surface || surface.mode !== 'bff') {
    return new Response(JSON.stringify({ error: 'SURFACE_UNKNOWN' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('accept-encoding', 'identity');
  // Edge-owns-routing: strip every caller-stamped campuscore header, then
  // stamp the resolved surface pair plus the shared proxy token.
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith('x-campuscore-')) {
      headers.delete(name);
    }
  }
  headers.set('x-campuscore-surface', surface.id);
  headers.set(
    'x-campuscore-scheme',
    request.nextUrl.protocol.replace(':', ''),
  );
  headers.set('x-campuscore-host', request.headers.get('host') ?? '');
  const proxyToken = process.env.CAMPUSCORE_PROXY_TOKEN;
  if (proxyToken) {
    headers.set('x-campuscore-proxy-token', proxyToken);
  }

  const url = `${upstreamOrigin()}/session/${joined}${request.nextUrl.search}`;
  const response = await fetch(url, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
    signal: request.signal,
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('transfer-encoding');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('connection');
  // Session endpoints are never cacheable; enforce even if upstream forgets.
  responseHeaders.set('Cache-Control', 'no-store');
  // The tx cookie and __Host-cu_session must reach the browser verbatim —
  // they are already host-only by construction (no Domain attribute).
  if (typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      responseHeaders.delete('set-cookie');
      for (const cookie of cookies) {
        responseHeaders.append('set-cookie', cookie);
      }
    }
  }

  const body = await response.arrayBuffer();
  return new Response(body.byteLength ? body : null, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
