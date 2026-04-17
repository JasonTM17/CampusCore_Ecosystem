'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { financeApi, semestersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Receipt,
  AlertCircle,
  Eye,
  Trash2,
  X,
  DollarSign,
  CheckCircle,
  Clock,
  FileText,
  Plus,
  RefreshCw,
  Download,
} from 'lucide-react';

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

interface Student {
  id: string;
  studentId: string;
  user?: { firstName?: string; lastName?: string; email?: string };
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  PARTIALLY_PAID: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export default function AdminInvoicesPage() {
  const { user, logout, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchDropdownData = useCallback(async () => {
    try {
      const semestersRes = await semestersApi.getAll();
      setSemesters(semestersRes.data || []);
    } catch (err) {
      console.error('Failed to fetch dropdown data:', err);
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    setError(null);
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
    } catch (err) {
      setError('Failed to load invoices');
      toast.error('Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  }, [filters.semesterId, filters.status, filters.studentId, page]);

  useEffect(() => {
    if (!canAccess) return;
    void fetchDropdownData();
  }, [canAccess, fetchDropdownData]);

  useEffect(() => {
    if (!canAccess) return;
    void fetchInvoices();
  }, [canAccess, fetchInvoices]);

  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({ semesterId: '', studentId: '', status: '' });
    setPage(1);
  };

  const handleViewDetail = async (invoice: Invoice) => {
    try {
      const detail = await financeApi.getInvoiceById(invoice.id);
      setSelectedInvoice(detail);
      setIsDetailOpen(true);
    } catch (err) {
      toast.error('Failed to load invoice details');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this invoice?')) return;

    try {
      await financeApi.deleteInvoice(id);
      toast.success('Invoice deleted successfully');
      fetchInvoices();
    } catch (err) {
      toast.error('Failed to delete invoice');
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      await financeApi.updateInvoice(id, { status });
      toast.success('Invoice status updated');
      fetchInvoices();
      if (selectedInvoice?.id === id) {
        handleViewDetail({
          id,
          invoiceNumber: '',
          studentId: '',
          semesterId: '',
          status: '',
          total: 0,
          dueDate: '',
          createdAt: '',
        });
      }
    } catch (err) {
      toast.error('Failed to update invoice status');
    }
  };

  const handleGenerateInvoices = async () => {
    if (!filters.semesterId) {
      toast.error('Please select a semester first');
      return;
    }

    if (
      !confirm(
        'This will generate invoices for all students with confirmed enrollments in this semester. Continue?',
      )
    )
      return;

    try {
      toast.info('Generating invoices...');
      const result = await financeApi.generateSemesterInvoices(
        filters.semesterId,
      );
      toast.success(
        `Generated ${result.generated} invoices, skipped ${result.skipped}`,
      );
      fetchInvoices();
    } catch (err) {
      toast.error('Failed to generate invoices');
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
      toast.success('Export successful');
    } catch (err) {
      toast.error('Failed to export invoices');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-slate-800 text-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="flex items-center gap-2 text-gray-300 hover:text-white"
              aria-label="Back to admin dashboard"
              title="Back to admin dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-xl font-bold">CampusCore Admin</h1>
            <span className="text-gray-500">|</span>
            <span className="text-gray-300">Invoice Management</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              className="text-white border-gray-600 hover:bg-gray-700"
              onClick={fetchInvoices}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
            <span className="text-gray-300">Welcome, {user?.firstName}</span>
            <Button
              variant="outline"
              className="text-white border-gray-600 hover:bg-gray-700"
              onClick={logout}
            >
              Logout
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Receipt className="h-7 w-7 text-primary" />
              Invoice Management
            </h2>
            <p className="text-gray-500 mt-1">
              View and manage tuition invoices
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500">Total: {total} invoices</div>
            <Button variant="outline" onClick={handleExportCsv}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button
              onClick={handleGenerateInvoices}
              disabled={!filters.semesterId}
            >
              <Plus className="h-4 w-4 mr-2" />
              Generate Invoices
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Semester
              </label>
              <select
                value={filters.semesterId}
                onChange={(e) =>
                  handleFilterChange('semesterId', e.target.value)
                }
                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
              >
                <option value="">All Semesters</option>
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-w-[140px]"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PENDING">Pending</option>
                <option value="PAID">Paid</option>
                <option value="OVERDUE">Overdue</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <Button variant="outline" onClick={handleClearFilters}>
              Clear Filters
            </Button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center mb-6">
            <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-600 font-medium mb-2">{error}</p>
            <Button variant="outline" onClick={fetchInvoices}>
              Try Again
            </Button>
          </div>
        )}

        {/* Invoices Table */}
        {!error && (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Invoice #
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Student
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Semester
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">
                      Amount
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">
                      Due Date
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">
                      Status
                    </th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {invoice.invoiceNumber}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900">
                            {invoice.student?.user
                              ? `${invoice.student.user?.firstName} ${invoice.student.user?.lastName}`
                              : invoice.studentId}
                          </p>
                          <p className="text-gray-500 text-xs">
                            {invoice.student?.user?.email}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {invoice.semester?.name || '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(Number(invoice.total))}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDate(invoice.dueDate)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[invoice.status] || 'bg-gray-100 text-gray-600'}`}
                        >
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleViewDetail(invoice)}
                            aria-label={`View invoice ${invoice.invoiceNumber}`}
                            title={`View invoice ${invoice.invoiceNumber}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(invoice.id)}
                            aria-label={`Delete invoice ${invoice.invoiceNumber}`}
                            title={`Delete invoice ${invoice.invoiceNumber}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Empty state */}
            {invoices.length === 0 && !isLoading && (
              <div className="p-8 text-center">
                <Receipt className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No invoices found</p>
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && !isLoading && (
              <div className="border-t px-4 py-3 flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Invoice Detail Modal */}
      {isDetailOpen && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl p-6 my-8 mx-4">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-semibold">Invoice Details</h3>
                <p className="text-gray-500">{selectedInvoice.invoiceNumber}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsDetailOpen(false)}
                aria-label="Close invoice details"
                title="Close invoice details"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-6">
              {/* Student Info */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Student Information</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Name:</span>{' '}
                    <span className="font-medium">
                      {selectedInvoice.student?.user
                        ? `${selectedInvoice.student.user?.firstName} ${selectedInvoice.student.user?.lastName}`
                        : selectedInvoice.studentId}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Email:</span>{' '}
                    <span className="font-medium">
                      {selectedInvoice.student?.user?.email || '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Invoice Items */}
              <div>
                <h4 className="font-semibold mb-3">Invoice Items</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Description</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Unit Price</th>
                      <th className="text-right py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedInvoice.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2">{item.description}</td>
                        <td className="text-right py-2">{item.quantity}</td>
                        <td className="text-right py-2">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="text-right py-2 font-medium">
                          {formatCurrency(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-bold">
                      <td colSpan={3} className="text-right py-2">
                        Total
                      </td>
                      <td className="text-right py-2">
                        {formatCurrency(Number(selectedInvoice.total))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Status Actions */}
              <div className="flex flex-wrap gap-2">
                {selectedInvoice.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      handleUpdateStatus(selectedInvoice.id, 'PENDING')
                    }
                  >
                    Mark as Pending
                  </Button>
                )}
                {selectedInvoice.status === 'PENDING' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      handleUpdateStatus(selectedInvoice.id, 'PAID')
                    }
                  >
                    Mark as Paid
                  </Button>
                )}
                {selectedInvoice.status !== 'CANCELLED' &&
                  selectedInvoice.status !== 'PAID' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleUpdateStatus(selectedInvoice.id, 'CANCELLED')
                      }
                    >
                      Cancel Invoice
                    </Button>
                  )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
