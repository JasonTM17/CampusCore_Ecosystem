import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const screenshotDir = path.join(repoRoot, 'docs', 'assets', 'screenshots');
const playwrightPath = path.join(
  repoRoot,
  'frontend',
  'node_modules',
  'playwright',
  'index.mjs',
);
const baseUrl = process.env.GITHUB_SCREENSHOT_BASE_URL ?? 'http://127.0.0.1';

const shots = [
  {
    path: '/en',
    name: 'campuscore-home-en.png',
    readyText: 'CampusCore',
  },
  {
    path: '/vi',
    name: 'campuscore-home-vi.png',
    readyText: 'CampusCore',
  },
];

const { chromium } = await import(pathToFileURL(playwrightPath).href);

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });

  await page.addStyleTag({
    content: `
      * {
        scroll-behavior: auto !important;
      }
      html {
        scrollbar-gutter: stable;
      }
    `,
  });

  for (const shot of shots) {
    const url = new URL(shot.path, baseUrl);
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.getByText(shot.readyText).first().waitFor({ timeout: 30_000 });
    await page.screenshot({
      path: path.join(screenshotDir, shot.name),
      type: 'png',
      fullPage: false,
    });
    console.log(`Captured ${path.join('docs', 'assets', 'screenshots', shot.name)}`);
  }
} finally {
  await browser.close();
}
