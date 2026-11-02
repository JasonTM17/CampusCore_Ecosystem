import type { NextRequest } from 'next/server';

import { resolveJavaApiOrigin } from '@/lib/proxy-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const origin = resolveJavaApiOrigin();
  try {
    return await fetch(`${origin}/api/v1/health/liveness`, {
      headers: {
        Accept: 'application/json',
        'X-Request-Id': request.headers.get('x-request-id') || 'web-health',
      },
      cache: 'no-store',
    });
  } catch {
    // Unreachable Java is an availability signal, not a proxy crash: answer a
    // structured 503 that probes can classify without a stack trace.
    return new Response(JSON.stringify({ status: 'unavailable' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
}

export const HEAD = GET;
