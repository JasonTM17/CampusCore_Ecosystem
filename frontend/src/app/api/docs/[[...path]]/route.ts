import type { NextRequest } from 'next/server';

import {
  encodeProxyPathSegments,
  InvalidProxyPathError,
  resolveJavaApiOrigin,
} from '@/lib/proxy-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

// Credential carriers and caller-controlled forwarding metadata must not cross
// the edge into the Java docs endpoint. `accept`/`accept-language` stay so the
// generated documentation still negotiates its language and media type.
const STRIPPED_HEADERS = new Set([
  'cookie',
  'cookie2',
  'authorization',
  'proxy-authorization',
  'forwarded',
  'x-real-ip',
  'x-csrf-token',
  'x-xsrf-token',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-session-id',
  'x-session-token',
  'x-health-key',
]);

function stripCredentialHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    const lower = name.toLowerCase();
    if (
      STRIPPED_HEADERS.has(lower)
      || lower.startsWith('x-forwarded-')
      || lower.startsWith('x-vercel-')
      || lower.startsWith('x-campuscore-')
    ) {
      headers.delete(name);
    }
  }
}

function invalidPath(): Response {
  return new Response(JSON.stringify({ error: 'INVALID_DOCS_PATH' }), {
    status: 400,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function handle(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;

  // Reject dot segments and separators before the path can be resolved by the
  // URL parser — `%2e%2e`, `%2E.`, `%252e%252e` and friends all normalize to a
  // traversal once decoded.
  let encodedPath: string[];
  try {
    encodedPath = encodeProxyPathSegments(path);
  } catch (error) {
    if (error instanceof InvalidProxyPathError
      || (error instanceof Error && error.name === 'InvalidProxyPathError')) {
      return invalidPath();
    }
    throw error;
  }

  const origin = resolveJavaApiOrigin();
  const suffix = encodedPath.length > 0 ? `/${encodedPath.join('/')}` : '';
  const backendPath = path.length === 1 && path[0] === 'openapi.json'
    ? '/v3/api-docs'
    : `/v3/api-docs${suffix}`;

  const headers = new Headers(request.headers);
  headers.delete('host');
  stripCredentialHeaders(headers);
  headers.set('accept-encoding', 'identity');

  const response = await fetch(`${origin}${backendPath}`, {
    method: request.method,
    headers,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('transfer-encoding');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('connection');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const HEAD = handle;
