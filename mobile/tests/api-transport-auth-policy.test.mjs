import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Transport authority: explicit auth policy per call, one refresh single-flight
 * shared by JSON/download/upload, session-epoch aborts, idempotency-key reuse and
 * normalised errors. client.ts is transpiled and run against a stubbed fetch.
 */
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-transport-'));
const MODULES = {
  'react-native': 'react-native.mjs',
  '../auth/mobile-session-store': 'mobile-session-store.mjs',
  './assistant-stream': 'assistant-stream.mjs',
  './observability': 'observability.mjs',
};

function transpile(file, fileName) {
  const source = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  });
  const rewritten = outputText.replace(/from '([^']+)'/g, (match, specifier) =>
    MODULES[specifier] ? `from './${MODULES[specifier]}'` : match);
  fs.writeFileSync(path.join(tempRoot, fileName.replace(/\.ts$/, '.mjs')), rewritten);
}

fs.writeFileSync(path.join(tempRoot, 'react-native.mjs'), "export const Platform = { OS: 'ios' };\n");
fs.writeFileSync(path.join(tempRoot, 'mobile-session-store.mjs'), `
export const sessionStore = {
  getAccessToken: () => null,
  setAccessToken: () => {},
  refreshAccessToken: async () => ({ accessToken: null }),
  sessionEpoch: () => 0,
};
`);
fs.writeFileSync(path.join(tempRoot, 'assistant-stream.mjs'), 'export const createSseTransport = () => ({});\n');
transpile('src/api/observability.ts', 'observability.ts');
transpile('src/api/client.ts', 'client.ts');
const {
  ApiClientError,
  createApiClient,
  normalizeApiError,
  safeDownloadFileName,
} = await import(pathToFileURL(path.join(tempRoot, 'client.mjs')).href);

const BASE = 'http://api.test/api/v1';
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Installs a scripted fetch; every call is recorded with its normalised headers. */
function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const call = { url: String(url), init, headers, body: init.body, signal: init.signal };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** A session whose refresh rotates the token once, after a tick, and counts invocations. */
function makeSession(initialToken = 'old-token') {
  const state = { token: initialToken, epoch: 1, refreshCalls: 0, expired: 0 };
  const options = {
    baseUrl: BASE,
    mode: 'live',
    getAccessToken: () => state.token,
    setAccessToken: (token) => { state.token = token; },
    sessionEpoch: () => state.epoch,
    epochPollMs: 5,
    onSessionExpired: () => { state.expired += 1; },
    refreshSession: async () => {
      state.refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      state.token = 'new-token';
      return true;
    },
  };
  return { state, options };
}

const authorizedWith = (token) => (call) => call.headers.get('authorization') === `Bearer ${token}`;

