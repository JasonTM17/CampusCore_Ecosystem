const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadDocsStack,
  loadHealthStack,
  loadSiteAppearanceStack,
  makeRequest,
  contextFor,
  createFetch,
} = require('./proxy-route-harness');

test('the docs proxy strips credential and forwarding headers but keeps content negotiation', async () => {
  const { fetch, calls } = createFetch();
  const { route } = loadDocsStack(fetch);
  const response = await route.GET(
    makeRequest({
      method: 'GET',
      host: 'docs.localhost',
      headers: {
        cookie: 'cc_csrf=secret; cc_access_token=secret',
        authorization: 'Bearer secret',
        'proxy-authorization': 'Basic secret',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-port': '443',
        forwarded: 'for=203.0.113.9',
        'x-real-ip': '203.0.113.9',
        'x-campuscore-surface': 'portal',
        'x-campuscore-proxy-token': 'secret',
        'x-vercel-forwarded-for': '203.0.113.9',
        'x-api-key': 'secret',
        'x-csrf-token': 'secret',
        accept: 'application/json',
        'accept-language': 'vi',
      },
    }),
    contextFor(['swagger-config']),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const forwarded = calls[0].options.headers;
  for (const name of [
    'host', 'cookie', 'authorization', 'proxy-authorization', 'forwarded',
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
    'x-real-ip', 'x-campuscore-surface', 'x-campuscore-proxy-token',
    'x-vercel-forwarded-for', 'x-api-key', 'x-csrf-token',
  ]) {
    assert.equal(forwarded.get(name), null, name);
  }
  assert.equal(forwarded.get('accept'), 'application/json');
  assert.equal(forwarded.get('accept-language'), 'vi');
  assert.equal(forwarded.get('accept-encoding'), 'identity');
});

test('the health route converts an unreachable Java probe into a structured 503', async () => {
  const { fetch, calls } = createFetch(() => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:4010');
  });
  const route = loadHealthStack(fetch);
  const response = await route.GET(makeRequest({
    method: 'GET',
    headers: { 'x-request-id': 'probe-1' },
  }));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { status: 'unavailable' });
  assert.doesNotMatch(text, /ECONNREFUSED|stack|Error/i);
});

test('the health route keeps the upstream probe response and request id', async () => {
  const { fetch, calls } = createFetch(() => new Response('{"status":"ok"}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  const route = loadHealthStack(fetch);
  const response = await route.GET(makeRequest({
    method: 'GET',
    headers: { 'x-request-id': 'probe-2' },
  }));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"status":"ok"}');
  assert.equal(calls[0].url, 'http://java.test/api/v1/health/liveness');
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  assert.equal(calls[0].options.headers['X-Request-Id'], 'probe-2');
});

function adminResponse(roles = ['ADMIN']) {
  return new Response(JSON.stringify({ roles }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function appearanceStore(spy) {
  return {
    readSavedSiteAppearance: async () => null,
    writeSiteAppearance: async (payload) => {
      spy.push(payload);
      return { accent: 'river-blue' };
    },
  };
}

test('site-appearance PUT requires the CSRF header and never falls back to the cookie', async () => {
  for (const headers of [
    { cookie: 'cc_csrf=cookie-token' },
    { cookie: 'cc_csrf=cookie-token', 'x-csrf-token': '' },
  ]) {
    const { fetch, calls } = createFetch(() => {
      throw new Error('requireAdmin must not call /auth/me without a header');
    });
    const writes = [];
    const route = loadSiteAppearanceStack(fetch, { store: appearanceStore(writes) });
    const response = await route.PUT(makeRequest({
      method: 'PUT',
      headers,
    }));
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
    assert.equal(writes.length, 0);
  }
});

test('site-appearance PUT sends only the header token to /auth/me', async () => {
  const { fetch, calls } = createFetch(() => adminResponse());
  const writes = [];
  const route = loadSiteAppearanceStack(fetch, { store: appearanceStore(writes) });
  const response = await route.PUT(makeRequest({
    method: 'PUT',
    headers: {
      cookie: 'cc_csrf=cookie-token',
      'x-csrf-token': 'header-token',
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://java.test/api/v1/auth/me');
  assert.equal(calls[0].options.headers['X-CSRF-Token'], 'header-token');
  assert.equal(calls[0].options.headers.cookie, 'cc_csrf=cookie-token');
  assert.equal(writes.length, 1);
});

test('site-appearance PUT still refuses a non-admin and a missing session hint', async () => {
  const nonAdmin = createFetch(() => adminResponse(['STUDENT']));
  const nonAdminWrites = [];
  const nonAdminRoute = loadSiteAppearanceStack(nonAdmin.fetch, {
    store: appearanceStore(nonAdminWrites),
  });
  const forbidden = await nonAdminRoute.PUT(makeRequest({
    method: 'PUT',
    headers: { cookie: 'cc_csrf=token', 'x-csrf-token': 'header-token' },
  }));
  assert.equal(forbidden.status, 403);
  assert.equal(nonAdmin.calls.length, 1);
  assert.equal(nonAdminWrites.length, 0);

  const noHint = createFetch(() => {
    throw new Error('missing session hint must not call /auth/me');
  });
  const noHintRoute = loadSiteAppearanceStack(noHint.fetch, { store: appearanceStore([]) });
  const noHintResponse = await noHintRoute.PUT(makeRequest({
    method: 'PUT',
    headers: { 'x-csrf-token': 'header-token' },
  }));
  assert.equal(noHintResponse.status, 403);
  assert.equal(noHint.calls.length, 0);
});
