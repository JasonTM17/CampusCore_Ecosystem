import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const assetDir = path.join(repoRoot, 'docs', 'assets');
const sourceSvg = path.join(assetDir, 'github-social-preview.svg');
const outputPng = path.join(assetDir, 'github-social-preview.png');
const playwrightPath = path.join(
  repoRoot,
  'frontend',
  'node_modules',
  'playwright',
  'index.mjs',
);

const { chromium } = await import(pathToFileURL(playwrightPath).href);

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });

  await page.goto(pathToFileURL(sourceSvg).href);
  await page.screenshot({
    path: outputPng,
    type: 'png',
  });

  console.log(`Rendered ${path.relative(repoRoot, outputPng)}`);
} finally {
  await browser.close();
}
