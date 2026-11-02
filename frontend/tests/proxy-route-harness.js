const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

/**
 * Transpile a TypeScript module and execute it with a tiny CommonJS loader.
 * Alias imports are resolved against src/ unless a stub is supplied, so a test
 * can load a real route module together with the real proxy helpers.
 */
function compileFile(relativePath, options = {}) {
  const processStub = options.process ?? globalThis.process;
  const stubs = options.stubs ?? {};
  const globals = options.globals ?? {};
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const record = { exports: {} };
  const requireShim = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (id.startsWith('@/')) {
      const base = `src/${id.slice(2)}`;
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        if (fs.existsSync(path.join(ROOT, base + suffix))) {
          return compileFile(base + suffix, { process: processStub, stubs, globals });
        }
      }
    }
    return require(id);
  };

  const names = ['process', ...Object.keys(globals)];
  const values = [processStub, ...Object.values(globals)];
  Function('module', 'exports', 'require', ...names, output)(
    record, record.exports, requireShim, ...values,
  );
  return record.exports;
}

function processFor(env) {
  return {
    env: {
      JAVA_API_ORIGIN: 'http://java.test',
      NODE_ENV: 'test',
      ...env,
    },
  };
}

function loadApiStack(fetchImpl, env = {}) {
  const processStub = processFor(env);
  const surfaces = compileFile('src/lib/surfaces.ts', { process: processStub });
  const proxyUrl = compileFile('src/lib/proxy-url.ts', { process: processStub });
  const origin = compileFile('src/lib/proxy-request-origin.ts', {
    process: processStub,
    stubs: { '@/lib/surfaces': surfaces },
  });
  const route = compileFile('src/app/api/v1/[...path]/route.ts', {
    process: processStub,
    stubs: {
      '@/lib/proxy-url': proxyUrl,
      '@/lib/proxy-request-origin': origin,
      '@/lib/surfaces': surfaces,
    },
    globals: { fetch: fetchImpl },
  });
  return { route, proxyUrl, origin, surfaces };
}

function loadDocsStack(fetchImpl, env = {}) {
  const processStub = processFor(env);
  const proxyUrl = compileFile('src/lib/proxy-url.ts', { process: processStub });
  const route = compileFile('src/app/api/docs/[[...path]]/route.ts', {
    process: processStub,
    stubs: { '@/lib/proxy-url': proxyUrl },
    globals: { fetch: fetchImpl },
  });
  return { route, proxyUrl };
}

function loadHealthStack(fetchImpl, env = {}) {
  const processStub = processFor(env);
  const proxyUrl = compileFile('src/lib/proxy-url.ts', { process: processStub });
  return compileFile('src/app/health/route.ts', {
    process: processStub,
    stubs: { '@/lib/proxy-url': proxyUrl },
    globals: { fetch: fetchImpl },
  });
}

function loadSiteAppearanceStack(fetchImpl, deps = {}) {
  const processStub = processFor({});
  class TestNextResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.headers = new Headers(init.headers);
    }

    static json(payload, init = {}) {
      return new TestNextResponse(JSON.stringify(payload), init);
    }

    async json() {
      return JSON.parse(this.body);
    }
  }

  return compileFile('src/app/api/site-appearance/route.ts', {
    process: processStub,
    stubs: {
      'next/server': {
        NextRequest: class {},
        NextResponse: TestNextResponse,
      },
      '@/lib/site-appearance': { DEFAULT_SITE_APPEARANCE: { accent: 'ute-yellow' } },
      '@/lib/site-appearance-store': {
        readSavedSiteAppearance: async () => null,
        writeSiteAppearance: async () => ({ accent: 'river-blue' }),
        ...deps.store,
      },
      '@/lib/session-hint': {
        hasCsrfSessionHint: (cookie) => /(?:^|; )cc_csrf=/.test(cookie ?? ''),
        ...deps.sessionHint,
      },
      '@/lib/proxy-url': {
        resolveJavaApiOrigin: () => 'http://java.test',
        ...deps.proxyUrl,
      },
    },
    globals: { fetch: fetchImpl },
  });
}

function setHeader(headers, name, value) {
  if (Array.isArray(value)) {
    for (const item of value) headers.append(name, item);
  } else if (value !== undefined && value !== null) {
    headers.set(name, String(value));
  }
}

function makeRequest({
  method = 'POST',
  host = 'localhost:3000',
  protocol = 'http:',
  search = '',
  headers = {},
} = {}) {
  const values = new Headers();
  if (host !== null) values.set('host', host);
  for (const [name, value] of Object.entries(headers)) setHeader(values, name, value);
  return {
    method,
    headers: values,
    nextUrl: { protocol, search },
    signal: new AbortController().signal,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({}),
  };
}

function contextFor(pathArray = []) {
  return { params: Promise.resolve({ path: pathArray }) };
}

function createFetch(responseFactory = () => new Response('{"ok":true}', {
  headers: { 'content-type': 'application/json' },
})) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: typeof url === 'string' ? url : url.toString(), options });
    return responseFactory(url, options, calls.length - 1);
  };
  return { fetch, calls };
}

module.exports = {
  compileFile,
  loadApiStack,
  loadDocsStack,
  loadHealthStack,
  loadSiteAppearanceStack,
  makeRequest,
  contextFor,
  createFetch,
};
