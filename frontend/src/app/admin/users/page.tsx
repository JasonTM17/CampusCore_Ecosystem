'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usersApi } from '@/lib/api';
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
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { toast } from 'sonner';

interface UserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: string;
}

export default function AdminUsersPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await usersApi.getAll({
        page,
        limit: 20,
        search: search || undefined,
      });
      setUsers(response.data);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError('User records could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchUsers();
    }
  }, [canAccess, fetchUsers]);

  const pageSummary = useMemo(() => {
    if (users.length === 0) {
      return 'No matching records';
    }

    return `Page ${page} of ${totalPages}`;
  }, [page, totalPages, users.length]);

  if (!canAccess) {
    return <LoadingState label="Loading user management" className="m-8" />;
  }

  const resetForm = () => {
    setEditingUser(null);
    setFormError('');
    setFormData({ email: '', password: '', firstName: '', lastName: '' });
  };

  const openCreate = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEdit = (userRecord: UserRecord) => {
    setEditingUser(userRecord);
    setFormError('');
    setFormData({
      email: userRecord.email,
      password: '',
      firstName: userRecord.firstName,
      lastName: userRecord.lastName,
    });
    setShowCreateModal(true);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    await fetchUsers();
  };

  const handleDelete = async (userRecord: UserRecord) => {
    const shouldDelete = await confirm({
      title: 'Delete user',
      message: `Delete ${userRecord.firstName} ${userRecord.lastName}? This action removes the account record from the current admin view.`,
      confirmText: 'Delete user',
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await usersApi.delete(userRecord.id);
      toast.success('User deleted');
      await fetchUsers();
    } catch {
      toast.error('We could not delete that user.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSaving(true);

    try {
      if (editingUser) {
        await usersApi.update(editingUser.id, {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
        });
        toast.success('User updated');
      } else {
        await usersApi.create({
          email: formData.email.trim(),
          password: formData.password,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
        });
        toast.success('User created');
      }

      closeModal();
      await fetchUsers();
    } catch (err: any) {
      const message = err.response?.data?.message || 'The user record could not be saved.';
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title="User management"
      description="Review campus accounts, create new records, and keep sensitive actions behind explicit confirmation."
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create user
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="w-full max-w-xl">
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Search users
                </label>
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by email or name"
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
            title="User records unavailable"
            description={error}
            onRetry={() => void fetchUsers()}
          />
        ) : isLoading ? (
          <LoadingState label="Loading user records" />
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No matching users"
            description="Try another search term or create a new campus account."
            action={<Button onClick={openCreate}>Create user</Button>}
          />
        ) : (
          <AdminTableCard
            title="Campus accounts"
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
                      <th className="px-2 py-3 font-medium">Name</th>
                      <th className="px-2 py-3 font-medium">Email</th>
                      <th className="px-2 py-3 font-medium">Status</th>
                      <th className="px-2 py-3 font-medium">Created</th>
                      <th className="px-2 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {users.map((record) => (
                      <tr key={record.id}>
                        <td className="px-2 py-4">
                          <div className="font-medium text-foreground">
                            {record.firstName} {record.lastName}
                          </div>
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {record.email}
                        </td>
                        <td className="px-2 py-4">
                          <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {record.status}
                          </span>
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {new Date(record.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(record)}
                              aria-label={`Edit user ${record.firstName} ${record.lastName}`}
                              title={`Edit user ${record.firstName} ${record.lastName}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(record)}
                              aria-label={`Delete user ${record.firstName} ${record.lastName}`}
                              title={`Delete user ${record.firstName} ${record.lastName}`}
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
        isOpen={showCreateModal}
        onClose={closeModal}
        title={editingUser ? 'Edit user' : 'Create user'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          ) : null}

          <AdminFormField label="Email address">
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((current) => ({ ...current, email: e.target.value }))}
              disabled={Boolean(editingUser)}
              required
            />
          </AdminFormField>

          {!editingUser ? (
            <AdminFormField
              label="Temporary password"
              description="Use a temporary password and ask the user to rotate it after first sign-in."
            >
              <Input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData((current) => ({ ...current, password: e.target.value }))}
                required
              />
            </AdminFormField>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label="First name">
              <Input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData((current) => ({ ...current, firstName: e.target.value }))}
                required
              />
            </AdminFormField>
            <AdminFormField label="Last name">
              <Input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData((current) => ({ ...current, lastName: e.target.value }))}
                required
              />
            </AdminFormField>
          </div>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : editingUser ? 'Save changes' : 'Create user'}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
