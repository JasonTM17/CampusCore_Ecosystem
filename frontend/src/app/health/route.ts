import type { NextRequest } from 'next/server';

import { resolveJavaApiOrigin } from '@/lib/proxy-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const origin = resolveJavaApiOrigin();
  return fetch(`${origin}/api/v1/health/liveness`, {
    headers: {
      Accept: 'application/json',
      'X-Request-Id': request.headers.get('x-request-id') || 'web-health',
    },
    cache: 'no-store',
  });
}

export const HEAD = GET;
