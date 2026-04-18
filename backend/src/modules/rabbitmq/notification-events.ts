export const NOTIFICATION_EVENTS_QUEUE = 'notifications' as const;

export const NOTIFICATION_EVENT_TYPES = {
  ANNOUNCEMENT_CREATED: 'announcement.created',
  NOTIFICATION_USER_CREATED: 'notification.user.created',
  NOTIFICATION_ROLE_CREATED: 'notification.role.created',
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

export interface NotificationEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  type: NotificationEventType;
  source: 'campuscore-core-api';
  occurredAt: string;
  payload: TPayload;
}
