const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadApiStack,
  loadDocsStack,
  makeRequest,
  contextFor,
  createFetch,
} = require('./proxy-route-harness');

const TRAVERSAL_SEGMENTS = [
  ['..'],
  ['.'],
  ['%2e'],
  ['%2E'],
  ['%2e%2e'],
  ['%2E%2E'],
  ['.%2e'],
  ['%2e.'],
  ['%252e%252e'],
  ['%2525252e%2525252e'],
];

const INJECTION_SEGMENTS = [
  ['foo?x=1'],
  ['foo%3Fx=1'],
  ['foo#frag'],
  ['foo%23frag'],
  ['foo/bar'],
  ['foo%2Fbar'],
  ['foo\\bar'],
  ['foo%5Cbar'],
  ['%2f', 'admin'],
  ['%3f', 'x'],
  ['%00'],
];

test('the docs catch-all rejects dot segments in every encoding with 400 and zero upstream fetches', async () => {
  const cases = [
    ...TRAVERSAL_SEGMENTS,
    ['openapi.json', '..', 'secret'],
    ['docs', '.'],
  ];

  for (const path of cases) {
    const { fetch, calls } = createFetch();
    const { route } = loadDocsStack(fetch);
    const response = await route.GET(
      makeRequest({ method: 'GET', host: 'docs.localhost' }),
      contextFor(path),
    );
    assert.equal(response.status, 400, JSON.stringify(path));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'INVALID_DOCS_PATH' });
    assert.equal(calls.length, 0, JSON.stringify(path));
  }
});

test('the docs catch-all rejects separators, query markers and NUL with zero upstream fetches', async () => {
  for (const path of INJECTION_SEGMENTS) {
    const { fetch, calls } = createFetch();
    const { route } = loadDocsStack(fetch);
    const response = await route.GET(
      makeRequest({ method: 'GET', host: 'docs.localhost' }),
      contextFor(path),
    );
    assert.equal(response.status, 400, JSON.stringify(path));
    assert.equal(calls.length, 0, JSON.stringify(path));
  }
});

test('valid docs paths remain encoded and keep their existing upstream mapping', async () => {
  const cases = [
    [[], 'http://java.test/v3/api-docs'],
    [['openapi.json'], 'http://java.test/v3/api-docs'],
    [['swagger-config'], 'http://java.test/v3/api-docs/swagger-config'],
    [['group with spaces'], 'http://java.test/v3/api-docs/group%20with%20spaces'],
    [['v3', 'api-docs'], 'http://java.test/v3/api-docs/v3/api-docs'],
  ];

  for (const [path, expected] of cases) {
    const { fetch, calls } = createFetch();
    const { route } = loadDocsStack(fetch);
    const response = await route.GET(
      makeRequest({ method: 'GET', host: 'docs.localhost' }),
      contextFor(path),
    );
    assert.equal(response.status, 200, JSON.stringify(path));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, expected);
  }
});

test('the v1 proxy rejects traversal on both lanes with zero upstream fetches', async () => {
  const lanes = [
    ['legacy', 'localhost:3000', 'http:'],
    ['bff', 'portal.localhost:3102', 'https:'],
  ];

  for (const [label, host, protocol] of lanes) {
    for (const path of [...TRAVERSAL_SEGMENTS, ['a', '..', 'b']]) {
      const { fetch, calls } = createFetch();
      const { route } = loadApiStack(fetch);
      const response = await route.GET(
        makeRequest({ method: 'GET', host, protocol }),
        contextFor(path),
      );
      assert.equal(response.status, 400, `${label} ${JSON.stringify(path)}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(calls.length, 0, `${label} ${JSON.stringify(path)}`);
    }
  }
});

test('the v1 proxy rejects query/fragment/separator injection on both lanes', async () => {
  const lanes = [
    ['legacy', 'localhost:3000', 'http:'],
    ['bff', 'portal.localhost:3102', 'https:'],
  ];

  for (const [label, host, protocol] of lanes) {
    for (const path of INJECTION_SEGMENTS) {
      const { fetch, calls } = createFetch();
      const { route } = loadApiStack(fetch);
      const response = await route.GET(
        makeRequest({ method: 'GET', host, protocol }),
        contextFor(path),
      );
      assert.equal(response.status, 400, `${label} ${JSON.stringify(path)}`);
      assert.equal(calls.length, 0, `${label} ${JSON.stringify(path)}`);
    }
  }
});

test('an unsafe traversal is rejected before the origin guard can reach upstream', async () => {
  const { fetch, calls } = createFetch();
  const { route } = loadApiStack(fetch);
  const response = await route.POST(
    makeRequest({
      method: 'POST',
      host: 'localhost:3000',
      headers: {
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
      },
    }),
    contextFor(['..', 'admin']),
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('valid path segments stay encoded and query strings are preserved on both lanes', async () => {
  const legacy = createFetch();
  const legacyStack = loadApiStack(legacy.fetch);
  const legacyResponse = await legacyStack.route.GET(
    makeRequest({ method: 'GET', host: 'localhost:3000', search: '?page=2&search=REST%20API' }),
    contextFor(['course with spaces']),
  );
  assert.equal(legacyResponse.status, 200);
  assert.equal(
    legacy.calls[0].url,
    'http://java.test/api/v1/course%20with%20spaces?page=2&search=REST%20API',
  );

  const bff = createFetch();
  const bffStack = loadApiStack(bff.fetch);
  const bffResponse = await bffStack.route.GET(
    makeRequest({
      method: 'GET',
      host: 'portal.localhost:3102',
      protocol: 'https:',
      search: '?page=2',
    }),
    contextFor(['course with spaces']),
  );
  assert.equal(bffResponse.status, 200);
  assert.equal(
    bff.calls[0].url,
    'http://java.test/bff/api/course%20with%20spaces?page=2',
  );
});

test('the path encoder rejects every dangerous decoded form and preserves normal encoding', () => {
  const { fetch } = createFetch();
  const { proxyUrl } = loadApiStack(fetch);

  for (const segment of [
    '..', '.', '%2e', '%2E', '%2e%2e', '%2E%2E', '%252e%252e', '%2525252e%2525252e', 'foo?x=1', 'foo#x', 'foo/bar',
    'foo\\bar', '\u0000',
  ]) {
    assert.throws(
      () => proxyUrl.encodeProxyPathSegment(segment),
      /Invalid proxy path segment/,
      segment,
    );
  }

  assert.equal(proxyUrl.encodeProxyPathSegment('course with spaces'), 'course%20with%20spaces');
  assert.equal(proxyUrl.encodeProxyPathSegment('100%'), '100%25');

  assert.throws(
    () => proxyUrl.buildApiProxyUrl('http://java.test', ['..', 'admin'], ''),
    /Invalid proxy path segment/,
  );
  assert.throws(
    () => proxyUrl.buildApiProxyUrl('http://java.test', ['%2e%2e', 'admin'], ''),
    /Invalid proxy path segment/,
  );
  assert.equal(
    proxyUrl.buildApiProxyUrl('http://java.test', ['sections', 'course with spaces'], '?page=2').toString(),
    'http://java.test/api/v1/sections/course%20with%20spaces?page=2',
  );
});
