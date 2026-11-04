const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadApiStack,
  makeRequest,
  contextFor,
  createFetch,
} = require('./proxy-route-harness');

const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function okResponse(body = '{"ok":true}', headers = { 'content-type': 'application/json' }) {
  return new Response(body, { headers });
}

async function invoke(route, method, request, path = ['admin', 'users']) {
  return route[method](request, contextFor(path));
}

test('every unsafe verb rejects cross-site, same-site, none and unknown fetch metadata before any fetch', async () => {
  for (const method of UNSAFE_METHODS) {
    for (const site of ['cross-site', 'same-site', 'none', 'unexpected-value']) {
      const { fetch, calls } = createFetch();
      const { route } = loadApiStack(fetch);
      const response = await invoke(route, method, makeRequest({
        method,
        host: 'localhost:3000',
        headers: {
          origin: 'http://localhost:3000',
          'sec-fetch-site': site,
        },
      }));
      assert.equal(response.status, 403, `${method} ${site}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(calls.length, 0, `${method} ${site} must not reach upstream`);
    }
  }
});

test('foreign, null, malformed and multiple origins are rejected before any fetch', async () => {
  const cases = [
    ['foreign origin', 'https://evil.example'],
    ['null origin', 'null'],
    ['scheme-less origin', 'localhost:3000'],
    ['origin with a path', 'http://localhost:3000/path'],
    ['origin with credentials', 'http://user:pass@localhost:3000'],
    ['empty origin', ''],
    ['multiple origins', ['http://localhost:3000', 'https://evil.example']],
  ];

  for (const [label, origin] of cases) {
    const { fetch, calls } = createFetch();
    const { route } = loadApiStack(fetch);
    const response = await invoke(route, 'POST', makeRequest({
      method: 'POST',
      headers: { origin, 'sec-fetch-site': 'same-origin' },
    }));
    assert.equal(response.status, 403, label);
    assert.equal(calls.length, 0, `${label} must not reach upstream`);
  }
});

test('sibling origins fail even when they are same-site; the exact serving origin passes', async () => {
  const sibling = createFetch();
  const siblingStack = loadApiStack(sibling.fetch);
  const denied = await invoke(
    siblingStack.route,
    'POST',
    makeRequest({
      method: 'POST',
      host: 'localhost:3000',
      headers: { origin: 'http://localhost:3102', 'sec-fetch-site': 'same-site' },
    }),
  );
  assert.equal(denied.status, 403);
  assert.equal(sibling.calls.length, 0);

  const own = createFetch();
  const ownStack = loadApiStack(own.fetch);
  const allowed = await invoke(
    ownStack.route,
    'POST',
    makeRequest({
      method: 'POST',
      host: 'localhost:3102',
      headers: { origin: 'http://localhost:3102', 'sec-fetch-site': 'same-origin' },
    }),
  );
  assert.equal(allowed.status, 200);
  assert.equal(own.calls.length, 1);
  assert.equal(own.calls[0].url, 'http://java.test/api/v1/admin/users');

  const surface = createFetch();
  const surfaceStack = loadApiStack(surface.fetch);
  const surfaceAllowed = await invoke(
    surfaceStack.route,
    'POST',
    makeRequest({
      method: 'POST',
      host: 'portal.localhost:3102',
      protocol: 'https:',
      headers: {
        origin: 'https://portal.localhost:3102',
        'sec-fetch-site': 'same-origin',
      },
    }),
  );
  assert.equal(surfaceAllowed.status, 200);
  assert.equal(surface.calls.length, 1);

  for (const [host, origin] of [
    ['portal.localhost:3102', 'https://learn.localhost:3102'],
    ['portal.localhost:3102', 'http://portal.localhost:3102'],
    ['unknown.example', 'http://unknown.example'],
  ]) {
    const { fetch, calls } = createFetch();
    const { route } = loadApiStack(fetch);
    const response = await invoke(route, 'POST', makeRequest({
      method: 'POST',
      host,
      protocol: host.startsWith('portal') ? 'https:' : 'http:',
      headers: { origin, 'sec-fetch-site': 'same-origin' },
    }));
    assert.equal(response.status, 403, origin);
    assert.equal(calls.length, 0, origin);
  }
});

test('configured production surface hosts resolve to their canonical https origin', async () => {
  for (const [origin, expected] of [
    ['https://www.campusute.io.vn', 200],
    ['http://www.campusute.io.vn', 403],
  ]) {
    const { fetch, calls } = createFetch();
    const { route } = loadApiStack(fetch);
    const response = await invoke(route, 'POST', makeRequest({
      method: 'POST',
      host: 'www.campusute.io.vn',
      protocol: 'http:',
      headers: { origin, 'sec-fetch-site': 'same-origin' },
    }));
    assert.equal(response.status, expected, origin);
    assert.equal(calls.length, expected === 200 ? 1 : 0, origin);
  }
});

test('headerless and partial-metadata callers keep working for server and native clients', async () => {
  const allowedCases = [
    ['no metadata at all', {}],
    ['same-origin only', { 'sec-fetch-site': 'same-origin' }],
    ['exact origin only', { origin: 'http://localhost:3000' }],
    ['exact origin plus same-origin', { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }],
  ];

  for (const [label, headers] of allowedCases) {
    const { fetch, calls } = createFetch();
    const { route } = loadApiStack(fetch);
    const response = await invoke(route, 'POST', makeRequest({ method: 'POST', headers }));
    assert.equal(response.status, 200, label);
    assert.equal(calls.length, 1, label);
  }

  for (const site of ['cross-site', 'same-site', 'none']) {
    const { fetch, calls } = createFetch();
    const { route } = loadApiStack(fetch);
    const response = await invoke(route, 'POST', makeRequest({
      method: 'POST',
      headers: { 'sec-fetch-site': site },
    }));
    assert.equal(response.status, 403, site);
    assert.equal(calls.length, 0, site);
  }
});

test('GET, HEAD and OPTIONS are not subject to the origin guard', async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const { fetch, calls } = createFetch();
    const { route } = loadApiStack(fetch);
    const response = await invoke(route, method, makeRequest({
      method,
      headers: {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
    }));
    assert.equal(response.status, 200, method);
    assert.equal(calls.length, 1, method);
  }
});

test('spoofed forwarded host and proto cannot widen the validated target', async () => {
  const denied = createFetch();
  const deniedStack = loadApiStack(denied.fetch);
  const response = await invoke(deniedStack.route, 'POST', makeRequest({
    method: 'POST',
    host: 'localhost:3000',
    headers: {
      origin: 'http://localhost:3102',
      'x-forwarded-host': 'localhost:3102',
      'x-forwarded-proto': 'https',
      'x-forwarded-port': '3102',
    },
  }));
  assert.equal(response.status, 403);
  assert.equal(denied.calls.length, 0);

  const allowed = createFetch();
  const allowedStack = loadApiStack(allowed.fetch);
  const forwarded = await invoke(allowedStack.route, 'POST', makeRequest({
    method: 'POST',
    host: 'localhost:3000',
    headers: {
      origin: 'http://localhost:3000',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    },
  }));
  assert.equal(forwarded.status, 200);
  assert.equal(allowed.calls.length, 1);
  assert.match(allowed.calls[0].url, /^http:\/\/java\.test\/api\/v1\//);
});

test('the BFF lane uses the same guard and a sibling surface cannot mutate it', async () => {
  const allowed = createFetch();
  const allowedStack = loadApiStack(allowed.fetch);
  const response = await invoke(allowedStack.route, 'POST', makeRequest({
    method: 'POST',
    host: 'portal.localhost:3102',
    protocol: 'https:',
    search: '?page=2',
    headers: {
      origin: 'https://portal.localhost:3102',
      'sec-fetch-site': 'same-origin',
    },
  }), ['admin', 'users']);
  assert.equal(response.status, 200);
  assert.equal(allowed.calls[0].url, 'http://java.test/bff/api/admin/users?page=2');

  const denied = createFetch();
  const deniedStack = loadApiStack(denied.fetch);
  const sibling = await invoke(deniedStack.route, 'PATCH', makeRequest({
    method: 'PATCH',
    host: 'portal.localhost:3102',
    protocol: 'https:',
    headers: {
      origin: 'https://learn.localhost:3102',
      'sec-fetch-site': 'same-site',
    },
  }), ['admin', 'users']);
  assert.equal(sibling.status, 403);
  assert.equal(denied.calls.length, 0);
});

test('private API responses are no-store while the documented public GET allowlist stays cacheable', async () => {
  const privateResponse = createFetch(() => okResponse('{}', {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=60',
  }));
  const privateStack = loadApiStack(privateResponse.fetch);
  const privateGet = await invoke(privateStack.route, 'GET', makeRequest({
    method: 'GET',
    host: 'localhost:3000',
  }), ['admin', 'users']);
  assert.equal(privateGet.headers.get('cache-control'), 'no-store');

  const bffPrivate = createFetch(() => okResponse());
  const bffStack = loadApiStack(bffPrivate.fetch);
  const bffGet = await invoke(bffStack.route, 'GET', makeRequest({
    method: 'GET',
    host: 'portal.localhost:3102',
    protocol: 'https:',
  }), ['admin', 'users']);
  assert.equal(bffGet.headers.get('cache-control'), 'no-store');

  for (const path of [['site-appearance'], ['article-taxonomy', 'v2', 'categories']]) {
    const publicResponse = createFetch(() => okResponse('{}', {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60',
    }));
    const publicStack = loadApiStack(publicResponse.fetch);
    const publicGet = await invoke(publicStack.route, 'GET', makeRequest({
      method: 'GET',
      host: 'localhost:3000',
    }), path);
    assert.equal(publicGet.headers.get('cache-control'), 'public, max-age=60', path.join('/'));
  }

  const defaultPublic = createFetch(() => okResponse('{}', { 'content-type': 'application/json' }));
  const defaultStack = loadApiStack(defaultPublic.fetch);
  const defaultGet = await invoke(defaultStack.route, 'GET', makeRequest({
    method: 'GET',
    host: 'localhost:3000',
  }), ['site-appearance']);
  assert.equal(
    defaultGet.headers.get('cache-control'),
    'public, max-age=300, stale-while-revalidate=600',
  );

  const mutation = createFetch(() => okResponse());
  const mutationStack = loadApiStack(mutation.fetch);
  const mutationResponse = await invoke(mutationStack.route, 'POST', makeRequest({
    method: 'POST',
    host: 'localhost:3000',
    headers: { origin: 'http://localhost:3000' },
  }), ['admin', 'users']);
  assert.equal(mutationResponse.headers.get('cache-control'), 'no-store');
});

test('origin helpers resolve the target from the Host header and compare exactly', () => {
  const { fetch } = createFetch();
  const { origin } = loadApiStack(fetch);

  assert.equal(
    origin.resolveProxyTargetOrigin(makeRequest({ host: 'localhost:3000' })),
    'http://localhost:3000',
  );
  assert.equal(
    origin.resolveProxyTargetOrigin(makeRequest({
      host: 'localhost:3000',
      headers: { 'x-forwarded-host': 'evil.example' },
    })),
    'http://localhost:3000',
  );
  assert.equal(
    origin.resolveProxyTargetOrigin(makeRequest({
      host: 'portal.localhost:3102',
      protocol: 'https:',
    })),
    'https://portal.localhost:3102',
  );
  assert.equal(
    origin.resolveProxyTargetOrigin(makeRequest({
      host: 'www.campusute.io.vn',
      protocol: 'http:',
    })),
    'https://www.campusute.io.vn',
  );
  assert.equal(
    origin.resolveProxyTargetOrigin(makeRequest({ host: 'unknown.example' })),
    null,
  );
  assert.equal(
    origin.isExactRequestOrigin('http://localhost:3000', 'http://localhost:3000'),
    true,
  );
  assert.equal(
    origin.isExactRequestOrigin('http://localhost:3000/', 'http://localhost:3000'),
    false,
  );
  assert.equal(
    origin.isExactRequestOrigin('http://localhost:3001', 'http://localhost:3000'),
    false,
  );
});
