import api from '@/lib/api';

/**
 * Events domain client (contract D4, phase-08). Staff calls resolve the
 * STAFF:events grant server-side — the UI must treat EVENTS_STAFF_REQUIRED
 * as "not staff", not as a crash.
 */

export type EventStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'COMPLETED'
  | 'CANCELLED';

export type RegistrationStatus = 'REGISTERED' | 'CANCELLED';
export type EventAttendanceStatus = 'ABSENT' | 'ATTENDED';

export interface CampusEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  organizer: string;
  status: EventStatus;
  capacity: number;
  registeredCount: number;
  seatsRemaining: number;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  myRegistrationId: string | null;
  myRegistrationStatus: RegistrationStatus | null;
  myAttendanceStatus: EventAttendanceStatus | null;
}

export interface EventRegistration {
  id: string;
  eventId: string;
  studentId: string;
  status: RegistrationStatus;
  attendanceStatus: EventAttendanceStatus;
  registeredAt: string;
  cancelledAt: string | null;
}

export interface MyEventRegistration {
  registrationId: string;
  registrationStatus: RegistrationStatus;
  attendanceStatus: EventAttendanceStatus;
  registeredAt: string;
  cancelledAt: string | null;
  event: CampusEvent;
}

export interface EventRosterEntry {
  registrationId: string;
  version: number;
  studentId: string;
  studentName: string;
  email: string;
  status: RegistrationStatus;
  attendanceStatus: EventAttendanceStatus;
  attendanceMarkedBy: string | null;
  attendanceMarkedAt: string | null;
  registeredAt: string;
}

export interface EventStaffGrant {
  id: string;
  userId: string;
  scope: string;
  grantedBy: string;
  createdAt: string;
}

export interface EventCreatePayload {
  title: string;
  description?: string;
  location?: string;
  organizer: string;
  capacity: number;
  startsAt: string;
  endsAt: string;
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
}

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const eventsApi = {
  // Student surface
  listPublished: async (): Promise<CampusEvent[]> => {
    const response = await api.get<CampusEvent[]>('/events');
    return response.data;
  },
  detail: async (eventId: string): Promise<CampusEvent> => {
    const response = await api.get<CampusEvent>(`/events/${eventId}`);
    return response.data;
  },
  myRegistrations: async (): Promise<MyEventRegistration[]> => {
    const response = await api.get<MyEventRegistration[]>('/events/my/registrations');
    return response.data;
  },
  register: async (eventId: string, idempotencyKey: string): Promise<EventRegistration> => {
    const response = await api.post<EventRegistration>(
      `/events/${eventId}/register`,
      null,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return response.data;
  },
  cancelRegistration: async (
    registrationId: string,
    idempotencyKey: string,
  ): Promise<EventRegistration> => {
    const response = await api.post<EventRegistration>(
      `/events/registrations/${registrationId}/cancel`,
      null,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return response.data;
  },

  // Staff surface (STAFF:events grant enforced server-side)
  staffList: async (): Promise<CampusEvent[]> => {
    const response = await api.get<CampusEvent[]>('/events/staff');
    return response.data;
  },
  staffDetail: async (eventId: string): Promise<CampusEvent> => {
    const response = await api.get<CampusEvent>(`/events/staff/${eventId}`);
    return response.data;
  },
  staffCreate: async (payload: EventCreatePayload): Promise<CampusEvent> => {
    const response = await api.post<CampusEvent>('/events/staff', payload);
    return response.data;
  },
  staffPublish: async (eventId: string): Promise<CampusEvent> => {
    const response = await api.post<CampusEvent>(`/events/staff/${eventId}/publish`);
    return response.data;
  },
  staffOpenRegistration: async (
    eventId: string,
    window?: { registrationOpensAt?: string | null; registrationClosesAt?: string | null },
  ): Promise<CampusEvent> => {
    const response = await api.post<CampusEvent>(
      `/events/staff/${eventId}/open-registration`,
      window ?? {},
    );
    return response.data;
  },
  staffCloseRegistration: async (eventId: string): Promise<CampusEvent> => {
    const response = await api.post<CampusEvent>(`/events/staff/${eventId}/close-registration`);
    return response.data;
  },
  staffCancel: async (eventId: string, reason?: string): Promise<CampusEvent> => {
    const response = await api.post<CampusEvent>(`/events/staff/${eventId}/cancel`, { reason });
    return response.data;
  },
  staffComplete: async (eventId: string): Promise<CampusEvent> => {
    const response = await api.post<CampusEvent>(`/events/staff/${eventId}/complete`);
    return response.data;
  },
  staffRoster: async (eventId: string): Promise<EventRosterEntry[]> => {
    const response = await api.get<EventRosterEntry[]>(`/events/staff/${eventId}/roster`);
    return response.data;
  },
  staffMarkAttendance: async (
    eventId: string,
    marks: Array<{ registrationId: string; status: EventAttendanceStatus; version: number }>,
  ): Promise<EventRosterEntry[]> => {
    const response = await api.post<EventRosterEntry[]>(
      `/events/staff/${eventId}/attendance`,
      { marks },
    );
    return response.data;
  },
};

/** True when the API answered "you hold no events grant" — show student view. */
export function isEventsStaffDenied(error: unknown): boolean {
  const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 403 && code === 'EVENTS_STAFF_REQUIRED';
}
