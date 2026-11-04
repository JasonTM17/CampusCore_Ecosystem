const test = require('node:test');
const assert = require('node:assert/strict');

const { compileFile } = require('./proxy-route-harness');

const SITE_URL = 'https://campus.example.test';

function createPublicApi({ news = 0, docs = 0, fail = () => false } = {}) {
  const calls = [];
  const newsRows = Array.from({ length: news }, (_, index) => ({
    id: `news-${index}`,
    slug: `story-${index}`,
    status: 'PUBLISHED',
    updatedAt: '2026-10-01T00:00:00Z',
  }));
  const docRows = Array.from({ length: docs }, (_, index) => ({
    slug: `guide-${index}`,
    publishedAt: '2026-10-01T00:00:00Z',
  }));

  const fetchPublicApiJson = async (segments, params = {}) => {
    const key = segments.join('/');
    const page = Number(params.page);
    const limit = Number(params.limit);
    calls.push({ key, params: { ...params } });
    if (fail(key, page)) return null;
    const rows = key === 'announcements/public' ? newsRows : docRows;
    const total = rows.length;
    return {
      data: rows.slice((page - 1) * limit, page * limit),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  };

  return { fetchPublicApiJson, calls };
}

function loadSitemapRoute(fetchPublicApiJson) {
  const publicSeo = compileFile('src/lib/public-seo.ts');
  return compileFile('src/app/sitemap.ts', {
    stubs: {
      '@/lib/public-api-server': { fetchPublicApiJson },
      '@/lib/public-seo': publicSeo,
      '@/lib/site': { getSiteUrl: () => SITE_URL },
    },
  });
}

test('the sitemap pages through every published news item and document', async () => {
  const api = createPublicApi({ news: 250, docs: 250 });
  const route = loadSitemapRoute(api.fetchPublicApiJson);

  const entries = await route.default();
  const urls = entries.map((entry) => entry.url);

  assert.equal(urls.filter((url) => url.includes('/vi/news/story-')).length, 250);
  assert.equal(urls.filter((url) => url.includes('/vi/docs/guide-')).length, 250);

  const newsCalls = api.calls.filter((call) => call.key === 'announcements/public');
  assert.deepEqual(newsCalls.map((call) => call.params.page), ['1', '2', '3']);
  assert.equal(newsCalls[0].params.limit, '100');
  const docsCalls = api.calls.filter((call) => call.key === 'public/docs');
  assert.deepEqual(docsCalls.map((call) => call.params.page), ['1', '2', '3']);

  assert.ok(urls.includes(`${SITE_URL}/`));
  assert.ok(urls.includes(`${SITE_URL}/vi/news`));
  assert.ok(urls.includes(`${SITE_URL}/en/docs`));
});

test('a failing later page keeps the collected rows and every static route', async () => {
  const api = createPublicApi({
    news: 250,
    docs: 10,
    fail: (key, page) => key === 'announcements/public' && page === 2,
  });
  const route = loadSitemapRoute(api.fetchPublicApiJson);

  const entries = await route.default();
  const urls = entries.map((entry) => entry.url);

  assert.equal(urls.filter((url) => url.includes('/vi/news/story-')).length, 100);
  assert.equal(urls.filter((url) => url.includes('/vi/docs/guide-')).length, 10);
  assert.ok(urls.includes(`${SITE_URL}/vi/news`));
  assert.ok(urls.includes(`${SITE_URL}/vi/docs`));
});

test('a failing first page still emits the static routes', async () => {
  const api = createPublicApi({
    news: 250,
    docs: 250,
    fail: () => true,
  });
  const route = loadSitemapRoute(api.fetchPublicApiJson);

  const urls = (await route.default()).map((entry) => entry.url);

  assert.ok(urls.includes(`${SITE_URL}/`));
  assert.ok(urls.includes(`${SITE_URL}/vi/news`));
  assert.ok(urls.includes(`${SITE_URL}/en/news`));
  assert.equal(urls.filter((url) => url.includes('/vi/news/story-')).length, 0);
});

test('paging stops at the bounded maximum instead of walking a huge list forever', async () => {
  const api = createPublicApi({ news: 2500 });
  const route = loadSitemapRoute(api.fetchPublicApiJson);

  const urls = (await route.default()).map((entry) => entry.url);

  assert.equal(api.calls.filter((call) => call.key === 'announcements/public').length, 20);
  assert.equal(urls.filter((url) => url.includes('/vi/news/story-')).length, 2000);
});
