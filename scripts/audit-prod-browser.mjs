import { createRequire } from 'node:module';
import { isIP } from 'node:net';

function printUsage() {
  console.log('Usage: node scripts/audit-prod-browser.mjs --target <origin> [--allow-network]');
  console.log('Use a loopback target for local runs. Non-loopback requests require --allow-network.');
  console.log('Set CAMPUS_DIAGNOSTIC_<ROLE>_EMAIL and CAMPUS_DIAGNOSTIC_<ROLE>_PASSWORD for each tested role.');
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
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');

function requiredCredentials(role, credentialKey) {
  const emailName = 'CAMPUS_DIAGNOSTIC_' + credentialKey + '_EMAIL';
  const passwordName = 'CAMPUS_DIAGNOSTIC_' + credentialKey + '_PASSWORD';
  const email = process.env[emailName];
  const password = process.env[passwordName];

  if (!email || !password) {
    console.error('Missing required environment variables: ' + emailName + ', ' + passwordName);
    process.exit(2);
  }
  return { ...role, email, password };
}

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


  const ROLES_TO_TEST = [
    {
      name: 'Sinh viên',
      portal: 'student',
      pages: ['/vi/dashboard', '/vi/dashboard/courses', '/vi/dashboard/grades', '/vi/dashboard/curriculum', '/vi/dashboard/schedule', '/vi/dashboard/thesis']
    },
    {
      name: 'Giảng viên',
      portal: 'lecturer',
      pages: ['/vi/dashboard/lecturer', '/vi/dashboard/thesis', '/vi/dashboard/lecturer/schedule']
    },
    {
      name: 'Trưởng bộ môn',
      portal: 'lecturer',
      pages: ['/vi/dashboard/thesis', '/vi/dashboard/lecturer']
    },
    {
      name: 'Trưởng khoa',
      portal: 'dean',
      pages: ['/vi/dashboard/dean', '/vi/dashboard/thesis']
    },
    {
      name: 'Admin',
      portal: 'admin',
      pages: ['/vi/admin', '/vi/admin/users', '/vi/admin/courses', '/vi/admin/departments']
    }
  ];

  const credentialKeys = ['STUDENT', 'LECTURER', 'DEPARTMENT_HEAD', 'DEAN', 'ADMIN'];
  const roles = ROLES_TO_TEST.map((role, index) => requiredCredentials(role, credentialKeys[index]));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await guardBrowserTraffic(context);
  const page = await context.newPage();

  try {
    for (const role of roles) {
      console.log('\n======================================================');
      console.log('TESTING ROLE: ' + role.name + ' - Portal: ' + role.portal);
      console.log('======================================================');

      const requests = [];
      const onRequest = req => {
        requests.push({ url: req.url(), method: req.method(), start: performance.now() });
      };
      const onResponse = res => {
        const item = requests.find(r => r.url === res.url() && !r.end);
        if (item) {
          item.end = performance.now();
          item.status = res.status();
          item.duration = Math.round(item.end - item.start);
        }
      };

      page.on('request', onRequest);
      page.on('response', onResponse);

      // 1. Login with portal query
      const loginUrl = `${BASE}/vi/login?portal=${role.portal}`;
      const t0 = performance.now();
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      console.log(`1. Login page DOM ready: ${Math.round(performance.now() - t0)}ms`);

      // 2. Submit credentials
      await page.fill('input[type="email"], input[name="email"]', role.email);
      await page.fill('input[type="password"], input[name="password"]', role.password);
      
      const tSubmit = performance.now();
      await page.click('button[type="submit"]');
      
      // Wait for URL to leave login page
      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 20000 });
      const loginDuration = Math.round(performance.now() - tSubmit);
      console.log(`2. Login + Auth redirect took: ${loginDuration}ms -> path: ${new URL(page.url()).pathname}`);

      // Wait 1.5s for initial dashboard hydration
      await page.waitForTimeout(1500);

      // 3. Test each page for this role
      for (const targetPath of role.pages) {
        const tNav = performance.now();
        await page.goto(`${BASE}${targetPath}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500); // allow client-side hydration & query to finish
        const pageLoadTime = Math.round(performance.now() - tNav);

        const pageTitle = await page.title();
        console.log(`   Page ${targetPath}: ${pageLoadTime}ms | "${pageTitle}"`);
      }

      // Top slowest API calls for this entire session
      const apiReqs = requests.filter(r => r.url.includes('/api/'));
      apiReqs.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      console.log(`\n   Total API calls: ${apiReqs.length}. Slowest 5 API calls:`);
      for (const r of apiReqs.slice(0, 5)) {
        console.log(`     [${r.status || '?'}] ${r.duration || '?'}ms | ${r.method} ${new URL(r.url).pathname}`);
      }

      page.off('request', onRequest);
      page.off('response', onResponse);

      // Clear session for next role
      await context.clearCookies();
      await page.evaluate(() => localStorage.clear()).catch(() => {});
    }
  } catch (err) {
    console.error('Audit failed: ' + err.name);
  } finally {
    await browser.close();
    process.exit(0);
  }
}

run();
