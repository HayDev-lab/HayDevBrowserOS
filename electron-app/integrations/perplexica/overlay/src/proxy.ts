import { NextRequest, NextResponse } from 'next/server';

const internalOrigins = new Set(['pab://search', 'pab://newtab',
  'http://pab.search', 'http://pab.newtab', 'http://pab.localhost']);

// Loopback is not an authorization boundary for a browser: remote documents
// can send requests to it. Validate the actual Host and caller before any API.
export function proxy(request: NextRequest) {
  let local: URL;
  try { local = new URL(`http://${request.headers.get('host') || ''}`); }
  catch { return NextResponse.json({ error: 'HOST_DENIED' }, { status: 403 }); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname) || local.username || local.password) {
    return NextResponse.json({ error: 'HOST_DENIED' }, { status: 403 });
  }
  const origin = request.headers.get('origin');
  const ownOrigin = local.origin;
  if ((origin && origin !== ownOrigin && !internalOrigins.has(origin)) ||
      (!origin && request.headers.get('sec-fetch-site') === 'cross-site')) {
    return NextResponse.json({ error: 'ORIGIN_DENIED' }, { status: 403 });
  }
  if (origin && internalOrigins.has(origin)) {
    const method = request.method === 'OPTIONS'
      ? request.headers.get('access-control-request-method')
      : request.method;
    const path = request.nextUrl.pathname;
    if (!((path === '/api/providers' && method === 'GET') || (path === '/api/search' && method === 'POST'))) {
      return NextResponse.json({ error: 'API_DENIED' }, { status: 403 });
    }
  }
  const response = request.method === 'OPTIONS' ? new NextResponse(null, { status: 204 }) : NextResponse.next();
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', internalOrigins.has(origin) ? 'GET,POST,OPTIONS' : 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'content-type');
  }
  return response;
}
export const config = { matcher: ['/api/:path*'] };
