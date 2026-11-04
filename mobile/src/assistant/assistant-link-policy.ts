/** Canonical destinations accepted in assistant Markdown. Keep in sync with
 * frontend/src/lib/assistant-link-policy.ts and the shared fixture. */
export const ASSISTANT_ALLOWED_DASHBOARD_ROUTES = [
  '/dashboard',
  '/dashboard/register',
  '/dashboard/enrollments',
  '/dashboard/learn',
  '/dashboard/curriculum',
  '/dashboard/schedule',
  '/dashboard/grades',
  '/dashboard/transcript',
  '/dashboard/conduct',
  '/dashboard/attendance',
  '/dashboard/thesis',
  '/dashboard/certificates',
  '/dashboard/events',
  '/dashboard/announcements',
  '/dashboard/notifications',
  '/dashboard/lecturer',
  '/dashboard/lecturer/schedule',
  '/dashboard/lecturer/grades',
  '/dashboard/lecturer/attendance',
  '/dashboard/assistant-specialized',
  '/dashboard/dean',
] as const;

const dashboardTargets: Readonly<Record<string, string>> = {
  '/dashboard': '/dashboard',
  '/dashboard/register': '/registration',
  '/dashboard/enrollments': '/enrollments',
  '/dashboard/learn': '/learning',
  '/dashboard/curriculum': '/curriculum',
  '/dashboard/schedule': '/schedule',
  '/dashboard/grades': '/grades',
  '/dashboard/transcript': '/transcript',
  '/dashboard/conduct': '/conduct',
  '/dashboard/attendance': '/attendance',
  '/dashboard/thesis': '/thesis',
  '/dashboard/certificates': '/certificates',
  '/dashboard/events': '/events',
  '/dashboard/announcements': '/announcements',
  '/dashboard/notifications': '/notifications',
  '/dashboard/lecturer': '/lecturer/dashboard',
  '/dashboard/lecturer/schedule': '/lecturer/schedule',
  '/dashboard/lecturer/grades': '/lecturer/grading',
  '/dashboard/lecturer/attendance': '/lecturer/attendance',
  '/dashboard/assistant-specialized': '/assistant',
  '/dashboard/dean': '/dashboard/dean',
};

const publishedDocPath = /^\/docs\/([a-z0-9][a-z0-9-]{0,239})(?:\?rev=([0-9]{1,10}))?$/;

/** Return an Expo Router path for a safe app destination, or null if denied. */
export function resolveAssistantMobileTarget(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (raw !== raw.trim()) return null;
  if (/[\u0000-\u0020\u007f-\u009f%\\]/u.test(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(raw) || raw.startsWith('//')) return null;
  if (!raw.startsWith('/')) return null;
  if (raw === '/docs') return '/docs';
  const doc = publishedDocPath.exec(raw);
  if (doc) {
    const query = [`slug=${encodeURIComponent(doc[1])}`];
    if (doc[2] !== undefined) query.push(`rev=${doc[2]}`);
    return `/docs?${query.join('&')}`;
  }
  return dashboardTargets[raw] ?? null;
}

export function isAssistantMobileDestinationAllowed(raw: string): boolean {
  return resolveAssistantMobileTarget(raw) !== null;
}
