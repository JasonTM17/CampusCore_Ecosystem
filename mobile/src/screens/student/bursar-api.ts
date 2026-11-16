// Tuition (bursar) reads and the demo payment write, served by the dedicated
// bursar-api container. The same access token is accepted there (shared
// JWT secret); only the origin differs — resolved once per build.

import { apiClient, createAssistantClientRequestId } from '../../api/client';
import { resolveBursarBaseUrl } from '../../api/base-url';
import { Platform } from 'react-native';

const bursarBaseUrl = resolveBursarBaseUrl(
  process.env.EXPO_PUBLIC_BURSAR_API_URL,
  typeof __DEV__ !== 'undefined' && __DEV__,
  apiClient.baseUrl,
  Platform.OS,
);

const init = { baseUrl: bursarBaseUrl };

export interface BursarHold {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface BursarAccount {
  studentId: string;
  balance: number;
  currency: string;
  holds: BursarHold[];
}

export interface BursarInvoiceItem {
  id: string;
  label: string;
  courseCode: string;
  credits: number;
  unitPrice: number;
  amount: number;
}

export interface BursarInvoice {
  id: string;
  studentId: string;
  term: string;
  status: 'ISSUED' | 'PARTIAL' | 'PAID' | 'CANCELLED' | string;
  total: number;
  paidAmount: number;
  remaining: number;
  issuedAt: string;
  dueAt: string;
  paidAt: string;
  items: BursarInvoiceItem[];
}

export interface BursarPayment {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  reference: string;
  status: string;
  paidAt: string;
}

export const bursarApi = {
  account: () => apiClient.get<BursarAccount>('/me/bursar/account', init),
  invoices: () => apiClient.get<BursarInvoice[]>('/me/bursar/invoices', init),
  /**
   * Demo payment. `idempotencyKey` is generated per user confirmation and
   * reused by the client's retry lane so a retry never double-posts.
   */
  pay: (invoiceId: string, amount: number, idempotencyKey: string) =>
    apiClient.post<BursarPayment>(
      `/me/bursar/invoices/${encodeURIComponent(invoiceId)}/payments`,
      { amount, method: 'DEMO' },
      { ...init, headers: { 'Idempotency-Key': idempotencyKey } },
    ),
  newPaymentKey: createAssistantClientRequestId,
};
