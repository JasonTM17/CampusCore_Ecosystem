const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/lib/public-seo.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleRecord = { exports: {} };
Function('module', 'exports', compiled)(moduleRecord, moduleRecord.exports);
const { buildNewsListMetadata, buildNewsArticleMetadata, shapePublicSitemap } = moduleRecord.exports;
const apiModule = require('node:module');
const apiServerSource = fs.readFileSync(path.join(root, 'src/lib/public-api-server.ts'), 'utf8');
const apiServerCompiled = ts.transpileModule(apiServerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const apiServerRecord = { exports: {} };
Function('module', 'exports', 'require', apiServerCompiled)(
  apiServerRecord,
  apiServerRecord.exports,
  (specifier) => {
    if (specifier === '@/lib/site') return { getSiteUrl: () => siteUrl };
    if (specifier === '@/lib/public-api-url') {
      return { resolvePublicApiBaseUrl: (configured) => configured?.trim() || '/api/v1' };
    }
    if (specifier === 'next/headers' || specifier === '@/lib/surfaces') return {};
    return apiModule.createRequire(__filename)(specifier);
  },
);
const { buildPublicApiUrl } = apiServerRecord.exports;

const siteUrl = 'https://www.campusute.io.vn';
const newsCopy = {
  en: {
    title: 'Campus news',
    subtitle: 'Published announcements from the university.',
    notFoundTitle: 'Story unavailable',
    notFoundBody: 'This story is not published or no longer exists.',
  },
  vi: {
    title: 'Tin tức trường',
    subtitle: 'Thông báo đã xuất bản của nhà trường.',
    notFoundTitle: 'Bài viết không khả dụng',
    notFoundBody: 'Bài viết này chưa xuất bản hoặc không còn tồn tại.',
  },
};

test('news list metadata is localized and includes canonical, hreflang, OpenGraph and Twitter tags', () => {
  const metadata = buildNewsListMetadata('vi', siteUrl, newsCopy.vi);

  assert.equal(metadata.title, 'Tin tức trường');
  assert.equal(metadata.description, newsCopy.vi.subtitle);
  assert.equal(metadata.alternates.canonical, `${siteUrl}/vi/news`);
  assert.equal(metadata.alternates.languages['en-US'], `${siteUrl}/en/news`);
  assert.equal(metadata.alternates.languages['vi-VN'], `${siteUrl}/vi/news`);
  assert.equal(metadata.openGraph.type, 'website');
  assert.equal(metadata.openGraph.locale, 'vi_VN');
  assert.equal(metadata.twitter.card, 'summary_large_image');
  assert.equal(metadata.openGraph.images[0].url, `${siteUrl}/social-image/vi`);
});

test('published news article metadata uses only public editorial fields', () => {
  const metadata = buildNewsArticleMetadata(
    'en',
    siteUrl,
    '/news/annual-review',
    newsCopy.en,
    {
      title: 'Annual review',
      summary: '<p>Highlights from the year &amp; campus.</p>',
      content: 'Long body text',
      coverImageUrl: '/uploads/annual-review.jpg',
      status: 'PUBLISHED',
      publishedBy: 'private-person@example.test',
      authorId: 'private-author-id',
    },
  );

  assert.equal(metadata.title, 'Annual review');
  assert.equal(metadata.description, 'Highlights from the year & campus.');
  assert.equal(metadata.alternates.canonical, `${siteUrl}/en/news/annual-review`);
  assert.equal(metadata.alternates.languages['vi-VN'], `${siteUrl}/vi/news/annual-review`);
  assert.equal(metadata.openGraph.type, 'article');
  assert.equal(metadata.openGraph.images[0].url, `${siteUrl}/uploads/annual-review.jpg`);
  assert.equal(metadata.openGraph.publishedBy, undefined);
  assert.equal(metadata.authors, undefined);
  assert.doesNotMatch(JSON.stringify(metadata), /private-person|private-author/);
});

test('missing and unpublished article metadata uses a localized noindex fallback', () => {
  const missing = buildNewsArticleMetadata(
    'vi', siteUrl, '/news/missing', newsCopy.vi, null,
  );
  const draft = buildNewsArticleMetadata(
    'en', siteUrl, '/news/draft', newsCopy.en, { title: 'Draft', status: 'DRAFT' },
  );

  assert.equal(missing.title, newsCopy.vi.notFoundTitle);
  assert.equal(missing.description, newsCopy.vi.notFoundBody);
  assert.deepEqual(missing.robots, { index: false, follow: false });
  assert.equal(draft.title, newsCopy.en.notFoundTitle);
  assert.deepEqual(draft.robots, { index: false, follow: false });
});

test('invalid or unsafe article covers fall back to the localized social image', () => {
  for (const coverImageUrl of ['https://', 'javascript:alert(1)', '//attacker.example/image.png', 'https://user:pass@example.test/image.png']) {
    const metadata = buildNewsArticleMetadata(
      'en', siteUrl, '/news/story', newsCopy.en,
      { title: 'Story', status: 'PUBLISHED', coverImageUrl },
    );
    assert.equal(metadata.openGraph.images[0].url, `${siteUrl}/social-image/en`);
  }
});

test('sitemap shapes only published news and public docs, with localized alternates and static fallback', () => {
  const sitemap = shapePublicSitemap(
    siteUrl,
    {
      data: [
        { id: 'news-id', slug: 'published-story', status: 'PUBLISHED', publishAt: '2026-10-10T00:00:00Z' },
        { id: 'draft-id', slug: 'draft-story', status: 'DRAFT' },
        { id: 'archived-id', slug: 'archived-story', status: 'PUBLISHED', archivedAt: '2026-10-11T00:00:00Z' },
        { id: 'expired-id', slug: 'expired-story', status: 'PUBLISHED', expiresAt: '2026-10-01T00:00:00Z' },
      ],
    },
    { data: [{ slug: 'published-guide', publishedAt: '2026-10-12T00:00:00Z' }] },
    new Date('2026-10-29T00:00:00Z'),
  );
  const urls = sitemap.map((entry) => entry.url);
  const story = sitemap.find((entry) => entry.url.endsWith('/vi/news/published-story'));
  const guide = sitemap.find((entry) => entry.url.endsWith('/vi/docs/published-guide'));

  assert.ok(urls.includes(`${siteUrl}/`));
  assert.ok(urls.includes(`${siteUrl}/vi`));
  assert.ok(urls.includes(`${siteUrl}/en`));
  assert.ok(urls.includes(`${siteUrl}/vi/news`));
  assert.ok(urls.includes(`${siteUrl}/en/docs`));
  assert.ok(story);
  assert.ok(guide);
  assert.equal(story.alternates.languages['en-US'], `${siteUrl}/en/news/published-story`);
  assert.equal(story.lastModified.toISOString(), '2026-10-10T00:00:00.000Z');
  assert.equal(urls.some((url) => /\/login(?:\/|$)/.test(url)), false);
  assert.equal(urls.some((url) => /draft-story|archived-story|expired-story/.test(url)), false);

  const fallback = shapePublicSitemap(siteUrl, null, null, new Date('2026-10-29T00:00:00Z'));
  assert.ok(fallback.some((entry) => entry.url === `${siteUrl}/vi/news`));
  assert.ok(fallback.some((entry) => entry.url === `${siteUrl}/en/docs`));
  assert.equal(fallback.length, 7);
});

test('server-side public API URLs use the configured API base and encode each path segment', () => {
  const url = buildPublicApiUrl(
    '/api/v1', siteUrl, ['announcements', 'public', 'slug/with/slash'], { page: '1' },
  );

  assert.equal(url.origin, siteUrl);
  assert.equal(url.pathname, '/api/v1/announcements/public/slug%2Fwith%2Fslash');
  assert.equal(url.searchParams.get('page'), '1');
  const configuredApi = buildPublicApiUrl(
    'https://api.campusute.io.vn/custom/v1/',
    siteUrl,
    ['announcements', 'public', 'story'],
  );
  assert.equal(configuredApi.origin, 'https://api.campusute.io.vn');
  assert.equal(configuredApi.pathname, '/custom/v1/announcements/public/story');
  assert.match(apiServerSource, /resolvePublicApiBaseUrl\(process\.env\.NEXT_PUBLIC_API_URL\)/);
  assert.doesNotMatch(apiServerSource, /headers\(\)|headers\(\)\.get\(['"]host/);
  assert.throws(() => buildPublicApiUrl('/api/v1', siteUrl, ['announcements', 'public', '..']), /Invalid public API path segment/);
  assert.throws(() => buildPublicApiUrl('/api/v1', siteUrl, ['announcements', 'public', '.']), /Invalid public API path segment/);
  assert.throws(() => buildPublicApiUrl('https://user:pass@api.example.test/v1', siteUrl, ['news']), /Invalid public API base URL/);
  assert.throws(() => buildPublicApiUrl('javascript:alert(1)', siteUrl, ['news']), /Invalid public API base URL/);
});

test('sitemap performs only the two bounded public-list API requests', () => {
  const route = fs.readFileSync(path.join(root, 'src/app/sitemap.ts'), 'utf8');
  assert.match(route, /fetchPublicApiJson\(\['announcements', 'public'\], \{ page: '1', limit: '50' \}\)/);
  assert.match(route, /fetchPublicApiJson\(\['public', 'docs'\], \{ page: '1', limit: '50' \}\)/);
  assert.equal((route.match(/fetchPublicApiJson\(/g) ?? []).length, 2);
});
