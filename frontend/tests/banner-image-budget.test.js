const assert = require('node:assert/strict');
const test = require('node:test');

const checkerPromise = import('../../scripts/check-public-image-budget.mjs');

test('extracts JPEG and WebP references from banner paths', async () => {
  const { extractBannerReferences } = await checkerPromise;
  assert.deepEqual(
    extractBannerReferences('src="/images/banners/campus.jpg" srcSet="/images/banners/campus.webp"'),
    ['/images/banners/campus.jpg', '/images/banners/campus.webp'],
  );
});

test('accepts a referenced rendition at the byte and dimension limits', async () => {
  const { PUBLIC_IMAGE_BUDGET, validateBannerBudget } = await checkerPromise;
  const assets = new Map([
    ['campus.jpg', { bytes: 900_000 }],
    ['campus.webp', {
      bytes: PUBLIC_IMAGE_BUDGET.maxBytes,
      width: PUBLIC_IMAGE_BUDGET.maxLongEdge,
      height: 900,
    }],
  ]);

  assert.deepEqual(
    validateBannerBudget(['/images/banners/campus.jpg', '/images/banners/campus.webp'], assets),
    { errors: [], renditionCount: 1 },
  );
});

test('fails when a referenced banner file is missing', async () => {
  const { validateBannerBudget } = await checkerPromise;
  const result = validateBannerBudget(['/images/banners/missing.png'], new Map());

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Reference points to missing file/);
});

test('fails when a referenced rendition exceeds the byte budget', async () => {
  const { PUBLIC_IMAGE_BUDGET, validateBannerBudget } = await checkerPromise;
  const assets = new Map([
    ['campus.jpg', { bytes: 900_000 }],
    ['campus.webp', {
      bytes: PUBLIC_IMAGE_BUDGET.maxBytes + 1,
      width: 1376,
      height: 768,
    }],
  ]);
  const result = validateBannerBudget(['/images/banners/campus.jpg'], assets);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /limit is 307200 bytes/);
});

test('fails when a referenced rendition exceeds the long-edge budget', async () => {
  const { PUBLIC_IMAGE_BUDGET, validateBannerBudget } = await checkerPromise;
  const assets = new Map([
    ['campus.jpg', { bytes: 900_000 }],
    ['campus.webp', {
      bytes: 100_000,
      width: PUBLIC_IMAGE_BUDGET.maxLongEdge + 1,
      height: 768,
    }],
  ]);
  const result = validateBannerBudget(['/images/banners/campus.webp'], assets);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /limit is 1600 px/);
});

test('keeps a WebP source paired with its JPEG fallback in the preset tray', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '../src/components/announcements/AnnouncementEditModal.tsx'),
    'utf8',
  );

  assert.match(source, /<source[\s\S]*?banner\.url\.replace\(\/\\\.jpg\$\/i, '\.webp'\)[\s\S]*?<img[\s\S]*?src=\{banner\.url\}/);
  assert.match(source, /width=\{banner\.width\}[\s\S]*?height=\{banner\.height\}/);
});
