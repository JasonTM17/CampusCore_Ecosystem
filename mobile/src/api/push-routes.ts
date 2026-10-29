import { NO_CAPABILITIES, normalizeDeepLink, type CapabilitySet } from '../auth/capabilities';
import {
  laneScreenForPath,
  resolveDeepLink,
  roleHomePath,
  screenForPath,
  type SessionKind,
} from '../navigation/route-map';
import type { LaneScreenId, ScreenName, UserRole } from '../navigation/routes';
import type { NotificationTargetRecord } from './push-notifications';

/**
 * Where a notification may take the user. The inbox record (and, later, a push
 * tap) names a target; nothing opens until it has been mapped to an app route
 * and `resolveDeepLink` has accepted it for the current session, role and
 * capability grant. Everything else is refused, never improvised.
 */

export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface NotificationProducerRoute {
  readonly domain: string;
  /** Java producer that writes the inbox row (java-services restful-api). */
  readonly producer: string;
  /** `notifications.notification.link` exactly as stored, query excluded. */
  readonly link: string;
  /** Severity values the producer writes into `notifications.notification.type`. */
  readonly types: readonly NotificationSeverity[];
  /** App path this link opens, or null when the destination exists only on the web. */
  readonly route: string | null;
}

/**
 * Audited from the writers of `NotificationWriteRepository`: the `type` column
 * only carries a severity, so the domain is identified by `link`. Rows created
 * through `NotificationWriteService.create` carry an operator-supplied link and
 * are handled by the generic registry allowlist below, not by this table.
 */
export const NOTIFICATION_PRODUCER_ROUTES: readonly NotificationProducerRoute[] = [
  { domain: 'admissions', producer: 'AdmissionService', link: '/apply', types: ['INFO', 'SUCCESS'], route: '/apply' },
  { domain: 'careers', producer: 'CareerService', link: '/careers', types: ['INFO', 'SUCCESS', 'WARNING'], route: '/careers' },
  { domain: 'announcements', producer: 'AnnouncementStudentNotifier', link: '/dashboard/announcements', types: ['INFO'], route: '/announcements' },
  { domain: 'grades', producer: 'GradePublishNotifier', link: '/dashboard/transcript', types: ['SUCCESS'], route: '/transcript' },
  { domain: 'events', producer: 'EventService, EventStudentService', link: '/dashboard/events', types: ['INFO', 'SUCCESS', 'WARNING'], route: '/events' },
  { domain: 'learning', producer: 'LearningService', link: '/dashboard/learn', types: ['INFO', 'SUCCESS'], route: '/learning' },
  { domain: 'library', producer: 'LibraryService', link: '/library', types: ['INFO', 'SUCCESS'], route: '/library' },
  { domain: 'thesis-student', producer: 'ThesisNotificationService', link: '/dashboard/thesis', types: ['INFO', 'SUCCESS', 'WARNING'], route: '/thesis' },
  { domain: 'thesis-lecturer', producer: 'ThesisNotificationService', link: '/dashboard/lecturer/thesis', types: ['INFO'], route: null },
];

const routeByLink = new Map<string, string | null>(
  NOTIFICATION_PRODUCER_ROUTES.map((row) => [row.link, row.route]),
);

export interface NotificationSessionContext {
  kind: SessionKind;
  role: UserRole;
  capabilities?: CapabilitySet;
}

export type NotificationRefusal = 'invalid' | 'web-only' | 'blocked';

export type NotificationOpenDecision =
  | {
    action: 'open';
    /** Path accepted by `resolveDeepLink`; the only thing a caller may navigate to. */
    href: string;
    screen: ScreenName | null;
    lane: LaneScreenId | null;
    /** `/thesis/<id>` carries the topic id in its path segment. */
    topicId?: string;
  }
  | {
    action: 'refuse';
    reason: NotificationRefusal;
    /** Role home, or sign-in when signed out. Safe to show; never the refused target. */
    fallbackHref: string;
  };

function refuse(
  reason: NotificationRefusal,
  context: NotificationSessionContext,
): NotificationOpenDecision {
  return {
    action: 'refuse',
    reason,
    fallbackHref: context.kind === 'signedOut' ? '/sign-in' : roleHomePath(context.role),
  };
}

/**
 * Notification target (portal link, app path or `campuscore://` URL) → open
 * decision. Fails closed: unknown, malformed, traversal, foreign scheme,
 * `auth/callback`, a lane without a grant, a web-only destination and any
 * signed-out session are all refused. Notification targets never carry a query.
 */
export function resolveNotificationRoute(
  target: unknown,
  context: NotificationSessionContext,
): NotificationOpenDecision {
  if (typeof target !== 'string') return refuse('invalid', context);
  const normalized = normalizeDeepLink(target);
  if (normalized === null) return refuse('invalid', context);
  if (context.kind === 'signedOut') return refuse('blocked', context);

  const path = normalized.split('?')[0];
  const candidate = routeByLink.has(path) ? routeByLink.get(path) ?? null : path;
  if (candidate === null) return refuse('web-only', context);

  const decision = resolveDeepLink(
    candidate,
    context.kind,
    context.role,
    context.capabilities ?? NO_CAPABILITIES,
  );
  if (decision.action !== 'open') return refuse('blocked', context);

  const lane = laneScreenForPath(decision.href);
  const screen = lane === null ? screenForPath(decision.href) : null;
  if (lane === null && screen === null) return refuse('blocked', context);
  if (screen === 'thesis.detail') {
    const segment = decision.href.split('/')[2];
    try {
      return { action: 'open', href: decision.href, screen, lane, topicId: decodeURIComponent(segment) };
    } catch {
      return refuse('invalid', context);
    }
  }
  return { action: 'open', href: decision.href, screen, lane };
}

const NOTIFICATION_ID = /^[A-Za-z0-9._-]{1,100}$/;

/** The push payload carries only the inbox id (PushProvider.PushPayload), never a route. */
export function notificationIdFromPushData(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { notificationId?: unknown }).notificationId : null;
  return typeof id === 'string' && NOTIFICATION_ID.test(id) ? id : null;
}

/**
 * Tap on a delivered notification: re-read the authenticated inbox record and
 * resolve the target it stores. A failed read refuses; the id from the payload
 * is never used to build a path.
 */
export async function resolveNotificationTap(
  notificationId: unknown,
  fetchNotification: (notificationId: string) => Promise<NotificationTargetRecord>,
  context: NotificationSessionContext,
): Promise<NotificationOpenDecision> {
  if (typeof notificationId !== 'string' || !NOTIFICATION_ID.test(notificationId)) {
    return refuse('invalid', context);
  }
  try {
    const record = await fetchNotification(notificationId);
    const target = record?.link ?? record?.targetPath;
    return resolveNotificationRoute(target, context);
  } catch {
    return refuse('invalid', context);
  }
}
