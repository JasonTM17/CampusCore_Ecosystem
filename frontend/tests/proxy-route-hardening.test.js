const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileFile,
  loadApiStack,
  loadDocsStack,
  loadHealthStack,
  loadSiteAppearanceStack,
  makeRequest,
  contextFor,
  createFetch,
} = require('./proxy-route-harness');

const EDGE_TOKEN = 'test-edge-token-0123456789abcdef0123456789';
const PREVIEW_TOKEN = 'sso-preview-proxy-token-0123456789';

function loadIdentityRoute(lane, fetch, env = {}) {
  if (lane === 'api') return loadApiStack(fetch, env).route;
  return compileFile('src/app/session/[...path]/route.ts', {
    process: { env: { JAVA_API_ORIGIN: 'http://java.test', ...env } },
    globals: { fetch },
  });
}

async function sendIdentityRequest(route, lane, headers = {}) {
  return route.POST(makeRequest({ host: 'portal.localhost', headers }),
    contextFor(lane === 'api' ? ['auth', 'login'] : ['logout']));
}

for (const lane of ['api', 'session']) {
  test(`${lane} proxy strips caller forwarding and edge credentials by default`, async () => {
    const { fetch, calls } = createFetch();
    const route = loadIdentityRoute(lane, fetch);
    await sendIdentityRequest(route, lane, {
      'x-forwarded-for': '198.51.100.42',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-port': '443',
      forwarded: 'for=198.51.100.42;host=evil.example;proto=https',
      'x-real-ip': '198.51.100.42',
      'x-campuscore-proxy-token': PREVIEW_TOKEN,
      'x-campuscore-client-ip': '198.51.100.42',
    });
    const headers = calls[0].options.headers;
    assert.equal(headers.get('x-forwarded-for'), 'web-proxy');
    for (const name of ['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
      'forwarded', 'x-real-ip', 'x-campuscore-proxy-token', 'x-campuscore-client-ip']) {
      assert.equal(headers.get(name), null, name);
    }
  });

  test(`${lane} proxy requires explicit edge opt-in even with a configured token`, async () => {
    for (const flag of [undefined, 'false', '1']) {
      const { fetch, calls } = createFetch();
      const route = loadIdentityRoute(lane, fetch, {
        CAMPUSCORE_PROXY_TOKEN: EDGE_TOKEN, CAMPUSCORE_TRUST_EDGE_HEADERS: flag,
      });
      await sendIdentityRequest(route, lane, { 'x-forwarded-for': '203.0.113.9' });
      assert.equal(calls[0].options.headers.get('x-forwarded-for'), 'web-proxy');
      assert.equal(calls[0].options.headers.get('x-campuscore-client-ip'), 'web-proxy');
    }
  });

  test(`${lane} proxy preserves separate trusted edge clients and removes poisoned metadata`, async () => {
    const { fetch, calls } = createFetch();
    const route = loadIdentityRoute(lane, fetch, {
      CAMPUSCORE_TRUST_EDGE_HEADERS: 'true', CAMPUSCORE_PROXY_TOKEN: EDGE_TOKEN,
    });
    for (const ip of ['203.0.113.9', '2001:db8::2']) {
      await sendIdentityRequest(route, lane, {
        'x-forwarded-for': `198.51.100.42, ${ip}`,
        'x-real-ip': '198.51.100.42',
        'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'ftp',
        'x-forwarded-port': '21', forwarded: 'for=198.51.100.42',
        'x-campuscore-proxy-token': PREVIEW_TOKEN,
        'x-campuscore-client-ip': '198.51.100.42',
      });
      const headers = calls.at(-1).options.headers;
      assert.equal(headers.get('x-forwarded-for'), ip);
      assert.equal(headers.get('x-campuscore-client-ip'), ip);
      assert.equal(headers.get('x-campuscore-proxy-token'), EDGE_TOKEN);
      for (const name of ['x-real-ip', 'x-forwarded-host', 'x-forwarded-proto',
        'x-forwarded-port', 'forwarded']) assert.equal(headers.get(name), null, name);
    }
  });

  test(`${lane} proxy does not promote a malformed or absent edge address`, async () => {
    const { fetch, calls } = createFetch();
    const route = loadIdentityRoute(lane, fetch, {
      CAMPUSCORE_TRUST_EDGE_HEADERS: 'true', CAMPUSCORE_PROXY_TOKEN: EDGE_TOKEN,
    });
    for (const value of [undefined, '203.0.113.9, ', 'not-an-ip', '203.0.113.9:80']) {
      await sendIdentityRequest(route, lane, value ? { 'x-forwarded-for': value } : {});
      assert.equal(calls.at(-1).options.headers.get('x-forwarded-for'), 'web-proxy');
    }
  });

  test(`${lane} proxy refuses unsafe edge tokens during module initialization`, () => {
    for (const token of [undefined, '', '   ', 'short', 'x'.repeat(31), PREVIEW_TOKEN]) {
      assert.throws(() => loadIdentityRoute(lane, createFetch().fetch, {
        CAMPUSCORE_TRUST_EDGE_HEADERS: 'true', CAMPUSCORE_PROXY_TOKEN: token,
      }), /CAMPUSCORE_PROXY_TOKEN.*32.*unpublished/);
    }
    assert.doesNotThrow(() => loadIdentityRoute(lane, createFetch().fetch, {
      CAMPUSCORE_TRUST_EDGE_HEADERS: 'true', CAMPUSCORE_PROXY_TOKEN: 'x'.repeat(32),
    }));
  });
}

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
