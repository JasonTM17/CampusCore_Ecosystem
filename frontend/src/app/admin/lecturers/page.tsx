'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { departmentsApi, lecturersApi } from '@/lib/api';
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

interface Lecturer {
  id: string;
  employeeId: string;
  userId: string;
  departmentId: string;
  specialization?: string;
  isActive: boolean;
  user?: { firstName: string; lastName: string; email: string };
  department?: { name: string };
}

interface Department {
  id: string;
  name: string;
}

export default function AdminLecturersPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLecturer, setEditingLecturer] = useState<Lecturer | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    employeeId: '',
    userId: '',
    departmentId: '',
    specialization: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchDepartments = useCallback(async () => {
    try {
      const response = await departmentsApi.getAll({ limit: 1000 });
      setDepartments(response.data || []);
    } catch {
      // Department lookup is optional for the table shell.
    }
  }, []);

  const fetchLecturers = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await lecturersApi.getAll({ page, limit: 20 });
      const filteredLecturers = search
        ? response.data.filter((lecturer: Lecturer) => {
            const fullName = `${lecturer.user?.firstName || ''} ${lecturer.user?.lastName || ''}`
              .trim()
              .toLowerCase();
            const query = search.toLowerCase();

            return (
              lecturer.employeeId.toLowerCase().includes(query) ||
              lecturer.user?.email?.toLowerCase().includes(query) ||
              fullName.includes(query)
            );
          })
        : response.data;

      setLecturers(filteredLecturers);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Lecturers could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchDepartments();
      void fetchLecturers();
    }
  }, [canAccess, fetchDepartments, fetchLecturers]);

  const pageSummary = useMemo(() => {
    if (lecturers.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [lecturers.length, page, totalPages]);

  const departmentOptions = useMemo(
    () => [
      { value: '', label: 'Select department' },
      ...departments.map((department) => ({
        value: department.id,
        label: department.name,
      })),
    ],
    [departments],
  );

  if (!canAccess) {
    return <LoadingState label="Loading lecturers" className="m-8" />;
  }

  const resetForm = () => {
    setEditingLecturer(null);
    setFormData({
      employeeId: '',
      userId: '',
      departmentId: '',
      specialization: '',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (lecturer: Lecturer) => {
    setEditingLecturer(lecturer);
    setFormData({
      employeeId: lecturer.employeeId,
      userId: lecturer.userId,
      departmentId: lecturer.departmentId,
      specialization: lecturer.specialization || '',
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
    await fetchLecturers();
  };

  const handleDelete = async (lecturer: Lecturer) => {
    const shouldDelete = await confirm({
      title: 'Delete lecturer',
      message: `Delete ${lecturer.employeeId}? This removes the lecturer from the current admin view.`,
      confirmText: 'Delete lecturer',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await lecturersApi.delete(lecturer.id);
      toast.success('Lecturer deleted');
      await fetchLecturers();
    } catch {
      toast.error('We could not delete that lecturer.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingLecturer) {
        await lecturersApi.update(editingLecturer.id, formData);
        toast.success('Lecturer updated');
      } else {
        await lecturersApi.create(formData);
        toast.success('Lecturer created');
      }

      closeModal();
      await fetchLecturers();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ??
          'The lecturer profile could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title="Lecturers"
      description="Keep teaching assignments tied to the right people, departments, and profile metadata."
      backLabel="Back to admin dashboard"
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create lecturer
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
                  Search lecturers
                </label>
                <Input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, email, or employee ID"
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
            title="Lecturers unavailable"
            description={error}
            onRetry={() => void fetchLecturers()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading lecturers" />
        ) : lecturers.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No matching lecturers"
            description="Create a lecturer profile to keep schedules, sections, and grading ownership aligned."
            action={<Button onClick={openCreate}>Create lecturer</Button>}
          />
        ) : (
          <AdminTableCard
            title="Lecturer records"
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
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">Employee ID</th>
                      <th className="px-2 py-3 font-medium">Lecturer</th>
                      <th className="px-2 py-3 font-medium">Email</th>
                      <th className="px-2 py-3 font-medium">Department</th>
                      <th className="px-2 py-3 font-medium">Specialization</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {lecturers.map((lecturer) => (
                      <tr key={lecturer.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {lecturer.employeeId}
                        </td>
                        <td className="px-2 py-4 text-foreground">
                          {lecturer.user
                            ? `${lecturer.user.firstName} ${lecturer.user.lastName}`
                            : 'Unlinked account'}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {lecturer.user?.email || 'No email'}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {lecturer.department?.name || 'Unassigned'}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {lecturer.specialization || 'Not provided'}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {lecturer.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(lecturer)}
                              aria-label={`Edit lecturer ${lecturer.employeeId}`}
                              title={`Edit lecturer ${lecturer.employeeId}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(lecturer)}
                              aria-label={`Delete lecturer ${lecturer.employeeId}`}
                              title={`Delete lecturer ${lecturer.employeeId}`}
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
        title={editingLecturer ? 'Edit lecturer' : 'Create lecturer'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label="Employee ID">
              <Input
                type="text"
                value={formData.employeeId}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    employeeId: event.target.value,
                  }))
                }
                disabled={Boolean(editingLecturer)}
                required
              />
            </AdminFormField>
            <AdminFormField label="Linked user ID">
              <Input
                type="text"
                value={formData.userId}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                disabled={Boolean(editingLecturer)}
                placeholder="Existing user account ID"
                required
              />
            </AdminFormField>
          </div>

          <Select
            label="Department"
            value={formData.departmentId}
            onChange={(event) =>
              setFormData((current) => ({
                ...current,
                departmentId: event.target.value,
              }))
            }
            options={departmentOptions}
            required
          />

          <AdminFormField label="Specialization">
            <Input
              type="text"
              value={formData.specialization}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  specialization: event.target.value,
                }))
              }
              placeholder="Optional subject or field focus"
            />
          </AdminFormField>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingLecturer
                  ? 'Save changes'
                  : 'Create lecturer'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
