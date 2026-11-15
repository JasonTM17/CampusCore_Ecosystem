import type { NextRequest } from 'next/server';

import {
  encodeProxyPathSegments,
  InvalidProxyPathError,
  resolveBursarApiOrigin,
} from '@/lib/proxy-url';
import { checkProxyRequestOrigin } from '@/lib/proxy-request-origin';
import { buildProxyRequestHeaders } from '@/lib/proxy-request-headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function rejected(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

const BODY_CAP_JSON = 1024 * 1024;

async function readRequestBody(request: NextRequest, cap: number): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    throw new Error('REQUEST_BODY_TOO_LARGE');
  }
  const reader = request.body?.getReader();
  if (!reader) {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > cap) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    return buffer;
  }
  // Stream-and-cap: abort as soon as the cap is exceeded so oversized
  // payloads never sit fully buffered in the web process.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer.buffer;
}

/**
 * Same-origin browser proxy for the dedicated bursar (tuition) service.
 * `/api/bursar/<suffix>` maps to `BURSAR_API_ORIGIN/api/v1/me/bursar/<suffix>`
 * so the student's Bearer session is forwarded unchanged while the service
 * stays reachable even though the /api/v1 proxy lands on the SIS core.
 */
async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const origin = resolveBursarApiOrigin();

  let upstreamUrl: string;
  try {
    upstreamUrl = `${origin}/api/v1/me/bursar/${encodeProxyPathSegments(path).join('/')}${request.nextUrl.search}`;
  } catch (error) {
    if (error instanceof InvalidProxyPathError
      || (error instanceof Error && error.name === 'InvalidProxyPathError')) {
      return rejected(400, { error: 'INVALID_PROXY_PATH' });
    }
    throw error;
  }

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

  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    try {
      body = await readRequestBody(request, BODY_CAP_JSON);
    } catch {
      return rejected(413, { error: 'REQUEST_BODY_TOO_LARGE' });
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
  responseHeaders.set('Cache-Control', 'no-store');

  if (request.method === 'HEAD' || [204, 205, 304].includes(response.status)) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

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
