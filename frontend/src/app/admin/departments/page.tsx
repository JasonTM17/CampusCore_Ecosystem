'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { departmentsApi } from '@/lib/api';
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
import { Textarea } from '@/components/ui/textarea';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { toast } from 'sonner';

interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
}

export default function AdminDepartmentsPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchDepartments = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await departmentsApi.getAll({ page, limit: 20 });
      const filteredDepartments = search
        ? response.data.filter(
            (department) =>
              department.name.toLowerCase().includes(search.toLowerCase()) ||
              department.code.toLowerCase().includes(search.toLowerCase()),
          )
        : response.data;

      setDepartments(filteredDepartments);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('Departments could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchDepartments();
    }
  }, [canAccess, fetchDepartments]);

  const pageSummary = useMemo(() => {
    if (departments.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [departments.length, page, totalPages]);

  if (!canAccess) {
    return <LoadingState label="Loading departments" className="m-8" />;
  }

  const resetForm = () => {
    setEditingDepartment(null);
    setFormData({ name: '', code: '', description: '' });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (department: Department) => {
    setEditingDepartment(department);
    setFormData({
      name: department.name,
      code: department.code,
      description: department.description || '',
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
    await fetchDepartments();
  };

  const handleDelete = async (department: Department) => {
    const shouldDelete = await confirm({
      title: 'Delete department',
      message: `Delete ${department.name}? This removes the department from the current admin view.`,
      confirmText: 'Delete department',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await departmentsApi.delete(department.id);
      toast.success('Department deleted');
      await fetchDepartments();
    } catch {
      toast.error('We could not delete that department.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingDepartment) {
        await departmentsApi.update(editingDepartment.id, formData);
        toast.success('Department updated');
      } else {
        await departmentsApi.create(formData);
        toast.success('Department created');
      }

      closeModal();
      await fetchDepartments();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ??
          'The department could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title="Departments"
      description="Keep the academic structure readable for courses, lecturers, and downstream reporting."
      backLabel="Back to admin dashboard"
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create department
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
                  Search departments
                </label>
                <Input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or code"
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
            title="Departments unavailable"
            description={error}
            onRetry={() => void fetchDepartments()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading departments" />
        ) : departments.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No matching departments"
            description="Create a department to anchor courses, lecturer assignments, and catalog ownership."
            action={<Button onClick={openCreate}>Create department</Button>}
          />
        ) : (
          <AdminTableCard
            title="Department records"
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
                      <th className="px-2 py-3 font-medium">Code</th>
                      <th className="px-2 py-3 font-medium">Name</th>
                      <th className="px-2 py-3 font-medium">Description</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {departments.map((department) => (
                      <tr key={department.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {department.code}
                        </td>
                        <td className="px-2 py-4 text-foreground">
                          {department.name}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {department.description || 'No description'}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {department.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(department)}
                              aria-label={`Edit department ${department.name}`}
                              title={`Edit department ${department.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(department)}
                              aria-label={`Delete department ${department.name}`}
                              title={`Delete department ${department.name}`}
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
        title={editingDepartment ? 'Edit department' : 'Create department'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label="Code">
              <Input
                type="text"
                value={formData.code}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                disabled={Boolean(editingDepartment)}
                required
              />
            </AdminFormField>
            <AdminFormField label="Name">
              <Input
                type="text"
                value={formData.name}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
          </div>

          <AdminFormField label="Description">
            <Textarea
              value={formData.description}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={4}
            />
          </AdminFormField>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingDepartment
                  ? 'Save changes'
                  : 'Create department'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
