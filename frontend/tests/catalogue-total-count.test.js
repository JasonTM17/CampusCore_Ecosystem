const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadApi(relativePath, api) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loadedModule = { exports: {} };
  const mockedRequire = specifier => {
    if (specifier === '@/lib/api') return { __esModule: true, default: api };
    if (specifier === '@/lib/upload-validation') return { assertUploadFile() {} };
    return require(specifier);
  };
  Function('module', 'exports', 'require', output)(loadedModule, loadedModule.exports, mockedRequire);
  return loadedModule.exports;
}

const clients = [
  { name: 'careers', file: 'src/lib/careers-api.ts', exportName: 'careersApi', method: 'opportunitiesPage' },
  { name: 'library', file: 'src/lib/library-api.ts', exportName: 'libraryApi', method: 'cataloguePage' },
];

const cases = [
  { header: '', expected: null },
  { header: '  ', expected: null },
  { header: 'abc', expected: null },
  { header: '0', expected: 0 },
  { header: '37', expected: 37 },
];

for (const clientCase of clients) {
  for (const { header, expected } of cases) {
    test(`${clientCase.name} X-Total-Count ${JSON.stringify(header)} parses as ${expected}`, async () => {
      const { [clientCase.exportName]: client } = loadApi(clientCase.file, {
        get: async () => ({ data: [{ id: 'row-1' }], headers: { 'x-total-count': header } }),
      });

      const result = await client[clientCase.method](undefined, 0, 20);
      assert.equal(result.total, expected);
    });
  }
}
