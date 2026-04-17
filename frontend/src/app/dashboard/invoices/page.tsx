'use client';

import { useCallback, useEffect, useState } from 'react';
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
  CheckCircle,
  Clock,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

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

interface Semester {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  PARTIALLY_PAID: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

const statusIcons: Record<string, LucideIcon> = {
  DRAFT: Clock,
  PENDING: Clock,
  PAID: CheckCircle,
  OVERDUE: XCircle,
  PARTIALLY_PAID: Clock,
  CANCELLED: XCircle,
};

export default function StudentInvoicesPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [filterSemester, setFilterSemester] = useState('');
  const fetchDropdownData = useCallback(async () => {
    try {
      const res = await semestersApi.getAll();
      setSemesters(res.data || []);
    } catch (err) {
      console.error('Failed to fetch semesters:', err);
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await financeApi.getMyInvoices(filterSemester || undefined);
      setInvoices(data);
    } catch (err) {
      setError('Failed to load invoices');
      toast.error('Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  }, [filterSemester]);

  useEffect(() => {
    if (!user?.studentId) {
      router.push('/dashboard');
    }
  }, [user, router]);

  useEffect(() => {
    void fetchDropdownData();
  }, [fetchDropdownData]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  if (!user?.studentId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const handleViewDetail = async (invoice: Invoice) => {
    try {
      const detail = await financeApi.getMyInvoiceById(invoice.id);
      setSelectedInvoice(detail);
      setIsDetailOpen(true);
    } catch (err) {
      toast.error('Failed to load invoice details');
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

  const totalOutstanding = invoices
    .filter((inv) => inv.status !== 'PAID')
    .reduce((sum, inv) => sum + inv.balance, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-slate-800 text-white shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-gray-700"
              onClick={() => router.push('/dashboard')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-xl font-bold">CampusCore</h1>
            <span className="text-gray-500">|</span>
            <span className="text-gray-300">My Invoices</span>
          </div>
          <div className="flex items-center gap-4">
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
              My Invoices
            </h2>
            <p className="text-gray-500 mt-1">
              View and manage your tuition invoices
            </p>
          </div>
          {totalOutstanding > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
              <span className="text-yellow-800 font-medium">
                Total Outstanding:{' '}
              </span>
              <span className="text-yellow-900 font-bold">
                {formatCurrency(totalOutstanding)}
              </span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="semester-filter"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Semester
              </label>
              <select
                id="semester-filter"
                value={filterSemester}
                onChange={(e) => setFilterSemester(e.target.value)}
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
            <Button variant="outline" onClick={() => setFilterSemester('')}>
              Clear Filter
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
                      Semester
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">
                      Amount
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">
                      Paid
                    </th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">
                      Balance
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
                      <td className="px-4 py-3 text-gray-600">
                        {invoice.semesterName}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(invoice.total)}
                      </td>
                      <td className="px-4 py-3 text-right text-green-600">
                        {formatCurrency(invoice.paidAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-red-600">
                        {formatCurrency(invoice.balance)}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleViewDetail(invoice)}
                          aria-label={`View details for invoice ${invoice.invoiceNumber}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
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
                <XCircle className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-6">
              {/* Status Banner */}
              <div
                className={`p-4 rounded-lg flex items-center justify-between ${
                  selectedInvoice.status === 'PAID'
                    ? 'bg-green-50'
                    : selectedInvoice.status === 'OVERDUE'
                      ? 'bg-red-50'
                      : 'bg-yellow-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = statusIcons[selectedInvoice.status] || Clock;
                    return (
                      <Icon
                        className={`h-6 w-6 ${
                          selectedInvoice.status === 'PAID'
                            ? 'text-green-600'
                            : selectedInvoice.status === 'OVERDUE'
                              ? 'text-red-600'
                              : 'text-yellow-600'
                        }`}
                      />
                    );
                  })()}
                  <div>
                    <p
                      className={`font-semibold ${
                        selectedInvoice.status === 'PAID'
                          ? 'text-green-800'
                          : selectedInvoice.status === 'OVERDUE'
                            ? 'text-red-800'
                            : 'text-yellow-800'
                      }`}
                    >
                      {selectedInvoice.status}
                    </p>
                    {selectedInvoice.paidAt && (
                      <p className="text-sm text-gray-600">
                        Paid on {formatDate(selectedInvoice.paidAt)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">Balance Due</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(selectedInvoice.balance)}
                  </p>
                </div>
              </div>

              {/* Invoice Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Semester
                  </label>
                  <p className="text-gray-900">
                    {selectedInvoice.semesterName}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Due Date
                  </label>
                  <p className="text-gray-900">
                    {formatDate(selectedInvoice.dueDate)}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500">
                    Created
                  </label>
                  <p className="text-gray-900">
                    {formatDate(selectedInvoice.createdAt)}
                  </p>
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
                    <tr className="border-t">
                      <td colSpan={3} className="text-right py-2 font-medium">
                        Subtotal
                      </td>
                      <td className="text-right py-2">
                        {formatCurrency(selectedInvoice.subtotal)}
                      </td>
                    </tr>
                    {selectedInvoice.discount > 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="text-right py-2 text-green-600"
                        >
                          Discount
                        </td>
                        <td className="text-right py-2 text-green-600">
                          -{formatCurrency(selectedInvoice.discount)}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t font-bold">
                      <td colSpan={3} className="text-right py-2">
                        Total
                      </td>
                      <td className="text-right py-2">
                        {formatCurrency(selectedInvoice.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Payments History */}
              {selectedInvoice.payments &&
                selectedInvoice.payments.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3">Payment History</h4>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">Payment #</th>
                          <th className="text-left py-2">Date</th>
                          <th className="text-left py-2">Method</th>
                          <th className="text-right py-2">Amount</th>
                          <th className="text-center py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {selectedInvoice.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="py-2">{payment.paymentNumber}</td>
                            <td className="py-2">
                              {formatDate(payment.paidAt || payment.createdAt)}
                            </td>
                            <td className="py-2">{payment.method}</td>
                            <td className="text-right py-2 font-medium">
                              {formatCurrency(payment.amount)}
                            </td>
                            <td className="text-center py-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                {payment.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
