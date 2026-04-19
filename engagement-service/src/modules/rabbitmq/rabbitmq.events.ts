export const NOTIFICATION_EVENTS_QUEUE = 'notifications' as const;

export const ENGAGEMENT_EVENT_TYPES = {
  ANNOUNCEMENT_CREATED: 'announcement.created',
} as const;

export type EngagementEventType =
  (typeof ENGAGEMENT_EVENT_TYPES)[keyof typeof ENGAGEMENT_EVENT_TYPES];

export interface EngagementEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  type: EngagementEventType;
  source: 'campuscore-engagement-service';
  occurredAt: string;
  payload: TPayload;
}
