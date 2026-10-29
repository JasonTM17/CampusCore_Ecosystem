import { NO_CAPABILITIES, normalizeDeepLink, type CapabilitySet } from '../auth/capabilities';
import type { LaneFlags } from '../config/lane-flags';
import {
  canAccessLaneScreen,
  canAccessScreen,
  canPreviewLaneScreen,
  laneGroupOf,
  type LaneScreenId,
  type ScreenName,
  type UserRole,
} from './routes';

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

/** Paths a signed-out session may open: the sign-in family and account recovery. */
const SIGNED_OUT_PATHS: ReadonlySet<string> = new Set([
  '/', '/sign-in', '/sign-in-blocked', '/forgot-password', '/reset-password', '/session/logged-out',
]);

/**
 * Read-only campus pages a guest may open without signing in. Careers, library
 * and admissions stay behind the sign-in: they act on a person's own records.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/news', '/docs']);

const roleHomeScreen: Record<UserRole, ScreenName> = {
  student: 'dashboard.student',
  lecturer: 'lecturer.dashboard',
  admin: 'admin.dashboard',
};

const pathByScreen: Record<ScreenName, string> = {
  'auth.signIn': '/sign-in',
  'auth.forgotPassword': '/forgot-password',
  'auth.resetPassword': '/reset-password',
  'auth.loggedOut': '/session/logged-out',
  'dashboard.student': '/dashboard',
  schedule: '/schedule',
  courses: '/courses',
  grades: '/grades',
  transcript: '/transcript',
  curriculum: '/curriculum',
  enrollments: '/enrollments',
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
  announcements: '/announcements',
  conduct: '/conduct',
  certificates: '/certificates',
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

/**
 * Lane screens mirror the portal path they replace, so a claimed universal
 * link and the manifest row (`contracts/ecosystem/mobile-parity.json`,
 * `laneGated: true`) name the same route. They never enter `pathByScreen`: a
 * lane path resolves only through the capability check in `resolveGuard`.
 */
const lanePathById: Record<LaneScreenId, string> = {
  'dean.overview': '/dashboard/dean',
  'staff.applyReview': '/apply/review',
  'staff.careersDesk': '/careers/desk',
  'staff.libraryDesk': '/library/desk',
  'admin.overview': '/admin',
  'admin.attendance': '/admin/attendance',
  'admin.audit': '/admin/audit',
  'admin.creditLimits': '/admin/credit-limit-applications',
  'admin.enrollments': '/admin/enrollments',
  'admin.events': '/admin/events',
  'admin.notifications': '/admin/notifications',
  'attendance.checkin': '/attendance/checkin',
};

const laneByPath = new Map<string, LaneScreenId>(
  Object.entries(lanePathById).map(([id, path]) => [path, id as LaneScreenId]),
);

export function lanePathFor(id: LaneScreenId): string {
  return lanePathById[id];
}

/** Deep-link path → lane screen, or null when it is not a lane route. */
export function laneScreenForPath(pathname: string): LaneScreenId | null {
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const exact = laneByPath.get(clean);
  if (exact) {
    return exact;
  }
  // The lecturer check-in link carries the session id as the final segment
  // (campuscore://attendance/checkin/<id> and the claimed https twin); the
  // segment's shape is validated by checkin-link, not by routing.
  if (/^\/attendance\/checkin\/[^/]+$/.test(clean)) {
    return 'attendance.checkin';
  }
  return null;
}

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
  /**
   * Set when a lane route was refused because its flag is off or the session
   * holds no grant: the redirect target is the role home, which carries the
   * web hand-off for lanes that stay on the portal.
   */
  reason?: 'lane-unavailable';
}

/**
 * Pure session+role guard for the (app) group (KM-13a — unit-tested
 * directly, not just via source scan):
 * - signedOut: only the sign-in family renders; anything else → /sign-in.
 * - preview/authenticated: sign-in paths bounce to role home; registry paths
 *   need role access (else role home); unknown paths → role home.
 * - lane routes (flag-gated) are allowed only for an authenticated session
 *   whose capability set grants them; the default empty set refuses every one
 *   (preview is never an authorization substitute, so it gets no lane —
 *   except the check-in demo surface, which a flagged preview student may
 *   open: `PREVIEW_LANES` renders simulated data and cannot submit).
 * - preview role switching mutates `role` inside the pseudo-session — the
 *   guard then treats the fake role as the surface selector exactly like a
 *   live one (KM-9: preview is never an authorization substitute).
 */
export function resolveGuard(
  session: SessionKind,
  role: UserRole,
  pathname: string,
  capabilities: CapabilitySet = NO_CAPABILITIES,
  flags?: LaneFlags,
): GuardDecision {
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  if (clean === '/auth/callback') {
    // Defensive only (KM-10): the OIDC session consumes this URL; a stray
    // deep link that still arrives goes to sign-in, never a screen.
    return { action: 'redirect', to: 'auth.signIn' };
  }
  if (session === 'signedOut') {
    return SIGNED_OUT_PATHS.has(clean) || PUBLIC_PATHS.has(clean)
      ? { action: 'allow' }
      : { action: 'redirect', to: 'auth.signIn' };
  }
  const lane = laneScreenForPath(clean);
  if (lane !== null) {
    const granted = session === 'authenticated'
      ? canAccessLaneScreen(role, capabilities, lane)
      : session === 'preview' && flags !== undefined && canPreviewLaneScreen(role, flags, lane);
    return granted
      ? { action: 'allow' }
      : { action: 'redirect', to: roleHomeScreen[role], reason: 'lane-unavailable' };
  }
  const screen = screenForPath(clean);
  if (clean === '/') {
    return { action: 'redirect', to: roleHomeScreen[role] };
  }
  if (screen !== null && screen.startsWith('auth.')) {
    return { action: 'redirect', to: roleHomeScreen[role] };
  }
  if (screen === null) {
    return { action: 'redirect', to: roleHomeScreen[role] };
  }
  return canAccessScreen(role, screen)
    ? { action: 'allow' }
    : { action: 'redirect', to: roleHomeScreen[role] };
}

/**
 * Incoming link → href to open. Anything that is not an app-owned link, an
 * unknown path, the OIDC callback, or a lane route the session is not granted
 * resolves to the sign-in / role-home screen instead of being opened.
 */
export function resolveDeepLink(
  url: string,
  session: SessionKind,
  role: UserRole,
  capabilities: CapabilitySet = NO_CAPABILITIES,
): { action: 'open' | 'redirect'; href: string } {
  const fallback = session === 'signedOut' ? '/sign-in' : roleHomePath(role);
  const path = normalizeDeepLink(url);
  if (path === null) {
    return { action: 'redirect', href: fallback };
  }
  const decision = resolveGuard(session, role, path, capabilities);
  if (decision.action === 'allow') {
    return { action: 'open', href: path };
  }
  return { action: 'redirect', href: decision.to ? pathFor(decision.to) : fallback };
}
