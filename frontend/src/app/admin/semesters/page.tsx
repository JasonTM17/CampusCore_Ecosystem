'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { academicYearsApi, adminSemestersApi } from '@/lib/api';
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
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';

interface Semester {
  id: string;
  name: string;
  type: string;
  academicYearId: string;
  academicYear?: { year: number };
  startDate: string;
  endDate: string;
  status: string;
}

interface AcademicYearOption {
  id: string;
  year: number;
}

const semesterTypeOptions = [
  { value: 'FALL', label: 'Fall' },
  { value: 'SPRING', label: 'Spring' },
  { value: 'SUMMER', label: 'Summer' },
];

export default function AdminSemestersPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSemester, setEditingSemester] = useState<Semester | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'FALL',
    academicYearId: '',
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
    try {
      const response = await academicYearsApi.getAll({ limit: 1000 });
      setAcademicYears(response.data || []);
    } catch {
      // The table can still render without dropdown helpers.
    }
  }, []);

  const fetchSemesters = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await adminSemestersApi.getAll({ page, limit: 20 });
      const filteredSemesters = search
        ? response.data.filter(
            (semester: Semester) =>
              semester.name.toLowerCase().includes(search.toLowerCase()) ||
              semester.type.toLowerCase().includes(search.toLowerCase()) ||
              String(semester.academicYear?.year || '').includes(search.trim()),
          )
        : response.data;

      setSemesters(filteredSemesters);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Semesters could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchAcademicYears();
      void fetchSemesters();
    }
  }, [canAccess, fetchAcademicYears, fetchSemesters]);

  const pageSummary = useMemo(() => {
    if (semesters.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [page, semesters.length, totalPages]);

  const academicYearOptions = useMemo(
    () => [
      { value: '', label: 'Select academic year' },
      ...academicYears.map((year) => ({
        value: year.id,
        label: String(year.year),
      })),
    ],
    [academicYears],
  );

  if (!canAccess) {
    return <LoadingState label="Loading semesters" className="m-8" />;
  }

  const resetForm = () => {
    setEditingSemester(null);
    setFormData({
      name: '',
      type: 'FALL',
      academicYearId: '',
      startDate: '',
      endDate: '',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (semester: Semester) => {
    setEditingSemester(semester);
    setFormData({
      name: semester.name,
      type: semester.type,
      academicYearId: semester.academicYearId,
      startDate: semester.startDate.split('T')[0],
      endDate: semester.endDate.split('T')[0],
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
    await fetchSemesters();
  };

  const handleDelete = async (semester: Semester) => {
    const shouldDelete = await confirm({
      title: 'Delete semester',
      message: `Delete ${semester.name}? This removes the semester from the current admin view.`,
      confirmText: 'Delete semester',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await adminSemestersApi.delete(semester.id);
      toast.success('Semester deleted');
      await fetchSemesters();
    } catch {
      toast.error('We could not delete that semester.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingSemester) {
        await adminSemestersApi.update(editingSemester.id, formData);
        toast.success('Semester updated');
      } else {
        await adminSemestersApi.create(formData);
        toast.success('Semester created');
      }

      closeModal();
      await fetchSemesters();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ??
          'The semester could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title="Semesters"
      description="Keep registration windows and teaching periods anchored to a clean academic timeline."
      backLabel="Back to admin dashboard"
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create semester
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
                  Search semesters
                </label>
                <Input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by semester, type, or year"
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
            title="Semesters unavailable"
            description={error}
            onRetry={() => void fetchSemesters()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading semesters" />
        ) : semesters.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="No matching semesters"
            description="Create a semester to anchor sections, invoices, registration timing, and reporting."
            action={<Button onClick={openCreate}>Create semester</Button>}
          />
        ) : (
          <AdminTableCard
            title="Semester records"
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
                <table className="w-full min-w-[840px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Name</th>
                      <th className="px-2 py-3 font-medium">Type</th>
                      <th className="px-2 py-3 font-medium">Academic year</th>
                      <th className="px-2 py-3 font-medium">Start date</th>
                      <th className="px-2 py-3 font-medium">End date</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {semesters.map((semester) => (
                      <tr key={semester.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {semester.name}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {semester.type}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {semester.academicYear?.year || 'Unassigned'}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {new Date(semester.startDate).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {new Date(semester.endDate).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {semester.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(semester)}
                              aria-label={`Edit semester ${semester.name}`}
                              title={`Edit semester ${semester.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(semester)}
                              aria-label={`Delete semester ${semester.name}`}
                              title={`Delete semester ${semester.name}`}
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
        title={editingSemester ? 'Edit semester' : 'Create semester'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <AdminFormField label="Semester name">
            <Input
              type="text"
              value={formData.name}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="e.g. Fall 2026"
              required
            />
          </AdminFormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Type"
              value={formData.type}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  type: event.target.value,
                }))
              }
              options={semesterTypeOptions}
            />
            <Select
              label="Academic year"
              value={formData.academicYearId}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  academicYearId: event.target.value,
                }))
              }
              options={academicYearOptions}
              required
            />
          </div>

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
                : editingSemester
                  ? 'Save changes'
                  : 'Create semester'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
