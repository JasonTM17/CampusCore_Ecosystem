export const NOTIFICATION_EVENTS_QUEUE = 'notifications' as const;

export const FINANCE_EVENT_TYPES = {
  INVOICE_CREATED: 'invoice.created',
  INVOICE_STATUS_CHANGED: 'invoice.status.changed',
  PAYMENT_COMPLETED: 'payment.completed',
} as const;

export type FinanceEventType =
  (typeof FINANCE_EVENT_TYPES)[keyof typeof FINANCE_EVENT_TYPES];

export interface FinanceEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  type: FinanceEventType;
  source: 'campuscore-finance-service';
  occurredAt: string;
  payload: TPayload;
}
