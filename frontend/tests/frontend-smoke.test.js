const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assertPatterns(relPath, patterns) {
  const source = read(relPath);

  for (const pattern of patterns) {
    assert.match(source, pattern, `${relPath} is missing expected pattern: ${pattern}`);
  }
}

test('ThemeProvider always renders through the context provider', () => {
  const source = read('src/components/ThemeProvider.tsx');

  assert.match(source, /ThemeContext\.Provider/);
  assert.doesNotMatch(
    source,
    /if\s*\(!mounted\)\s*\{\s*return children;\s*\}/s,
  );
});

test('dashboard chrome no longer exposes dead internal links', () => {
  const source = read('src/app/dashboard/layout.tsx');

  assert.doesNotMatch(source, /\/admin\/students/);
  assert.doesNotMatch(source, /\/dashboard\/notifications/);
  assert.doesNotMatch(source, /\/dashboard\/settings/);
  assert.match(source, /aria-label="Toggle notifications panel"/);
  assert.match(source, /aria-label="Toggle profile menu"/);
});

test('admin hub only links to implemented routes', () => {
  const source = read('src/app/admin/page.tsx');

  assert.doesNotMatch(source, /\/admin\/students/);
});

test('homepage copy avoids demo placeholders and dead hrefs', () => {
  const source = read('src/app/page.tsx');
  const deadHrefPattern = new RegExp('href="' + '#"');
  const contactSalesPattern = new RegExp(['Contact', 'Sales'].join(' '));

  assert.doesNotMatch(source, deadHrefPattern);
  assert.doesNotMatch(source, /50K\+/);
  assert.doesNotMatch(source, /Kubernetes-ready/);
  assert.doesNotMatch(source, contactSalesPattern);
  assert.match(source, /href=\{user \? '\/dashboard' : '\/login'\}/);
});

test('logout sends the refresh token when available', () => {
  const source = read('src/lib/api.ts');

  assert.match(source, /localStorage\.getItem\('refreshToken'\)/);
  assert.match(
    source,
    /refreshToken \? \(\{ refreshToken \} satisfies LogoutPayload\) : \{\}/,
  );
});

test('shared UI no longer contains obvious mojibake arrows', () => {
  const source = read('src/components/ui/data-table.tsx');

  assert.doesNotMatch(source, /â†‘|â†“/);
});
test('modal exposes dialog semantics and a labeled close control', () => {
  const source = read('src/components/ui/modal.tsx');

  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-label="Close modal"/);
});

test('key frontend surfaces label icon-only buttons', () => {
  assertPatterns('src/app/login/page.tsx', [
    /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/,
  ]);
  assertPatterns('src/app/reset-password/page.tsx', [
    /aria-label=\{showPassword \? 'Hide password' : 'Show password'\}/,
  ]);
  assertPatterns('src/app/dashboard/profile/page.tsx', [
    /aria-label="Upload profile photo"/,
  ]);
  assertPatterns('src/app/dashboard/invoices/page.tsx', [
    /aria-label="Close invoice details"/,
  ]);
  assertPatterns('src/app/admin/academic-years/page.tsx', [
    /aria-label=\{`Edit academic year \$\{year\.year\}`\}/,
    /aria-label=\{`Delete academic year \$\{year\.year\}`\}/,
  ]);
  assertPatterns('src/app/admin/announcements/page.tsx', [
    /aria-label=\{`Delete announcement \$\{a\.title\}`\}/,
    /aria-label="Close new announcement form"/,
  ]);
  assertPatterns('src/app/admin/classrooms/page.tsx', [
    /aria-label=\{`Edit classroom \$\{room\.building\} \$\{room\.roomNumber\}`\}/,
    /aria-label=\{`Delete classroom \$\{room\.building\} \$\{room\.roomNumber\}`\}/,
  ]);
  assertPatterns('src/app/admin/courses/page.tsx', [
    /aria-label=\{`Edit course \$\{course\.code\}`\}/,
    /aria-label=\{`Delete course \$\{course\.code\}`\}/,
  ]);
  assertPatterns('src/app/admin/departments/page.tsx', [
    /aria-label=\{`Edit department \$\{dept\.name\}`\}/,
    /aria-label=\{`Delete department \$\{dept\.name\}`\}/,
  ]);
  assertPatterns('src/app/admin/enrollments/page.tsx', [
    /aria-label=\{`View enrollment details for \$\{enrollment\.student\?/,
    /aria-label=\{`Delete enrollment for \$\{enrollment\.student\?/,
    /aria-label="Close enrollment details"/,
  ]);
  assertPatterns('src/app/admin/invoices/page.tsx', [
    /aria-label=\{`View invoice \$\{invoice\.invoiceNumber\}`\}/,
    /aria-label=\{`Delete invoice \$\{invoice\.invoiceNumber\}`\}/,
    /aria-label="Close invoice details"/,
  ]);
  assertPatterns('src/app/admin/lecturers/page.tsx', [
    /aria-label=\{`Edit lecturer \$\{lecturer\.employeeId\}`\}/,
    /aria-label=\{`Delete lecturer \$\{lecturer\.employeeId\}`\}/,
  ]);
  assertPatterns('src/app/admin/sections/page.tsx', [
    /aria-label=\{`Edit section \$\{section\.sectionNumber\} for \$\{section\.course\?\.code \|\| 'course'\}`\}/,
    /aria-label=\{`Delete section \$\{section\.sectionNumber\} for \$\{section\.course\?\.code \|\| 'course'\}`\}/,
    /aria-label=\{`Remove schedule \$\{idx \+ 1\}`\}/,
  ]);
  assertPatterns('src/app/admin/semesters/page.tsx', [
    /aria-label=\{`Edit semester \$\{semester\.name\}`\}/,
    /aria-label=\{`Delete semester \$\{semester\.name\}`\}/,
  ]);
  assertPatterns('src/app/admin/users/page.tsx', [
    /aria-label=\{`Edit user \$\{u\.firstName\} \$\{u\.lastName\}`\}/,
    /aria-label=\{`Delete user \$\{u\.firstName\} \$\{u\.lastName\}`\}/,
  ]);
});
