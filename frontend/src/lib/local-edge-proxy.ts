import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getLocalEdgeOrigin, isLocalPreviewHost } from '@/lib/site';

const FORWARDED_PROTOCOL_HEADER = 'x-forwarded-proto';
const FORWARDED_HOST_HEADER = 'x-forwarded-host';

function shouldProxy(request: NextRequest) {
  return (
    process.env.ENABLE_LOCAL_EDGE_REWRITES === '1' ||
    isLocalPreviewHost(request.nextUrl.hostname)
  );
}

function copyRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  headers.set(FORWARDED_PROTOCOL_HEADER, request.nextUrl.protocol.replace(':', ''));
  headers.set(FORWARDED_HOST_HEADER, request.headers.get('host') ?? request.nextUrl.host);
  return headers;
}

export async function proxyToLocalEdge(
  request: NextRequest,
  targetPath: string,
) {
  if (!shouldProxy(request)) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404 });
  }

  const targetUrl = new URL(targetPath, `${getLocalEdgeOrigin()}/`);
  targetUrl.search = request.nextUrl.search;

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: copyRequestHeaders(request),
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer(),
    cache: 'no-store',
    redirect: 'manual',
  });

  const location = upstream.headers.get('location');
  if (location && upstream.status >= 300 && upstream.status < 400) {
    return NextResponse.redirect(new URL(location, request.nextUrl), {
      status: upstream.status,
    });
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-length');

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
