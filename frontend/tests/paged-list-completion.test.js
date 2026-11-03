const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTsModule(relativePath, stubs = {}) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const resolve = (specifier) =>
    Object.prototype.hasOwnProperty.call(stubs, specifier)
      ? stubs[specifier]
      : require(specifier);
  Function('module', 'exports', 'require', output)(moduleRecord, moduleRecord.exports, resolve);
  return moduleRecord.exports;
}

const arrayListPage = loadTsModule('src/lib/array-list-page.ts');

function loadApi(relativePath, api) {
  return loadTsModule(relativePath, {
    '@/lib/api': { __esModule: true, default: api },
    '@/lib/array-list-page': arrayListPage,
    '@/lib/upload-validation': { assertUploadFile() {} },
  });
}

const clients = [
  {
    name: 'library loan history',
    file: 'src/lib/library-api.ts',
    exportName: 'libraryApi',
    url: '/library/requests/my',
    header: 'missing',
    call: (client) => client.myLoans(),
  },
  {
    name: 'learning assignment roster',
    file: 'src/lib/learning-api.ts',
    exportName: 'learningApi',
    url: '/learning/staff/assignments/assignment-1/roster',
    header: 'invalid',
    call: (client) => client.staffRoster('assignment-1'),
  },
];

/**
 * Fake fetch layer for the paged list contract: the server windows by
 * `page`/`limit`, defaulting to page zero and 100 rows when the caller sends
 * nothing, and answers #rows with `x-total-count`.
 */
function pagedServer({ rowCount, header = 'valid', endless = false, failOnPage }) {
  const rows = endless
    ? []
    : Array.from({ length: rowCount }, (_, index) => ({ id: `row-${index + 1}` }));
  const requests = [];
  const get = async (url, config) => {
    const params = config?.params ?? {};
    const page = Number.isInteger(params.page) ? params.page : 0;
    const limit = Number.isInteger(params.limit) ? params.limit : 100;
    requests.push({ url, params: { ...params } });
    if (failOnPage !== undefined && page === failOnPage) {
      throw new Error(`page ${page} failed`);
    }
    const data = endless
      ? Array.from({ length: limit }, (_, index) => ({ id: `row-${page * limit + index + 1}` }))
      : rows.slice(page * limit, page * limit + limit);
    const headers = header === 'valid'
      ? { 'x-total-count': String(endless ? 100000 : rows.length) }
      : header === 'invalid' ? { 'x-total-count': 'not-a-count' } : {};
    return { data, headers };
  };
  return { rows, requests, get };
}

function ids(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => `row-${from + index}`);
}

for (const clientCase of clients) {
  test(`${clientCase.name} loads 250 rows served as three pages in order`, async () => {
    const server = pagedServer({ rowCount: 250 });
    const client = loadApi(clientCase.file, { get: server.get })[clientCase.exportName];

    const rows = await clientCase.call(client);

    assert.deepEqual(rows.map((row) => row.id), ids(1, 250));
    assert.deepEqual(server.requests, [0, 1, 2].map((page) => ({
      url: clientCase.url,
      params: { page, limit: 100 },
    })));
  });

  test(`${clientCase.name} keeps reading while X-Total-Count is ${clientCase.header}`, async () => {
    const server = pagedServer({ rowCount: 230, header: clientCase.header });
    const client = loadApi(clientCase.file, { get: server.get })[clientCase.exportName];

    const rows = await clientCase.call(client);

    assert.deepEqual(rows.map((row) => row.id), ids(1, 230));
    assert.deepEqual(server.requests.map((request) => request.params.page), [0, 1, 2]);
  });

  test(`${clientCase.name} does one request when the first page is already short`, async () => {
    const server = pagedServer({ rowCount: 40 });
    const client = loadApi(clientCase.file, { get: server.get })[clientCase.exportName];

    const rows = await clientCase.call(client);

    assert.deepEqual(rows.map((row) => row.id), ids(1, 40));
    assert.deepEqual(server.requests, [{ url: clientCase.url, params: { page: 0, limit: 100 } }]);
  });

  test(`${clientCase.name} stops a looping server at the 50-page safety cap`, async () => {
    const server = pagedServer({ endless: true, header: clientCase.header });
    const client = loadApi(clientCase.file, { get: server.get })[clientCase.exportName];

    const rows = await clientCase.call(client);

    assert.equal(server.requests.length, 50, 'a bad header cannot request forever');
    assert.deepEqual(
      server.requests.map((request) => request.params.page),
      Array.from({ length: 50 }, (_, page) => page),
    );
    assert.equal(rows.length, 5000);
    assert.equal(rows[0].id, 'row-1');
    assert.equal(rows.at(-1).id, 'row-5000');
  });

  test(`${clientCase.name} rejects when a trusted total exceeds the page budget`, async () => {
    const server = pagedServer({ endless: true });
    const client = loadApi(clientCase.file, { get: server.get })[clientCase.exportName];

    await assert.rejects(clientCase.call(client), /page limit/);
    assert.equal(server.requests.length, 50);
  });

  test(`${clientCase.name} propagates a later-page error instead of returning a partial list`, async () => {
    const server = pagedServer({ rowCount: 230, failOnPage: 1 });
    const client = loadApi(clientCase.file, { get: server.get })[clientCase.exportName];

    await assert.rejects(clientCase.call(client), /page 1 failed/);
    assert.deepEqual(server.requests.map((request) => request.params.page), [0, 1]);
  });
}
