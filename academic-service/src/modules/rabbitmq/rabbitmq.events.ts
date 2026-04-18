export const NOTIFICATION_EVENTS_QUEUE = 'notifications' as const;

export interface AcademicEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  type: string;
  source: 'campuscore-academic-service';
  occurredAt: string;
  payload: TPayload;
}
