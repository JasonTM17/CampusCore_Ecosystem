import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The patron loan history is a bare-array list behind the shared optional
 * window and X-Total-Count. The screen needs the whole list for its
 * active/history split, so the content facade walks 100-row windows until the
 * list ends — bounded so a server that never ends it cannot loop the read.
 * The recording client double answers without a network.
 */
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-loans-'));

function transpile(file, fileName, rewrite = (text) => text) {
  const source = fs.readFileSync(path.join(mobileRoot, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName,
  });
  fs.writeFileSync(path.join(tempRoot, fileName.replace(/\.ts$/, '.mjs')), rewrite(outputText));
}

fs.writeFileSync(path.join(tempRoot, 'client.mjs'), [
  'export const apiClient = {',
  "  handler: async () => { throw new Error('unscripted request'); },",
  "  get(path, init) { return apiClient.handler(path, { ...init, method: 'GET' }).then((result) => result.data); },",
  "  post(path, body, init) { return apiClient.handler(path, { ...init, method: 'POST', body }).then((result) => result.data); },",
  "  put(path, body, init) { return apiClient.handler(path, { ...init, method: 'PUT', body }).then((result) => result.data); },",
  "  delete(path, init) { return apiClient.handler(path, { ...init, method: 'DELETE' }).then((result) => result.data); },",
  '  requestWithMeta(path, init) { return apiClient.handler(path, init); },',
  '};',
  'export const campusApi = {',
  "  libraryMyLoans: () => apiClient.get('/library/requests/my'),",
  '};',
  "export const createAssistantClientRequestId = () => 'test-request-id';",
  '',
].join('\n'));

transpile('src/api/paging.ts', 'paging.ts');
transpile('src/api/parity-api.ts', 'parity-api.ts', (text) => text
  .replace(/from '\.\/paging'/g, "from './paging.mjs'")
  .replace(/from '\.\/client'/g, "from './client.mjs'"));
transpile('src/screens/content/content-paging.ts', 'content-paging.ts');
transpile('src/screens/academic/idempotency-attempts.ts', 'idempotency-attempts.ts');
transpile('src/screens/content/content-api.ts', 'content-api.ts', (text) => text
  .replace(/from '\.\.\/\.\.\/api\/client'/g, "from './client.mjs'")
  .replace(/from '\.\.\/\.\.\/api\/parity-api'/g, "from './parity-api.mjs'")
  .replace(/from '\.\.\/\.\.\/api\/paging'/g, "from './paging.mjs'")
  .replace(/from '\.\.\/academic\/idempotency-attempts'/g, "from './idempotency-attempts.mjs'")
  .replace(/from '\.\/content-paging'/g, "from './content-paging.mjs'"));

const { apiClient } = await import(pathToFileURL(path.join(tempRoot, 'client.mjs')).href);
const { createParityApi } = await import(pathToFileURL(path.join(tempRoot, 'parity-api.mjs')).href);
const { contentApi } = await import(pathToFileURL(path.join(tempRoot, 'content-api.mjs')).href);
const contentApiSource = fs.readFileSync(path.join(mobileRoot, 'src/screens/content/content-api.ts'), 'utf8');
const loansPage = Number(/LOANS_PAGE = (\d+)/.exec(contentApiSource)?.[1]);
const loansPageCap = Number(/LOANS_PAGE_CAP = (\d+)/.exec(contentApiSource)?.[1]);

/** Installs the responder on the shared client double and records every path it is asked for. */
function serve(respond) {
  const calls = [];
  apiClient.handler = async (requestPath, init) => {
    calls.push(requestPath);
    return respond(requestPath, init);
  };
  return calls;
}

const pageParam = (requestPath) =>
  Number(new URL(requestPath, 'https://unit.test').searchParams.get('page') ?? 0);

const loanPageUrl = (page) => `/library/requests/my?page=${page}&limit=${loansPage}`;
const rowsFrom = (start, count) => Array.from({ length: count }, (_, i) => ({ id: `loan-${start + i}` }));

test('the loans facade reads /library/requests/my through the shared window and total header', async () => {
  const calls = [];
  const api = createParityApi({
    requestWithMeta: async (requestPath, init) => {
      calls.push({ path: requestPath, init });
      return { data: [{ id: 'loan-0' }], headers: new Headers({ 'X-Total-Count': '7' }), requestId: 'r-1' };
    },
  });
  const page = await api.libraryLoans({ page: 1, limit: 5 });
  assert.equal(calls[0].path, '/library/requests/my?page=1&limit=5');
  assert.equal(page.total, 7);
  assert.equal(page.hasMore, true);
  const whole = await api.libraryLoans();
  assert.equal(calls[1].path, '/library/requests/my', 'no window keeps the bare legacy read');
  assert.equal(whole.hasMore, false);
});

test('the loans read walks windows until a 250-row history is complete and ordered', async () => {
  const calls = serve((requestPath) => {
    const page = pageParam(requestPath);
    return {
      data: rowsFrom(page * loansPage, page < 2 ? loansPage : 50),
      headers: new Headers({ 'X-Total-Count': '250' }),
      requestId: 'r',
    };
  });
  const loans = await contentApi.libraryLoans();
  assert.deepEqual(calls, [loanPageUrl(0), loanPageUrl(1), loanPageUrl(2)]);
  assert.deepEqual(loans.map((row) => row.id), Array.from({ length: 250 }, (_, i) => `loan-${i}`));
});

test('a missing total header keeps reading while pages come back full', async () => {
  const calls = serve((requestPath) => {
    const page = pageParam(requestPath);
    return {
      data: rowsFrom(page * loansPage, page === 0 ? loansPage : 30),
      headers: new Headers(),
      requestId: 'r',
    };
  });
  const loans = await contentApi.libraryLoans();
  assert.equal(calls.length, 2);
  assert.equal(loans.length, loansPage + 30);
});

test('the page cap stops a server that never ends the list', async () => {
  const calls = serve(() => ({
    data: rowsFrom(0, loansPage),
    headers: new Headers(),
    requestId: 'r',
  }));
  const loans = await contentApi.libraryLoans();
  assert.equal(calls.length, loansPageCap, 'requests stop at the declared page cap');
  assert.equal(loans.length, loansPageCap * loansPage);
});

test('a later page failure fails the whole loans read', async () => {
  const calls = serve((requestPath) => {
    if (pageParam(requestPath) === 1) {
      throw Object.assign(new Error('loans down'), { status: 500 });
    }
    return {
      data: rowsFrom(0, loansPage),
      headers: new Headers({ 'X-Total-Count': '250' }),
      requestId: 'r',
    };
  });
  await assert.rejects(contentApi.libraryLoans(), /loans down/);
  assert.equal(calls.length, 2, 'the read stops at the failed window');
});
