'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Eye, Receipt } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { financeApi, semestersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { toast } from 'sonner';

interface Invoice {
  id: string;
  invoiceNumber: string;
  semesterName: string;
  semesterId: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  dueDate: string;
  paidAt?: string;
  createdAt: string;
  paidAmount: number;
  balance: number;
}

interface InvoiceDetail extends Invoice {
  items: {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  payments: {
    id: string;
    paymentNumber: string;
    amount: number;
    method: string;
    status: string;
    paidAt: string;
    createdAt: string;
  }[];
}

interface SemesterOption {
  id: string;
  name: string;
}

const statusTone: Record<string, string> = {
  DRAFT: 'bg-secondary text-foreground',
  PENDING: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  PAID: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  OVERDUE: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  PARTIALLY_PAID: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  CANCELLED: 'bg-secondary text-muted-foreground',
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function StudentInvoicesPage() {
  const { hasAccess, isLoading: authLoading } = useRequireAuth(['STUDENT']);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [semesters, setSemesters] = useState<SemesterOption[]>([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchSemesters = useCallback(async () => {
    const response = await semestersApi.getAll();
    setSemesters(
      (response.data ?? []).map((semester) => ({
        id: semester.id,
        name: semester.name,
      })),
    );
  }, []);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await financeApi.getMyInvoices(selectedSemester || undefined);
      setInvoices(data);
    } catch {
      setError('Invoices could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSemester]);

  useEffect(() => {
    if (hasAccess) {
      void fetchSemesters();
    }
  }, [fetchSemesters, hasAccess]);

  useEffect(() => {
    if (hasAccess) {
      void fetchInvoices();
    }
  }, [fetchInvoices, hasAccess]);

  const selectedSemesterName = useMemo(() => {
    return (
      semesters.find((semester) => semester.id === selectedSemester)?.name ??
      'all semesters'
    );
  }, [selectedSemester, semesters]);

  const totalOutstanding = useMemo(() => {
    return invoices
      .filter((invoice) => invoice.status !== 'PAID')
      .reduce((sum, invoice) => sum + invoice.balance, 0);
  }, [invoices]);

  const viewInvoice = async (invoice: Invoice) => {
    setIsDetailLoading(true);

    try {
      const detail = await financeApi.getMyInvoiceById(invoice.id);
      setSelectedInvoice(detail);
    } catch {
      toast.error('Invoice details could not be loaded.');
    } finally {
      setIsDetailLoading(false);
    }
  };

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading invoices" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Student workspace</SectionEyebrow>}
        title="Invoices"
        description={`Review tuition and fee records for ${selectedSemesterName}, including balances, payment history, and due dates.`}
        actions={
          <div className="min-w-[220px]">
            <Select
              aria-label="Select semester for invoices"
              value={selectedSemester}
              onChange={(event) => setSelectedSemester(event.target.value)}
              options={[
                { value: '', label: 'All semesters' },
                ...semesters.map((semester) => ({
                  value: semester.id,
                  label: semester.name,
                })),
              ]}
            />
          </div>
        }
      />

      {error ? (
        <ErrorState
          title="Invoices unavailable"
          description={error}
          onRetry={() => void fetchInvoices()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading invoices" />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices found"
          description="When tuition or fee records are generated for your account, they will appear here."
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Outstanding balance
                  </div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatCurrency(totalOutstanding)}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400">
                  <CreditCard className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Invoices in view</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {invoices.length}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
                  <Receipt className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Paid records</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {invoices.filter((invoice) => invoice.status === 'PAID').length}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <CreditCard className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card variant="muted">
            <CardHeader>
              <CardTitle className="text-xl">Billing records</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Invoice</th>
                      <th className="px-2 py-3 font-medium">Semester</th>
                      <th className="px-2 py-3 text-right font-medium">Total</th>
                      <th className="px-2 py-3 text-right font-medium">Paid</th>
                      <th className="px-2 py-3 text-right font-medium">Balance</th>
                      <th className="px-2 py-3 font-medium">Due date</th>
                      <th className="px-2 py-3 text-center font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {invoice.invoiceNumber}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {invoice.semesterName}
                        </td>
                        <td className="px-2 py-4 text-right text-foreground">
                          {formatCurrency(invoice.total)}
                        </td>
                        <td className="px-2 py-4 text-right text-foreground">
                          {formatCurrency(invoice.paidAmount)}
                        </td>
                        <td className="px-2 py-4 text-right font-medium text-foreground">
                          {formatCurrency(invoice.balance)}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(invoice.dueDate)}
                        </td>
                        <td className="px-2 py-4 text-center">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              statusTone[invoice.status] ??
                              'bg-secondary text-foreground'
                            }`}
                          >
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-2 py-4 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void viewInvoice(invoice)}
                            aria-label={`View details for invoice ${invoice.invoiceNumber}`}
                            title={`View details for invoice ${invoice.invoiceNumber}`}
                          >
                            {isDetailLoading && selectedInvoice?.id !== invoice.id ? null : (
                              <Eye className="mr-2 h-4 w-4" />
                            )}
                            View details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Modal
        isOpen={Boolean(selectedInvoice)}
        onClose={() => setSelectedInvoice(null)}
        title="Invoice details"
        closeLabel="Close invoice details"
      >
        {selectedInvoice ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-border/70 bg-secondary/30 px-4 py-4">
              <div className="text-base font-semibold text-foreground">
                {selectedInvoice.invoiceNumber}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {selectedInvoice.semesterName}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span>Due {formatDate(selectedInvoice.dueDate)}</span>
                <span>Created {formatDate(selectedInvoice.createdAt)}</span>
                <span className="font-medium text-foreground">
                  Balance {formatCurrency(selectedInvoice.balance)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Invoice items
              </h3>
              <div className="space-y-3">
                {selectedInvoice.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border/70 bg-card px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium text-foreground">
                          {item.description}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {item.quantity} x {formatCurrency(item.unitPrice)}
                        </div>
                      </div>
                      <div className="font-medium text-foreground">
                        {formatCurrency(item.total)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedInvoice.payments.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Payment history
                </h3>
                <div className="space-y-3">
                  {selectedInvoice.payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="rounded-lg border border-border/70 bg-card px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-medium text-foreground">
                            {payment.paymentNumber}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {payment.method} - {formatDate(payment.paidAt || payment.createdAt)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium text-foreground">
                            {formatCurrency(payment.amount)}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {payment.status}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
