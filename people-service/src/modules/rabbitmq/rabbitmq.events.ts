export const PEOPLE_SHADOW_QUEUE = 'people-shadow' as const;

export const PEOPLE_EVENT_TYPES = {
  STUDENT_UPSERTED: 'student.upserted',
  STUDENT_DELETED: 'student.deleted',
  LECTURER_UPSERTED: 'lecturer.upserted',
  LECTURER_DELETED: 'lecturer.deleted',
} as const;

export type PeopleEventType =
  (typeof PEOPLE_EVENT_TYPES)[keyof typeof PEOPLE_EVENT_TYPES];

export interface PeopleEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  type: PeopleEventType;
  source: 'campuscore-people-service';
  occurredAt: string;
  payload: TPayload;
}
