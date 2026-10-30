import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function printUsage() {
  console.log('Usage: node scripts/diagnose-login.mjs --target <origin> [--allow-network]');
  console.log('Use a loopback target for local runs. Non-loopback requests require --allow-network.');
  console.log('Set CAMPUS_DIAGNOSTIC_STUDENT_EMAIL and CAMPUS_DIAGNOSTIC_STUDENT_PASSWORD for the login probe.');
}

function isLoopback(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || (isIP(normalized) === 4 && normalized.startsWith('127.'));
}

function parseTargetOptions(args) {
  let targetValue;
  let allowNetwork = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      printUsage();
      process.exit(0);
    }
    if (argument === '--target') {
      const value = args[index + 1];
      if (!value || value.startsWith('--') || targetValue) {
        console.error('Provide exactly one value for --target.');
        printUsage();
        process.exit(2);
      }
      targetValue = value;
      index += 1;
      continue;
    }
    if (argument === '--allow-network') {
      allowNetwork = true;
      continue;
    }
    console.error('Unknown option.');
    printUsage();
    process.exit(2);
  }

  if (!targetValue) {
    console.error('An explicit --target origin is required.');
    printUsage();
    process.exit(2);
  }

  let url;
  try {
    url = new URL(targetValue);
  } catch {
    console.error('--target must be a valid HTTP or HTTPS origin.');
    printUsage();
    process.exit(2);
  }

  if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash) {
    console.error('--target must be an HTTP or HTTPS origin without credentials, path, query, or fragment.');
    printUsage();
    process.exit(2);
  }

  if (!isLoopback(url.hostname) && !allowNetwork) {
    console.error('Non-loopback targets require --allow-network.');
    printUsage();
    process.exit(2);
  }

  return { baseUrl: url.origin, allowNetwork };
}

const targetOptions = parseTargetOptions(process.argv.slice(2));
const BASE = targetOptions.baseUrl;
const emailName = 'CAMPUS_DIAGNOSTIC_STUDENT_EMAIL';
const passwordName = 'CAMPUS_DIAGNOSTIC_STUDENT_PASSWORD';
const credentials = { email: process.env[emailName], password: process.env[passwordName] };
if (!credentials.email || !credentials.password) {
  console.error(`Missing required environment variables: ${emailName}, ${passwordName}`);
  process.exit(2);
}
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const artifactDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../artifacts/verification/diagnostics');

async function guardBrowserTraffic(context) {
  if (targetOptions.allowNetwork) return;

  await context.route('**/*', (route) => {
    try {
      if (isLoopback(new URL(route.request().url()).hostname)) return route.continue();
    } catch {
      // Block malformed or non-HTTP requests when network access was not authorized.
    }
    return route.abort();
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await guardBrowserTraffic(context);
  const page = await context.newPage();

  page.on('request', req => {
    if (req.url().includes('/api/')) {
      console.log(`-> REQ: ${req.method()} ${new URL(req.url()).pathname}`);
    }
  });

  page.on('response', res => {
    if (res.url().includes('/api/')) {
      console.log(`<- RES: [${res.status()}] ${new URL(res.url()).pathname}`);
    }
  });

  try {
    console.log('1. Navigating to login...');
    const t0 = performance.now();
    await page.goto(`${BASE}/vi/login?portal=student`, { waitUntil: 'domcontentloaded' });
    console.log(`   Page loaded in: ${Math.round(performance.now() - t0)}ms`);

    // Wait for the form to be visible and filled
    await page.waitForSelector('button[type="submit"]');

    console.log('2. Filling credentials and submitting...');
    await page.fill('#email', credentials.email);
    await page.fill('#password', credentials.password);
    const tSubmit = performance.now();
    await page.click('button[type="submit"]');

    console.log('3. Waiting for URL to become dashboard...');
    await page.waitForURL(url => url.pathname.includes('/dashboard'), { timeout: 15000 });
    console.log(`   Login + Navigation completed in: ${Math.round(performance.now() - tSubmit)}ms`);
    console.log('   Final path:', new URL(page.url()).pathname);

    // Wait 2s for dashboard queries
    await page.waitForTimeout(3000);

    const title = await page.title();
    console.log('   Dashboard title:', title);

    await mkdir(artifactDirectory, { recursive: true });
    const screenshotPath = resolve(artifactDirectory, 'diagnose-login.png');
    await page.screenshot({ path: screenshotPath });
    console.log('   Screenshot saved: artifacts/verification/diagnostics/diagnose-login.png');

  } catch (err) {
    console.error('Browser diagnostic failed: ' + err.name);
  } finally {
    await browser.close();
  }
}

run();
