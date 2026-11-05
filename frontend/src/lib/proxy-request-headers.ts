import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';

const trustEdgeHeaders = process.env.CAMPUSCORE_TRUST_EDGE_HEADERS === 'true';
const proxyToken = process.env.CAMPUSCORE_PROXY_TOKEN?.trim() ?? '';

if (trustEdgeHeaders && (proxyToken.length < 32
  || proxyToken === 'sso-preview-proxy-token-0123456789')) {
  throw new Error('CAMPUSCORE_TRUST_EDGE_HEADERS=true requires CAMPUSCORE_PROXY_TOKEN with at least 32 characters and an unpublished value');
}

export function buildProxyRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  for (const name of [
    'host', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
    'x-forwarded-port', 'forwarded', 'x-real-ip', 'x-vercel-forwarded-for',
    'x-campuscore-proxy-token', 'x-campuscore-client-ip',
  ]) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('x-campuscore-')) headers.delete(name);
  }
  headers.set('accept-encoding', 'identity');

  let clientIp: string;
  if (trustEdgeHeaders) {
    // The private ingress must overwrite or append its observed peer last.
    // The token authenticates this proxy to Java, not the caller to Next.
    const candidate = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
    clientIp = isIP(candidate) ? candidate : 'web-proxy';
  } else {
    clientIp = (request as NextRequest & { ip?: string }).ip
      || (process.env.VERCEL === '1'
        ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : undefined)
      || 'web-proxy';
  }
  headers.set('x-forwarded-for', clientIp);
  if (proxyToken) {
    headers.set('x-campuscore-proxy-token', proxyToken);
    headers.set('x-campuscore-client-ip', clientIp);
  }
  return headers;
}
