import { canAccessScreen, type ScreenName, type UserRole } from './routes';

/**
 * ScreenName → expo-router pathname compatibility map
 * (docs/ecosystem/mobile-policy.md §2). Single authority for both directions:
 * legacy `MobileNavigation.navigate()` adapters build paths from it and the
 * deep-link guard resolves incoming URLs against it.
 *
 * `campuscore://auth/callback` is intentionally ABSENT — the OIDC callback is
 * consumed by `WebBrowser.openAuthSessionAsync` inside the sign-in flow and
 * must never be routed as an app screen (KM-10). A stray link to it resolves
 * as unknown and the guard sends the user to sign-in.
 */

export type SessionKind = 'signedOut' | 'preview' | 'authenticated';

const roleHomeScreen: Record<UserRole, ScreenName> = {
  student: 'dashboard.student',
  lecturer: 'lecturer.dashboard',
  admin: 'admin.dashboard',
};

const pathByScreen: Record<ScreenName, string> = {
  'auth.signIn': '/sign-in',
  'dashboard.student': '/dashboard',
  schedule: '/schedule',
  courses: '/courses',
  grades: '/grades',
  attendance: '/attendance',
  registration: '/registration',
  events: '/events',
  learning: '/learning',
  // App path mirrors the portal's `/apply` so a claimed universal link
  // resolves to this screen; `/admissions` is not a portal route.
  admissions: '/apply',
  library: '/library',
  careers: '/careers',
  news: '/news',
  docs: '/docs',
  notifications: '/notifications',
  profile: '/profile',
  'thesis.topics': '/thesis',
  'thesis.detail': '/thesis/[topicId]',
  'thesis.registration': '/thesis/register',
  'thesis.progress': '/thesis/progress',
  'assistant.chat': '/assistant',
  'admin.dashboard': '/admin/dashboard',
  'admin.students': '/admin/students',
  'admin.lecturers': '/admin/lecturers',
  'lecturer.dashboard': '/lecturer/dashboard',
  'lecturer.schedule': '/lecturer/schedule',
  'lecturer.grading': '/lecturer/grading',
  'lecturer.attendance': '/lecturer/attendance',
};

// Dynamic templates (`[topicId]`) never enter the exact-match table — the
// segment form is resolved by pattern in `screenForPath`.
const screenByPath = new Map<string, ScreenName>(
  Object.entries(pathByScreen)
    .filter(([, path]) => !path.includes('['))
    .map(([name, path]) => [path, name as ScreenName]),
);

/**
 * URL-ready query params (KM-5: navigation targets ride the URL so a cold
 * deep link keeps its target — they must not live only in in-memory state).
 */
export type RouteOptions = Record<string, string | null | undefined>;

/** ScreenName (+ optional query params) → href usable with router.push. */
export function pathFor(name: ScreenName, options?: RouteOptions): string {
  const template = pathByScreen[name];
  if (name === 'thesis.detail' && typeof options?.topicId !== 'string') {
    // Detail without an id is not a valid target — send the user to the
    // topics list rather than a half-formed deep link.
    return pathByScreen['thesis.topics'];
  }
  const consumed = new Set<string>();
  const base = template.includes('[topicId]')
    ? template.replace('[topicId]', encodeURIComponent(options?.topicId as string))
    : template;
  if (template.includes('[topicId]')) {
    consumed.add('topicId');
  }
  const query = Object.entries(options ?? {})
    .filter(([key]) => !consumed.has(key))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}

/**
 * Deep-link path (query stripped, group segments absent) → ScreenName, or
 * null for anything outside the registry — including `auth/callback`.
 */
export function screenForPath(pathname: string): ScreenName | null {
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  if (clean === '/') {
    return null;
  }
  const exact = screenByPath.get(clean);
  if (exact) {
    return exact;
  }
  // /thesis/<segment> → thesis.detail (contract §2 dynamic route); static
  // siblings already resolved above so register/progress keep precedence.
  // The legacy `/thesis/topic` shape is excluded — a stale link resolves as
  // unknown → role home rather than a detail screen for id 'topic'.
  if (/^\/thesis\/(?!topic$)[^/]+$/.test(clean)) {
    return 'thesis.detail';
  }
  return null;
}

export function roleHomePath(role: UserRole): string {
  return pathByScreen[roleHomeScreen[role]];
}

export interface GuardDecision {
  action: 'allow' | 'redirect';
  /** Present when action === 'redirect' — a ScreenName, never a raw path. */
  to?: ScreenName;
}

/**
 * Pure session+role guard for the (app) group (KM-13a — unit-tested
 * directly, not just via source scan):
 * - signedOut: only the sign-in family renders; anything else → /sign-in.
 * - preview/authenticated: sign-in paths bounce to role home; registry paths
 *   need role access (else role home); unknown paths → role home.
 * - preview role switching mutates `role` inside the pseudo-session — the
 *   guard then treats the fake role as the surface selector exactly like a
 *   live one (KM-9: preview is never an authorization substitute).
 */
export function resolveGuard(
  session: SessionKind,
  role: UserRole,
  pathname: string,
): GuardDecision {
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  if (clean === '/auth/callback') {
    // Defensive only (KM-10): the OIDC session consumes this URL; a stray
    // deep link that still arrives goes to sign-in, never a screen.
    return { action: 'redirect', to: 'auth.signIn' };
  }
  if (session === 'signedOut') {
    return clean === '/sign-in' || clean === '/sign-in-blocked' || clean === '/'
      ? { action: 'allow' }
      : { action: 'redirect', to: 'auth.signIn' };
  }
  const screen = screenForPath(clean);
  if (clean === '/') {
    return { action: 'redirect', to: roleHomeScreen[role] };
  }
  if (screen === 'auth.signIn') {
    return { action: 'redirect', to: roleHomeScreen[role] };
  }
  if (screen === null) {
    return { action: 'redirect', to: roleHomeScreen[role] };
  }
  return canAccessScreen(role, screen)
    ? { action: 'allow' }
    : { action: 'redirect', to: roleHomeScreen[role] };
}
