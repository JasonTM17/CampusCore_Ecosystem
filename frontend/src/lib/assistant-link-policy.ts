/**
 * Assistant links stay inside published documents and a finite set of
 * navigable dashboard routes. There is deliberately no external host list.
 */
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

const dashboardRoutes: ReadonlySet<string> = new Set(ASSISTANT_ALLOWED_DASHBOARD_ROUTES);
const publishedDocPath = /^\/docs\/[a-z0-9][a-z0-9-]{0,239}(?:\?rev=[0-9]{1,10})?$/;

/** Return the exact safe in-app destination, or null for plain-text fallback. */
export function resolveAssistantLinkDestination(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (raw !== raw.trim()) return null;
  if (/[\u0000-\u0020\u007f-\u009f%\\]/u.test(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(raw) || raw.startsWith('//')) return null;
  if (!raw.startsWith('/')) return null;
  if (raw === '/docs' || publishedDocPath.test(raw)) return raw;
  return dashboardRoutes.has(raw) ? raw : null;
}

/** Replace denied Markdown links with their label while preserving all prose. */
export function sanitizeAssistantMarkdownLinks(content: string): string {
  return content.replace(/!?\[([^\]\n]+)\]\(([^)\n]*)\)/gu, (_whole, label: string, destination: string) => {
    const safe = resolveAssistantLinkDestination(destination);
    return safe ? `[${label}](${safe})` : label;
  });
}
