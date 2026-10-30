const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Web parity (source level): the /apply route must stay reachable by any
 * authenticated account — including a roleless applicant session that owns
 * no STUDENT/LECTURER/ADMIN role — because SELF admissions is gated by
 * authentication plus server-side owner scoping, never by a UI role. These
 * assertions pin the source contract; they intentionally do not run a
 * browser.
 */
test('/apply delegates to the admissions surface without a role gate', () => {
  const page = read('src/app/apply/page.tsx');
  assert.match(page, /AdmissionsApplyPage/);
  // No role-based redirect may live on the route entry itself.
  assert.doesNotMatch(page, /requiredRoles|hasRole|role\s*[!=]==|UserRole\.(student|applicant)/);
});

test('the admissions surface requires authentication only, not a role', () => {
  const component = read('src/components/admissions/AdmissionsApplyPage.tsx');
  // The auth hook is invoked bare — no requiredRoles argument — so any
  // authenticated account (student or roleless applicant) may enter.
  assert.match(component, /useRequireAuth\(\s*\)/);
  assert.doesNotMatch(component, /useRequireAuth\(\s*\[/);
});

test('useRequireAuth treats an absent role list as no role requirement', () => {
  const context = read('src/context/AuthContext.tsx');
  const hook = context.slice(context.indexOf('export function useRequireAuth'));
  // The roles list defaults to empty when the caller passes nothing.
  assert.match(hook, /requiredRoles\?:\s*AppRole\[\]/);
  assert.match(hook, /requiredRolesList[\s\S]*?\[\]/);
});
