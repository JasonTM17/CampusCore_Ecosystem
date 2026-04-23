import type { NextRequest } from 'next/server';
import { proxyToLocalEdge } from '@/lib/local-edge-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

async function handle(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  const suffix = path.length > 0 ? `/${path.join('/')}` : '';
  return proxyToLocalEdge(request, `/api/docs${suffix}`);
}

export const GET = handle;
export const HEAD = handle;
