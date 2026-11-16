// Preview fixtures shown when the API client runs in preview mode — the
// simulated demo account that carries an active financial hold.

import type { BursarAccount, BursarInvoice } from './bursar-api';

export const previewBursarAccount: BursarAccount = {
  studentId: 'STU20260042',
  balance: 9_999_000,
  currency: 'VND',
  holds: [
    {
      id: 'hold-demo-1',
      reason: 'Nợ học phí học kỳ trước / Outstanding tuition balance',
      status: 'ACTIVE',
      createdAt: '2026-08-01T00:00:00Z',
    },
  ],
};

export const previewBursarInvoices: readonly BursarInvoice[] = [
  {
    id: 'inv-2026-1',
    studentId: 'STU20260042',
    term: '2026-1',
    status: 'ISSUED',
    total: 9_999_000,
    paidAmount: 0,
    remaining: 9_999_000,
    issuedAt: '2026-08-15T00:00:00Z',
    dueAt: '2026-09-15T00:00:00Z',
    paidAt: '',
    items: [
      { id: 'item-1', label: 'Lập trình Web nâng cao', courseCode: 'CS201', credits: 3, unitPrice: 555_500, amount: 1_666_500 },
      { id: 'item-2', label: 'Cơ sở dữ liệu phân tán', courseCode: 'CS301', credits: 4, unitPrice: 555_500, amount: 2_222_000 },
      { id: 'item-3', label: 'An toàn thông tin', courseCode: 'CS315', credits: 3, unitPrice: 555_500, amount: 1_666_500 },
    ],
  },
  {
    id: 'inv-2025-2',
    studentId: 'STU20260042',
    term: '2025-2',
    status: 'PAID',
    total: 12_300_000,
    paidAmount: 12_300_000,
    remaining: 0,
    issuedAt: '2026-01-10T00:00:00Z',
    dueAt: '2026-02-10T00:00:00Z',
    paidAt: '2026-01-20T00:00:00Z',
    items: [
      { id: 'item-4', label: 'Cấu trúc dữ liệu & giải thuật', courseCode: 'CS102', credits: 4, unitPrice: 550_000, amount: 2_200_000 },
    ],
  },
];
