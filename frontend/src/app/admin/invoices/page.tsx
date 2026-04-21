'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Download,
  Eye,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { financeApi, semestersApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminTableScroll,
  AdminToolbarCard,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';

interface Invoice {
  id: string;
  invoiceNumber: string;
  studentId: string;
  semesterId: string;
  status: string;
  total: number;
  dueDate: string;
  paidAt?: string;
  createdAt: string;
  student?: {
    user?: { firstName?: string; lastName?: string; email?: string };
    studentId?: string;
  };
  semester?: { name: string };
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

interface Semester {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-secondary text-foreground',
  PENDING: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  PARTIALLY_PAID: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export default function AdminInvoicesPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    semesterId: '',
    studentId: '',
    status: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchSemesters = useCallback(async () => {
    try {
      const response = await semestersApi.getAll();
      setSemesters(response.data || []);
    } catch {
      // Optional filter data.
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const params: {
        page: number;
        limit: number;
        semesterId?: string;
        studentId?: string;
        status?: string;
      } = { page, limit: 20 };
      if (filters.semesterId) params.semesterId = filters.semesterId;
      if (filters.studentId) params.studentId = filters.studentId;
      if (filters.status) params.status = filters.status;

      const response = await financeApi.getAllInvoices(params);
      setInvoices(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
      setTotal(response.meta?.total || 0);
    } catch {
      setError('Invoices could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [filters.semesterId, filters.status, filters.studentId, page]);

  useEffect(() => {
    if (canAccess) {
      void fetchSemesters();
      void fetchInvoices();
    }
  }, [canAccess, fetchInvoices, fetchSemesters]);

  const semesterOptions = useMemo(
    () => [
      { value: '', label: 'All semesters' },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: semester.name,
      })),
    ],
    [semesters],
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: 'All statuses' },
      { value: 'DRAFT', label: 'Draft' },
      { value: 'PENDING', label: 'Pending' },
      { value: 'PAID', label: 'Paid' },
      { value: 'OVERDUE', label: 'Overdue' },
      { value: 'PARTIALLY_PAID', label: 'Partially paid' },
      { value: 'CANCELLED', label: 'Cancelled' },
    ],
    [],
  );

  const pageSummary = useMemo(() => {
    if (invoices.length === 0) {
      return `0 invoices`;
    }

    return `${total} invoices`;
  }, [invoices.length, total]);

  if (!canAccess) {
    return <LoadingState label="Loading invoices" className="m-8" />;
  }

  const handleViewDetail = async (invoice: Invoice) => {
    try {
      const detail = await financeApi.getInvoiceById(invoice.id);
      setSelectedInvoice(detail);
      setIsDetailOpen(true);
    } catch {
      toast.error('Invoice details could not be loaded.');
    }
  };

  const handleDelete = async (invoice: Invoice) => {
    const shouldDelete = await confirm({
      title: 'Delete invoice',
      message: `Delete ${invoice.invoiceNumber}? This removes the invoice from the current admin view.`,
      confirmText: 'Delete invoice',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await financeApi.deleteInvoice(invoice.id);
      toast.success('Invoice deleted');
      await fetchInvoices();
    } catch {
      toast.error('We could not delete that invoice.');
    }
  };

  const handleUpdateStatus = async (invoiceId: string, status: string) => {
    try {
      await financeApi.updateInvoice(invoiceId, { status });
      toast.success('Invoice status updated');
      await fetchInvoices();

      if (selectedInvoice?.id === invoiceId) {
        const detail = await financeApi.getInvoiceById(invoiceId);
        setSelectedInvoice(detail);
      }
    } catch {
      toast.error('The invoice status could not be updated.');
    }
  };

  const handleGenerateInvoices = async () => {
    if (!filters.semesterId) {
      toast.error('Select a semester before generating invoices.');
      return;
    }

    const shouldGenerate = await confirm({
      title: 'Generate semester invoices',
      message:
        'Generate invoices for all students with confirmed enrollments in the selected semester?',
      confirmText: 'Generate invoices',
    });

    if (!shouldGenerate) {
      return;
    }

    try {
      const result = await financeApi.generateSemesterInvoices(filters.semesterId);
      toast.success(
        `Generated ${result.generated} invoices and skipped ${result.skipped}.`,
      );
      await fetchInvoices();
    } catch {
      toast.error('Semester invoices could not be generated.');
    }
  };

  const handleExportCsv = async () => {
    try {
      const csvData = await financeApi.exportInvoicesCsv(filters);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `invoices_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      toast.success('Invoice export started');
    } catch {
      toast.error('Invoices could not be exported.');
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  return (
    <AdminFrame
      title="Invoices"
      description="Review invoice health, generate semester billing in a controlled way, and keep payment follow-up readable."
      backLabel="Back to admin dashboard"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void fetchInvoices()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => void handleExportCsv()}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={() => void handleGenerateInvoices()}>
            <Plus className="mr-2 h-4 w-4" />
            Generate invoices
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <div className="grid gap-4 md:grid-cols-3">
              <Select
                label="Semester"
                value={filters.semesterId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    semesterId: event.target.value,
                  }));
                  setPage(1);
                }}
                options={semesterOptions}
              />
              <Select
                label="Status"
                value={filters.status}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }));
                  setPage(1);
                }}
                options={statusOptions}
              />
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters({ semesterId: '', studentId: '', status: '' });
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
                <div className="text-sm text-muted-foreground">{pageSummary}</div>
              </div>
            </div>
        </AdminToolbarCard>

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
            title="No matching invoices"
            description="Once a semester is ready for billing, generated invoices will appear here with payment status and due dates."
          />
        ) : (
          <AdminTableCard
            title="Invoice records"
            footer={
              <AdminPaginationFooter
                summary={`Page ${page} of ${totalPages}`}
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            }
          >
              <AdminTableScroll>
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Invoice #</th>
                      <th className="px-2 py-3 font-medium">Student</th>
                      <th className="px-2 py-3 font-medium">Semester</th>
                      <th className="px-2 py-3 font-medium text-right">Amount</th>
                      <th className="px-2 py-3 font-medium">Due date</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {invoice.invoiceNumber}
                        </td>
                        <td className="px-2 py-4">
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">
                              {invoice.student?.user
                                ? `${invoice.student.user.firstName} ${invoice.student.user.lastName}`
                                : invoice.studentId}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {invoice.student?.user?.email || 'No email'}
                            </p>
                          </div>
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {invoice.semester?.name || 'Unassigned'}
                        </td>
                        <td className="px-2 py-4 text-right font-medium text-foreground">
                          {formatCurrency(Number(invoice.total))}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(invoice.dueDate)}
                        </td>
                        <td className="px-2 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[invoice.status] || 'bg-secondary text-foreground'}`}
                          >
                            {invoice.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => void handleViewDetail(invoice)}
                              aria-label={`View invoice ${invoice.invoiceNumber}`}
                              title={`View invoice ${invoice.invoiceNumber}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(invoice)}
                              aria-label={`Delete invoice ${invoice.invoiceNumber}`}
                              title={`Delete invoice ${invoice.invoiceNumber}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AdminRowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableScroll>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title={selectedInvoice ? `Invoice ${selectedInvoice.invoiceNumber}` : 'Invoice details'}
        closeLabel="Close invoice details"
        className="max-w-3xl"
      >
        {selectedInvoice ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-border/70 bg-secondary/30 p-4">
              <h4 className="font-semibold text-foreground">Student information</h4>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Name:</span>{' '}
                  <span className="font-medium text-foreground">
                    {selectedInvoice.student?.user
                      ? `${selectedInvoice.student.user.firstName} ${selectedInvoice.student.user.lastName}`
                      : selectedInvoice.studentId}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Email:</span>{' '}
                  <span className="font-medium text-foreground">
                    {selectedInvoice.student?.user?.email || 'No email'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-foreground">Invoice items</h4>
              <AdminTableScroll className="mt-3">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Description</th>
                      <th className="py-2 pr-4 text-right font-medium">Qty</th>
                      <th className="py-2 pr-4 text-right font-medium">Unit price</th>
                      <th className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {selectedInvoice.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="py-3 pr-4 text-foreground">{item.description}</td>
                        <td className="py-3 pr-4 text-right text-muted-foreground">
                          {item.quantity}
                        </td>
                        <td className="py-3 pr-4 text-right text-muted-foreground">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="py-3 text-right font-medium text-foreground">
                          {formatCurrency(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border/70">
                      <td
                        colSpan={3}
                        className="py-3 pr-4 text-right font-semibold text-foreground"
                      >
                        Total
                      </td>
                      <td className="py-3 text-right font-semibold text-foreground">
                        {formatCurrency(Number(selectedInvoice.total))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </AdminTableScroll>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-foreground">Status actions</h4>
              <div className="flex flex-wrap gap-2">
                {selectedInvoice.status === 'DRAFT' ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      void handleUpdateStatus(selectedInvoice.id, 'PENDING')
                    }
                  >
                    Mark as pending
                  </Button>
                ) : null}
                {selectedInvoice.status === 'PENDING' ? (
                  <Button
                    size="sm"
                    onClick={() => void handleUpdateStatus(selectedInvoice.id, 'PAID')}
                  >
                    Mark as paid
                  </Button>
                ) : null}
                {selectedInvoice.status !== 'CANCELLED' &&
                selectedInvoice.status !== 'PAID' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void handleUpdateStatus(selectedInvoice.id, 'CANCELLED')
                    }
                  >
                    Cancel invoice
                  </Button>
                ) : null}
              </div>
            </div>

            <AdminDialogFooter className="pt-0">
              <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
                Close
              </Button>
            </AdminDialogFooter>
          </div>
        ) : null}
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
