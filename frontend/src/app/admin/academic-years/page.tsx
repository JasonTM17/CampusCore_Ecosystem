'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { academicYearsApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminFormField,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminTableScroll,
  AdminToolbarCard,
  AdminToolbarMeta,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { toast } from 'sonner';

interface AcademicYear {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
  isActive?: boolean;
  isCurrent?: boolean;
}

export default function AdminAcademicYearsPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    year: new Date().getFullYear(),
    startDate: '',
    endDate: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchAcademicYears = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await academicYearsApi.getAll({ page, limit: 20 });
      const filteredYears = search
        ? response.data.filter((entry) =>
            entry.year.toString().includes(search.trim()),
          )
        : response.data;

      setAcademicYears(filteredYears);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Academic years could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchAcademicYears();
    }
  }, [canAccess, fetchAcademicYears]);

  const pageSummary = useMemo(() => {
    if (academicYears.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [academicYears.length, page, totalPages]);

  if (!canAccess) {
    return <LoadingState label="Loading academic years" className="m-8" />;
  }

  const resetForm = () => {
    setEditingYear(null);
    setFormData({
      year: new Date().getFullYear(),
      startDate: '',
      endDate: '',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (year: AcademicYear) => {
    setEditingYear(year);
    setFormData({
      year: year.year,
      startDate: year.startDate.split('T')[0],
      endDate: year.endDate.split('T')[0],
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    await fetchAcademicYears();
  };

  const handleDelete = async (record: AcademicYear) => {
    const shouldDelete = await confirm({
      title: 'Delete academic year',
      message: `Delete ${record.year}? This removes the academic year from the current admin view.`,
      confirmText: 'Delete academic year',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await academicYearsApi.delete(record.id);
      toast.success('Academic year deleted');
      await fetchAcademicYears();
    } catch {
      toast.error('We could not delete that academic year.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingYear) {
        await academicYearsApi.update(editingYear.id, formData);
        toast.success('Academic year updated');
      } else {
        await academicYearsApi.create(formData);
        toast.success('Academic year created');
      }

      closeModal();
      await fetchAcademicYears();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ??
          'The academic year could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title="Academic years"
      description="Keep the academic calendar clean, searchable, and deliberate before semesters and registration windows build on top of it."
      backLabel="Back to admin dashboard"
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create academic year
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <form
              onSubmit={handleSearch}
              className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
            >
              <div className="w-full max-w-xl">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Search academic years
                </label>
                <Input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by year"
                  icon={<Search className="h-4 w-4" />}
                />
              </div>
              <AdminToolbarMeta
                summary={pageSummary}
                actions={
                  <Button type="submit" variant="outline">
                    Search
                  </Button>
                }
              />
            </form>
        </AdminToolbarCard>

        {error ? (
          <ErrorState
            title="Academic years unavailable"
            description={error}
            onRetry={() => void fetchAcademicYears()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading academic years" />
        ) : academicYears.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="No matching academic years"
            description="Create a new academic year to give semester planning a clean anchor."
            action={<Button onClick={openCreate}>Create academic year</Button>}
          />
        ) : (
          <AdminTableCard
            title="Academic year records"
            footer={
              <AdminPaginationFooter
                summary={pageSummary}
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            }
          >
              <AdminTableScroll>
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Year</th>
                      <th className="px-2 py-3 font-medium">Start date</th>
                      <th className="px-2 py-3 font-medium">End date</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {academicYears.map((record) => (
                      <tr key={record.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {record.year}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {new Date(record.startDate).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {new Date(record.endDate).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {record.isActive || record.isCurrent ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(record)}
                              aria-label={`Edit academic year ${record.year}`}
                              title={`Edit academic year ${record.year}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(record)}
                              aria-label={`Delete academic year ${record.year}`}
                              title={`Delete academic year ${record.year}`}
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
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingYear ? 'Edit academic year' : 'Create academic year'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <AdminFormField label="Year">
            <Input
              type="number"
              min="2000"
              max="2100"
              value={formData.year}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  year: Number(event.target.value) || new Date().getFullYear(),
                }))
              }
              required
              />
          </AdminFormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label="Start date">
              <Input
                type="date"
                value={formData.startDate}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
            <AdminFormField label="End date">
              <Input
                type="date"
                value={formData.endDate}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
          </div>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingYear
                  ? 'Save changes'
                  : 'Create academic year'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