test('concurrent 401s share one refresh across JSON, download and upload lanes', async () => {
  const { state, options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch((call) => {
    if (!authorizedWith('new-token')(call)) return json(401, { message: 'expired' });
    if (call.url.endsWith('/file')) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return json(200, { ok: true });
  });
  try {
    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.txt');
    const results = await Promise.all([
      client.get('/a'),
      client.get('/b'),
      client.download('/doc/file'),
      client.upload('/up', form, { idempotencyKey: 'k-1' }),
    ]);
    assert.equal(state.refreshCalls, 1, 'exactly one refresh for four concurrent 401s');
    assert.deepEqual(results[0], { ok: true });
    assert.equal(results[2].data.byteLength, 3);
    assert.deepEqual(results[3], { ok: true });
    assert.equal(net.calls.length, 8, 'each request retries exactly once');
    assert.equal(state.expired, 0);
  } finally {
    net.restore();
  }
});

test('public calls never send Authorization and never refresh on 401', async () => {
  const { state, options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch((call, index) => (index === 2 ? json(401, { message: 'no' }) : json(200, { items: [] })));
  try {
    await client.get('/announcements/public', { auth: 'public', headers: { Authorization: 'Bearer smuggled' } });
    assert.equal(net.calls[0].headers.has('authorization'), false, 'caller-supplied Authorization is dropped too');
    assert.equal(net.calls[0].init.auth, undefined, 'the policy flag is not forwarded to fetch');

    await assert.rejects(
      client.get('/public/docs', { auth: 'public' }),
      (error) => error instanceof ApiClientError && error.status === 401 && error.kind === 'unauthorized',
    );
    assert.equal(net.calls[1].headers.has('authorization'), false);
    assert.equal(state.refreshCalls, 0, 'a public 401 must not start a refresh');
    assert.equal(state.expired, 0, 'a public 401 must not evict the session');
    assert.equal(net.calls.length, 2, 'no replay');

    await client.get('/me');
    assert.equal(net.calls[2].headers.get('authorization'), 'Bearer old-token', 'default policy stays protected');
  } finally {
    net.restore();
  }
});

test('JSON path is unchanged: headers, bodies, 204, text and failed refresh bridge', async () => {
  const { state, options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch((call) => {
    if (call.url.endsWith('/empty')) return new Response(null, { status: 204 });
    if (call.url.endsWith('/text')) return new Response('plain', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (call.url.endsWith('/dead')) return json(401, { message: 'dead' });
    return json(200, { echoed: call.body ?? null });
  });
  try {
    const posted = await client.post('/things', { a: 1 }, { headers: { 'Idempotency-Key': 'abc' } });
    assert.deepEqual(posted, { echoed: '{"a":1}' });
    const sent = net.calls[0];
    assert.equal(sent.url, `${BASE}/things`);
    assert.equal(sent.init.method, 'POST');
    assert.equal(sent.headers.get('accept'), 'application/json');
    assert.equal(sent.headers.get('content-type'), 'application/json');
    assert.equal(sent.headers.get('idempotency-key'), 'abc');
    assert.equal(sent.headers.get('authorization'), 'Bearer old-token');
    assert.match(sent.headers.get('x-request-id'), /^mobile-/);
    assert.equal(sent.signal, undefined, 'JSON calls keep the caller signal untouched');

    assert.equal(await client.get('/empty'), undefined);
    assert.equal(await client.get('/text'), 'plain');

    state.refreshCalls = 0;
    const failing = createApiClient({ ...options, refreshSession: async () => { state.refreshCalls += 1; return false; } });
    await assert.rejects(failing.get('/dead'), (error) => error.status === 401);
    assert.equal(state.expired, 1, 'dead session still bridges to sign-in');
  } finally {
    net.restore();
  }
});

test('JSON 401 from a stale epoch lane does not evict the new session', async () => {
  const { state, options } = makeSession();
  const client = createApiClient({
    ...options,
    refreshSession: async () => { state.epoch += 1; state.token = null; return false; },
  });
  const net = installFetch(() => json(401, { message: 'dead lane' }));
  try {
    await assert.rejects(client.get('/me'), (error) => error.status === 401);
    assert.equal(state.expired, 0);
  } finally {
    net.restore();
  }
});

test('logout during a download aborts the transfer and clears its timer', async () => {
  const { state, options } = makeSession();
  const client = createApiClient(options);
  let seenSignal;
  const net = installFetch((call) => new Promise((_resolve, reject) => {
    seenSignal = call.signal;
    call.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  try {
    const pending = client.download('/doc/file');
    setTimeout(() => { state.epoch += 1; state.token = null; }, 10);
    await assert.rejects(
      pending,
      (error) => error instanceof ApiClientError && error.code === 'SESSION_CHANGED' && error.kind === 'aborted',
    );
    assert.equal(seenSignal.aborted, true, 'the in-flight fetch received the abort');
    assert.equal(net.calls.length, 1, 'no retry after the session changed');
  } finally {
    net.restore();
  }
});

test('a body that finishes after a session change is discarded', async () => {
  const { state, options } = makeSession();
  const client = createApiClient({ ...options, epochPollMs: 10_000 });
  const net = installFetch(() => {
    state.epoch += 1;
    return new Response(new Uint8Array([9]), { status: 200 });
  });
  try {
    await assert.rejects(client.download('/doc/file'), (error) => error.code === 'SESSION_CHANGED');
  } finally {
    net.restore();
  }
});

test('a transfer 401 from a stale lane never evicts or reuses the replacing session', async () => {
  const { state, options } = makeSession();
  const client = createApiClient({
    ...options,
    epochPollMs: 10_000,
    refreshSession: async () => { state.epoch += 1; state.token = 'other-account'; return true; },
  });
  const net = installFetch(() => json(401, { message: 'expired' }));
  try {
    await assert.rejects(client.download('/doc/file'), (error) => error.code === 'SESSION_CHANGED');
    assert.equal(net.calls.length, 1, 'the other account token is never used for the replay');
    assert.equal(state.expired, 0);
  } finally {
    net.restore();
  }
});

test('the caller signal aborts a transfer', async () => {
  const { options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch((call) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('aborted', 'AbortError'));
    if (call.signal.aborted) abort();
    else call.signal.addEventListener('abort', abort);
  }));
  try {
    const controller = new AbortController();
    const pending = client.download('/doc/file', { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(pending, (error) => error.code === 'REQUEST_ABORTED' && error.kind === 'aborted');

    const already = new AbortController();
    already.abort();
    await assert.rejects(client.download('/doc/file', { signal: already.signal }), (error) => error.code === 'REQUEST_ABORTED');
  } finally {
    net.restore();
  }
});

test('an upload retry reuses the same idempotency key and the same form', async () => {
  const { options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch((call, index) => {
    if (index === 1) return json(401, { message: 'expired' });
    if (index === 2) return json(200, { id: 'a1' });
    if (index === 3) throw new TypeError('network down');
    return json(200, { id: 'a1' });
  });
  try {
    const form = new FormData();
    form.append('file', new Blob(['hello']), 'cv.pdf');

    // Replay inside the client after a refresh.
    assert.deepEqual(await client.upload('/careers/applications/x/attachments', form, { idempotencyKey: 'intent-1' }), { id: 'a1' });
    const [first, replay] = net.calls;
    assert.equal(first.headers.get('idempotency-key'), 'intent-1');
    assert.equal(replay.headers.get('idempotency-key'), 'intent-1');
    assert.equal(replay.headers.get('authorization'), 'Bearer new-token');
    assert.equal(replay.body, first.body, 'the same multipart body object is replayed');
    assert.equal(first.headers.has('content-type'), false, 'fetch owns the multipart boundary');
    assert.equal(first.init.method, 'POST');

    // Caller-level retry after an unknown outcome passes the same key again.
    await assert.rejects(
      client.upload('/careers/applications/x/attachments', form, { idempotencyKey: 'intent-2' }),
      (error) => error instanceof ApiClientError && error.kind === 'network' && error.retryable === true,
    );
    await client.upload('/careers/applications/x/attachments', form, { idempotencyKey: 'intent-2' });
    const [failed, retried] = net.calls.slice(2);
    assert.equal(failed.headers.get('idempotency-key'), 'intent-2');
    assert.equal(retried.headers.get('idempotency-key'), 'intent-2');
  } finally {
    net.restore();
  }
});

test('upload supports PUT and omits Idempotency-Key when none is given', async () => {
  const { options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch(() => json(200, { id: 's1' }));
  try {
    await client.upload('/learning/submissions/s1/draft', new FormData(), { method: 'PUT' });
    assert.equal(net.calls[0].init.method, 'PUT');
    assert.equal(net.calls[0].headers.has('idempotency-key'), false);
  } finally {
    net.restore();
  }
});

test('downloads return bytes, content type and a path-safe file name', async () => {
  const { options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch(() => new Response(new Uint8Array([7, 8]), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''..%2F..%2Fb%C3%A1o%20c%C3%A1o.pdf",
    },
  }));
  try {
    const file = await client.download('/admissions/applications/a/attachments/b/file');
    assert.equal(net.calls[0].init.method, 'GET');
    assert.equal(net.calls[0].headers.get('accept'), '*/*');
    assert.equal(file.contentType, 'application/pdf');
    assert.equal(file.fileName, 'báo cáo.pdf');
    assert.deepEqual([...new Uint8Array(file.data)], [7, 8]);
  } finally {
    net.restore();
  }
  assert.equal(safeDownloadFileName('attachment; filename="..\\..\\evil.exe"'), 'evil.exe');
  assert.equal(safeDownloadFileName('attachment; filename=".."'), null);
  assert.equal(safeDownloadFileName(null), null);
});

test('a download error body is parsed into the normalised error', async () => {
  const { options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch(() => json(404, { message: 'Attachment not found', code: 'ATTACHMENT_NOT_FOUND' }));
  try {
    await assert.rejects(
      client.download('/x/file'),
      (error) => error.status === 404 && error.code === 'ATTACHMENT_NOT_FOUND' && error.kind === 'not_found',
    );
  } finally {
    net.restore();
  }
});

test('a cross-origin redirect is re-sent without Authorization; same-origin keeps it', async () => {
  const { options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch((call, index) => {
    if (index === 1) return new Response(null, { status: 302, headers: { location: 'https://cdn.test/blob/1' } });
    if (index === 2) return new Response(new Uint8Array([1]), { status: 200 });
    if (index === 3) return new Response(null, { status: 307, headers: { location: '/api/v1/real/file' } });
    return new Response(new Uint8Array([2]), { status: 200 });
  });
  try {
    await client.download('/doc/file');
    assert.equal(net.calls[0].headers.get('authorization'), 'Bearer old-token');
    assert.equal(net.calls[0].init.redirect, 'manual');
    assert.equal(net.calls[1].url, 'https://cdn.test/blob/1');
    assert.equal(net.calls[1].headers.has('authorization'), false);

    await client.download('/doc/other');
    assert.equal(net.calls[3].url, 'http://api.test/api/v1/real/file');
    assert.equal(net.calls[3].headers.get('authorization'), 'Bearer old-token');
  } finally {
    net.restore();
  }
});

test('a 401 from a cross-origin hop never triggers a refresh', async () => {
  const { state, options } = makeSession();
  const client = createApiClient(options);
  const net = installFetch((call, index) => (index === 1
    ? new Response(null, { status: 302, headers: { location: 'https://cdn.test/blob/1' } })
    : json(401, { message: 'cdn says no' })));
  try {
    await assert.rejects(client.download('/doc/file'), (error) => error.status === 401);
    assert.equal(state.refreshCalls, 0);
  } finally {
    net.restore();
  }
});

test('failures normalise to one shape: conflict, denied, validation, server, network, abort', async () => {
  const { options } = makeSession();
  const client = createApiClient(options);
  const responses = [
    json(409, { message: 'Version conflict', code: 'VERSION_CONFLICT' }),
    json(403, { message: 'Denied', code: 'STUDENT_SCOPE_REQUIRED' }),
    json(400, { message: 'limit must be between 1 and 100', code: 'INVALID_PAGING' }),
    json(503, { message: 'down' }),
    new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
  ];
  const net = installFetch(() => responses.shift());
  try {
    const failures = [];
    for (let i = 0; i < 5; i += 1) {
      failures.push(await client.get('/x').catch((error) => normalizeApiError(error)));
    }
    assert.deepEqual(
      failures.map(({ kind, status, retryable }) => ({ kind, status, retryable })),
      [
        { kind: 'conflict', status: 409, retryable: false },
        { kind: 'denied', status: 403, retryable: false },
        { kind: 'invalid', status: 400, retryable: false },
        { kind: 'server', status: 503, retryable: true },
        { kind: 'server', status: 502, retryable: true },
      ],
    );
    assert.equal(failures[0].code, 'VERSION_CONFLICT');
    assert.match(failures[0].requestId, /^mobile-/);
    assert.equal(failures[4].message, 'The API request failed', 'non-JSON error bodies fall back to the generic message');
  } finally {
    net.restore();
  }

  assert.deepEqual(
    (({ kind, retryable }) => ({ kind, retryable }))(normalizeApiError(new TypeError('Network request failed'))),
    { kind: 'network', retryable: true },
  );
  assert.equal(normalizeApiError(new DOMException('x', 'AbortError')).kind, 'aborted');
});

test('preview mode refuses every lane before any network call', async () => {
  const client = createApiClient({ baseUrl: BASE, mode: 'preview' });
  const net = installFetch(() => json(200, {}));
  try {
    await assert.rejects(client.get('/x'), (error) => error.code === 'MOBILE_API_PREVIEW');
    await assert.rejects(client.download('/x'), (error) => error.code === 'MOBILE_API_PREVIEW');
    await assert.rejects(client.upload('/x', new FormData()), (error) => error.code === 'MOBILE_API_PREVIEW');
    assert.equal(net.calls.length, 0);
  } finally {
    net.restore();
  }
});

test('native disk downloads use the authenticated manual redirect lane and forward progress', async () => {
  const { options } = makeSession();
  const calls = [];
  const progress = [];
  let released = 0;
  const nativeFiles = {
    fetch: async (url, init) => {
      calls.push({ url, init, headers: new Headers(init.headers) });
      if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://cdn.test/a' } });
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/pdf' } });
    },
    streamDownload: async (response, signal, onProgress) => {
      assert.equal(signal.aborted, false);
      assert.equal(response.ok, true);
      onProgress(1, 1);
      return { localUri: 'file:///cache/generated.pdf', release: () => { released += 1; } };
    },
  };
  const client = createApiClient({ ...options, nativeFiles });
  const file = await client.download('/learning/materials/a/file', { nativeFile: true, onProgress: (...p) => progress.push(p) });
  assert.equal(file.localUri, 'file:///cache/generated.pdf');
  assert.equal(file.data.byteLength, 0, 'the disk lane never materializes an ArrayBuffer');
  assert.equal(calls[0].headers.get('authorization'), 'Bearer old-token');
  assert.equal(calls[1].headers.has('authorization'), false);
  assert.ok(calls.every(call => call.init.redirect === 'manual'));
  assert.deepEqual(progress, [[1, 1]]);
  assert.equal(released, 0);
  file.release();
  assert.equal(released, 1);
});

test('native disk result is deleted when the session changes just after streaming', async () => {
  const { state, options } = makeSession();
  let released = 0;
  const nativeFiles = {
    fetch: async () => new Response(new Uint8Array([1])),
    streamDownload: async () => {
      state.epoch += 1;
      return { localUri: 'file:///cache/generated.pdf', release: () => { released += 1; } };
    },
  };
  const client = createApiClient({ ...options, nativeFiles, epochPollMs: 10000 });
  await assert.rejects(client.download('/learning/materials/a/file', { nativeFile: true }), e => e.code === 'SESSION_CHANGED');
  assert.equal(released, 1);
});

test('legacy bytes consumer uses the bounded native disk lane then releases the cache file', async () => {
  const { options } = makeSession();
  let released = 0;
  const nativeFiles = {
    fetch: async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/pdf' } }),
    streamDownload: async () => ({ localUri: 'file:///cache/generated.pdf', release: () => { released += 1; } }),
    readDiskDownload: async () => new Uint8Array([1]).buffer,
  };
  const file = await createApiClient({ ...options, nativeFiles }).download('/learning/materials/a/file');
  assert.deepEqual([...new Uint8Array(file.data)], [1]);
  assert.equal(file.localUri, undefined);
  assert.equal(released, 1);
});

test('native multipart is prepared once and replays the prepared body/key after refresh', async () => {
  const { options, state } = makeSession();
  const sent = [];
  const original = new FormData();
  const prepared = new FormData();
  prepared.append('file', new Blob(['%PDF'], { type: 'application/pdf' }));
  let preparedCount = 0;
  const nativeFiles = {
    prepareUpload: (form, path) => {
      assert.equal(form, original);
      assert.equal(path, '/admissions/applications/a/attachments');
      preparedCount += 1;
      return prepared;
    },
    fetch: async (_url, init) => {
      sent.push(init);
      return sent.length === 1 ? json(401, {}) : json(200, { id: 'uploaded' });
    },
  };
  const client = createApiClient({ ...options, nativeFiles });
  assert.deepEqual(await client.upload('/admissions/applications/a/attachments', original, { idempotencyKey: 'native-intent' }), { id: 'uploaded' });
  assert.equal(preparedCount, 1);
  assert.equal(state.refreshCalls, 1);
  assert.ok(sent.every(init => init.body === prepared && init.headers.get('Idempotency-Key') === 'native-intent'));
});
