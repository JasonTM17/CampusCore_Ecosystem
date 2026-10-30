import api from '@/lib/api';

/**
 * Simulated library circulation client (contract §8, phase-11). Copies move
 * AVAILABLE → RESERVED → ON_LOAN → AVAILABLE (or soft RETIRED); requests
 * move REQUESTED → APPROVED → ISSUED → RETURNED | CANCELLED. Availability
 * is server truth — the expiry sweep runs on reads, and a foreign request
 * id answers the same REQUEST_NOT_FOUND a missing id does.
 */

export type CopyStatus = 'AVAILABLE' | 'RESERVED' | 'ON_LOAN' | 'RETIRED';
export type LoanStatus = 'REQUESTED' | 'APPROVED' | 'ISSUED' | 'RETURNED' | 'CANCELLED';

export interface LibraryCopy {
  id: string;
  titleId: string;
  barcode: string;
  status: CopyStatus;
  version: number;
}

export interface LibraryTitle {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  publisher: string | null;
  publishedYear: number | null;
  description: string | null;
  totalCopies: number;
  availableCopies: number;
  version: number;
  copies: LibraryCopy[];
}

export interface LoanRequest {
  id: string;
  copyId: string;
  barcode: string | null;
  titleId: string | null;
  title: string | null;
  borrowerUserId: string;
  borrowerEmail: string | null;
  status: LoanStatus;
  requestedAt: string | null;
  expiresAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  issuedBy: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  version: number;
  createdAt: string;
}

export function newLibraryIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `lib-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function idempotencyHeaders(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

export const libraryApi = {
  // ------------------------------ patron ------------------------------
  catalogue: async (query?: string): Promise<LibraryTitle[]> => {
    const response = await api.get<LibraryTitle[]>('/library/catalogue', {
      params: query ? { query } : {},
    });
    return response.data;
  },
  cataloguePage: async (query: string | undefined, page: number, limit: number): Promise<{
    items: LibraryTitle[];
    total: number | null;
  }> => {
    const response = await api.get<LibraryTitle[]>('/library/catalogue', {
      params: { ...(query ? { query } : {}), page, limit },
    });
    const headerValue = response.headers?.['x-total-count']
      ?? response.headers?.['X-Total-Count'];
    const parsedTotal = headerValue == null ? Number.NaN : Number(headerValue);
    const total = Number.isSafeInteger(parsedTotal) && parsedTotal >= 0 ? parsedTotal : null;
    return { items: response.data, total };
  },
  title: async (titleId: string): Promise<LibraryTitle> => {
    const response = await api.get<LibraryTitle>(`/library/catalogue/${titleId}`);
    return response.data;
  },
  myLoans: async (): Promise<LoanRequest[]> => {
    const response = await api.get<LoanRequest[]>('/library/requests/my');
    return response.data;
  },
  request: async (copyId: string, idempotencyKey: string): Promise<LoanRequest> => {
    const response = await api.post<LoanRequest>(
      '/library/requests', { copyId }, idempotencyHeaders(idempotencyKey));
    return response.data;
  },
  cancel: async (requestId: string, expectedVersion: number,
      idempotencyKey: string, reason?: string): Promise<LoanRequest> => {
    const response = await api.post<LoanRequest>(
      `/library/requests/${requestId}/cancel`, { expectedVersion, reason },
      idempotencyHeaders(idempotencyKey));
    return response.data;
  },

  // ------------------------------ staff ------------------------------
  queue: async (status?: LoanStatus | ''): Promise<LoanRequest[]> => {
    const response = await api.get<LoanRequest[]>('/library/staff/requests', {
      params: status ? { status } : {},
    });
    return response.data;
  },
  staffRequest: async (requestId: string): Promise<LoanRequest> => {
    const response = await api.get<LoanRequest>(`/library/staff/requests/${requestId}`);
    return response.data;
  },
  approve: async (requestId: string, expectedVersion: number): Promise<LoanRequest> => {
    const response = await api.post<LoanRequest>(
      `/library/staff/requests/${requestId}/approve`, { expectedVersion });
    return response.data;
  },
  issue: async (requestId: string, expectedVersion: number, dueDays?: number): Promise<LoanRequest> => {
    const response = await api.post<LoanRequest>(
      `/library/staff/requests/${requestId}/issue`, { expectedVersion, dueDays });
    return response.data;
  },
  returnLoan: async (requestId: string, expectedVersion: number): Promise<LoanRequest> => {
    const response = await api.post<LoanRequest>(
      `/library/staff/requests/${requestId}/return`, { expectedVersion });
    return response.data;
  },
  cancelStaff: async (requestId: string, expectedVersion: number, reason?: string): Promise<LoanRequest> => {
    const response = await api.post<LoanRequest>(
      `/library/staff/requests/${requestId}/cancel`, { expectedVersion, reason });
    return response.data;
  },
  createTitle: async (payload: {
    title: string; author?: string; isbn?: string; category?: string;
    publisher?: string; publishedYear?: number; description?: string;
  }): Promise<LibraryTitle> => {
    const response = await api.post<LibraryTitle>('/library/staff/titles', payload);
    return response.data;
  },
  createCopy: async (titleId: string, barcode: string): Promise<LibraryCopy> => {
    const response = await api.post<LibraryCopy>('/library/staff/copies', { titleId, barcode });
    return response.data;
  },
  retireCopy: async (copyId: string, expectedVersion: number): Promise<LibraryCopy> => {
    const response = await api.post<LibraryCopy>(
      `/library/staff/copies/${copyId}/retire`, { expectedVersion });
    return response.data;
  },
};
