import { createRequire } from 'node:module';
import { isIP } from 'node:net';

function printUsage() {
  console.log('Usage: node scripts/benchmark-all-roles.mjs --target <origin> [--allow-network]');
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

function requiredCredentials(role) {
  const emailName = `CAMPUS_DIAGNOSTIC_${role.credentialKey}_EMAIL`;
  const passwordName = `CAMPUS_DIAGNOSTIC_${role.credentialKey}_PASSWORD`;
  const email = process.env[emailName];
  const password = process.env[passwordName];

  if (!email || !password) {
    console.error(`Missing required environment variables: ${emailName}, ${passwordName}`);
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
  const ROLES = [
    {
      name: 'Sinh viên',
      credentialKey: 'STUDENT',
      portal: 'student',
      pages: [
        { path: '/vi/dashboard', name: 'Dashboard' },
        { path: '/vi/dashboard/courses', name: 'Đăng ký môn học' },
        { path: '/vi/dashboard/schedule', name: 'Thời khóa biểu' },
        { path: '/vi/dashboard/grades', name: 'Bảng điểm' },
        { path: '/vi/dashboard/curriculum', name: 'Khung chương trình' },
        { path: '/vi/dashboard/thesis', name: 'Khóa luận tốt nghiệp' },
      ]
    },
    {
      name: 'Giảng viên',
      credentialKey: 'LECTURER',
      portal: 'lecturer',
      pages: [
        { path: '/vi/dashboard/lecturer', name: 'Dashboard Giảng viên' },
        { path: '/vi/dashboard/lecturer/schedule', name: 'Lịch giảng dạy' },
        { path: '/vi/dashboard/lecturer/grades', name: 'Quản lý điểm' },
        { path: '/vi/dashboard/thesis', name: 'Đề tài hướng dẫn' },
      ]
    },
    {
      name: 'Trưởng bộ môn',
      credentialKey: 'DEPARTMENT_HEAD',
      portal: 'lecturer',
      pages: [
        { path: '/vi/dashboard/thesis', name: 'Quản lý đề tài bộ môn' },
        { path: '/vi/dashboard/lecturer', name: 'Dashboard Giảng dạy' },
      ]
    },
    {
      name: 'Trưởng khoa',
      credentialKey: 'DEAN',
      portal: 'dean',
      pages: [
        { path: '/vi/dashboard/dean', name: 'Tổng quan hội đồng khoa' },
        { path: '/vi/dashboard/thesis', name: 'Danh mục đề tài khoa' },
      ]
    },
    {
      name: 'Quản trị viên (Admin)',
      credentialKey: 'ADMIN',
      portal: 'admin',
      pages: [
        { path: '/vi/admin', name: 'Dashboard Quản trị' },
        { path: '/vi/admin/users', name: 'Quản lý người dùng' },
        { path: '/vi/admin/courses', name: 'Quản lý môn học' },
        { path: '/vi/admin/departments', name: 'Quản lý khoa/ngành' },
        { path: '/vi/admin/semesters', name: 'Quản lý học kỳ' },
      ]
    }
  ];

  const roles = ROLES.map(requiredCredentials);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await guardBrowserTraffic(context);
  const page = await context.newPage();

  console.log('========================================================================');
  console.log(`Role rendering benchmark for ${BASE}`);
  console.log('========================================================================\n');

  for (const r of roles) {
    console.log(`>>> BẮT ĐẦU KIỂM TRA ROLE: [${r.name}] - Portal: ${r.portal}`);
    
    // 1. Login
    const t0 = performance.now();
    await page.goto(`${BASE}/vi/login?portal=${r.portal}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button[type="submit"]');
    
    await page.fill('input[type="email"], input[name="email"]', r.email);
    await page.fill('input[type="password"], input[name="password"]', r.password);
    
    const tSubmit = performance.now();
    await page.click('button[type="submit"]');
    
    try {
      await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15000 });
      const loginTime = Math.round(performance.now() - tSubmit);
      console.log(`    [OK] Đăng nhập & chuyển trang thành công: ${loginTime}ms (Landed: ${new URL(page.url()).pathname})`);
    } catch {
      console.error(`    [LỖI] Đăng nhập timeout hoặc thất bại!`);
      continue;
    }

    await page.waitForTimeout(1500);

    // 2. Visit each page
    for (const p of r.pages) {
      const tPage = performance.now();
      let status = 'OK';
      try {
        await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200); // allow hydration & API queries to settle
        const duration = Math.round(performance.now() - tPage);
        const title = await page.title();
        console.log(`    - Trang "${p.name}" (${p.path}): ${duration}ms | Tiêu đề: "${title.slice(0, 35)}"`);
      } catch (err) {
        console.error('    - ' + p.name + ' navigation failed (' + err.name + ').');
      }
    }

    // Clear session for next role
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    console.log('');
  }

  await browser.close();
}

run().catch(console.error);
