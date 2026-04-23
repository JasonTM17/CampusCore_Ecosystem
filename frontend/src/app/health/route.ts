import type { NextRequest } from 'next/server';
import { proxyToLocalEdge } from '@/lib/local-edge-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  return proxyToLocalEdge(request, '/health');
}

export const HEAD = GET;
