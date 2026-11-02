const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadApiStack,
  makeRequest,
  contextFor,
  createFetch,
} = require('./proxy-route-harness');

const JSON_HEADERS = { 'content-type': 'application/json' };

test('a declared body above the route cap is rejected before it is read', async () => {
  let readerAttached = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const getReader = stream.getReader.bind(stream);
  stream.getReader = (...args) => {
    readerAttached = true;
    return getReader(...args);
  };
  const { fetch, calls } = createFetch();
  const { route } = loadApiStack(fetch);

  const response = await route.POST(
    makeRequest({
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'content-length': String(5 * 1024 * 1024),
      },
      body: stream,
    }),
    contextFor(['auth', 'login']),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'REQUEST_BODY_TOO_LARGE' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0, 'an oversized body must not reach the upstream fetch');
  assert.equal(readerAttached, false, 'the declared size is rejected before the stream is consumed');
});

test('a chunked JSON body is aborted once it crosses the route ceiling', async () => {
  let sent = 0;
  let canceled = false;
  const body = new ReadableStream({
    pull(controller) {
      if (sent === 6) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(512 * 1024));
    },
    cancel() {
      canceled = true;
    },
  });
  const { fetch, calls } = createFetch();
  const { route } = loadApiStack(fetch);

  const response = await route.POST(
    makeRequest({ method: 'POST', headers: JSON_HEADERS, body }),
    contextFor(['enrollments']),
  );

  assert.equal(response.status, 413);
  assert.equal(calls.length, 0, 'a body that crosses the ceiling while reading must not be forwarded');
  assert.equal(canceled, true, 'reading stops and the request stream is cancelled');
});

test('a JSON body at the route cap still proxies through unchanged', async () => {
  const { fetch, calls } = createFetch();
  const { route } = loadApiStack(fetch);
  const body = new Uint8Array(4 * 1024).fill(97);

  const response = await route.POST(
    makeRequest({
      method: 'POST',
      headers: { ...JSON_HEADERS, 'content-length': String(body.byteLength) },
      body,
    }),
    contextFor(['auth', 'login']),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body.byteLength, body.byteLength);
});

test('the assistant lane keeps its tighter 64 KiB JSON ceiling', async () => {
  const { fetch, calls } = createFetch();
  const { route } = loadApiStack(fetch);

  const response = await route.POST(
    makeRequest({
      method: 'POST',
      headers: { ...JSON_HEADERS, 'content-length': String(65 * 1024) },
      body: new Uint8Array(65 * 1024),
    }),
    contextFor(['assistant', 'chat']),
  );

  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});

test('multipart uploads use the servlet request ceiling instead of the JSON ceiling', async () => {
  const { fetch, calls } = createFetch();
  const { route } = loadApiStack(fetch);
  const body = new Uint8Array(2 * 1024 * 1024).fill(98);

  const response = await route.POST(
    makeRequest({
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=test-boundary',
        'content-length': String(body.byteLength),
      },
      body,
    }),
    contextFor(['learning', 'assignments', 'assignment-1', 'submissions']),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body.byteLength, body.byteLength);
});

test('a multipart request above the servlet request ceiling is rejected before reading', async () => {
  const { fetch, calls } = createFetch();
  const { route } = loadApiStack(fetch);

  const response = await route.POST(
    makeRequest({
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=test-boundary',
        'content-length': String(22 * 1024 * 1024),
      },
      body: new Uint8Array(1),
    }),
    contextFor(['learning', 'assignments', 'assignment-1', 'submissions']),
  );

  assert.equal(response.status, 413);
  assert.equal(calls.length, 0);
});
