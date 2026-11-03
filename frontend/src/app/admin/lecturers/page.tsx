'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { statusToneClass } from '@/components/ui/status';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import { adminAcademicsEn, adminAcademicsVi } from '@/i18n/messages-admin-academics';
import { campusErrorKind, campusErrorMessage } from '@/lib/campus-error';
import { createRequestEpoch } from '@/lib/request-epoch';
import { getLocalizedName } from '@/lib/academic-content';
import { ACADEMIC_REFERENCE_LIMIT } from '@/lib/reference-data';

interface Lecturer {
  id: string;
  employeeId: string;
  userId: string;
  departmentId: string;
  specialization?: string;
  isActive: boolean;
  user?: { firstName: string; lastName: string; email: string };
  department?: { name: string; nameEn?: string; nameVi?: string };
}

interface Department {
  id: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
}

function buildLecturerUpdatePayload(
  baseline: Lecturer,
  formData: { departmentId: string; specialization: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (formData.departmentId !== baseline.departmentId) payload.departmentId = formData.departmentId;
  if (formData.specialization !== (baseline.specialization || '')) {
    payload.specialization = formData.specialization;
  }
  return payload;
}

export default function AdminLecturersPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { href, locale, messages } = useI18n();
  const router = useRouter();
  const copy = { en: adminAcademicsEn.lecturers, vi: adminAcademicsVi.lecturers }[locale];
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLecturer, setEditingLecturer] = useState<Lecturer | null>(null);
  const lecturersEpoch = useRef(createRequestEpoch()).current;
  const [isSaving, setIsSaving] = useState(false);
  const [deletingLecturerId, setDeletingLecturerId] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [formData, setFormData] = useState({
    employeeId: '',
    userId: '',
    departmentId: '',
    specialization: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const editLabel = (employeeId: string) =>
    copy.editLabel.replace('{employeeId}', () => employeeId);
  const deleteLabel = (employeeId: string) =>
    copy.deleteLabel.replace('{employeeId}', () => employeeId);

  useEffect(() => {
    if (isAuthLoading || isLoggingOut) {
      return;
    }

    if (!user) {
      router.replace(`${href('/login')}?portal=admin&reason=session-expired`);
      return;
    }

    if (!isAdmin && !isSuperAdmin) {
      router.replace(href('/dashboard'));
    }
  }, [href, isAdmin, isSuperAdmin, isAuthLoading, isLoggingOut, router, user]);

  const fetchDepartments = useCallback(async () => {
    setReferenceError('');
    try {
      const response = await departmentsApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT });
      setDepartments(response.data || []);
    } catch {
      setReferenceError(copy.referenceLoadFailed);
    }
  }, [copy]);

  const fetchLecturers = useCallback(async () => {
    const epoch = lecturersEpoch.begin();
    setIsLoading(true);
    setError('');

    try {
      // Search is a server-side filter: paging through 20-row pages and narrowing
      // them in the browser reports "no results" for anything on another page.
      const query = { page, limit: 20, search: search || undefined };
      const response = await lecturersApi.getAll(query);

      if (!lecturersEpoch.isCurrent(epoch)) return;
      setLecturers(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      if (!lecturersEpoch.isCurrent(epoch)) return;
      setError(copy.loadFailed);
    } finally {
      if (!lecturersEpoch.isCurrent(epoch)) return;
      setIsLoading(false);
    }
  }, [copy, lecturersEpoch, page, search]);

  useEffect(() => () => {
    lecturersEpoch.invalidate();
  }, [lecturersEpoch]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) {
      return;
    }
    if (!trimmed) {
      setSearch('');
      setPage(1);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearch(trimmed);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    if (canAccess) {
      void fetchDepartments();
      void fetchLecturers();
    }
  }, [canAccess, fetchDepartments, fetchLecturers]);

  const pageSummary = useMemo(() => {
    if (lecturers.length === 0) {
      return copy.pageSummaryEmpty;
    }

    return copy.pageSummary
      .replace('{currentPage}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  }, [copy, lecturers.length, page, totalPages]);

  const departmentOptions = useMemo(
    () => [
      { value: '', label: copy.selectDepartment },
      ...departments.map((department) => ({
        value: department.id,
        label: getLocalizedName(locale, department, department.name),
      })),
    ],
    [copy.selectDepartment, departments, locale],
  );

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
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

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    // `search` and `page` are fetch dependencies, so committing the term here is
    // what re-issues the request. Calling the fetch directly would run it against
    // the previous closure and fire twice.
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleDelete = async (lecturer: Lecturer) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingLecturerId(lecturer.id);

    try {
      const shouldDelete = await confirm({
        title: copy.deleteTitle,
        message: copy.deleteMessage.replace('{employeeId}', () => lecturer.employeeId),
        confirmText: copy.deleteConfirm,
        variant: 'destructive',
      });

      if (!shouldDelete) {
        return;
      }

      await lecturersApi.delete(lecturer.id).catch((deleteError: unknown) => {
        // The goal state of a delete is the row being gone: an already-removed
        // row answers 404, which is still a success, not a false failure.
        if (campusErrorKind(deleteError) !== 'notFound') throw deleteError;
      });
      toast.success(copy.deleted);
      if (lecturers.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchLecturers();
      }
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      deletingRef.current = false;
      setDeletingLecturerId(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingLecturer) {
        const payload = buildLecturerUpdatePayload(editingLecturer, formData);
        if (Object.keys(payload).length > 0) {
          await lecturersApi.update(editingLecturer.id, payload);
        }
        toast.success(copy.updated);
      } else {
        await lecturersApi.create(formData);
        toast.success(copy.created);
      }

      closeModal();
      await fetchLecturers();
    } catch (requestError: unknown) {
      toast.error(
        campusErrorMessage(
          requestError,
          messages.common.campusErrors,
          copy.saveFailed,
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      actions={
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {copy.create}
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
                  {copy.searchLabel}
                </label>
                <Input
                  type="text"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  aria-label={copy.searchLabel}
                  icon={<Search className="h-4 w-4" />}
                />
              </div>
              <AdminToolbarMeta
                summary={pageSummary}
                actions={
                  <Button type="submit" variant="outline">
                    {messages.common.actions.search}
                  </Button>
                }
              />
            </form>
        </AdminToolbarCard>

        {referenceError ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={referenceError}
            onRetry={() => void fetchDepartments()}
          />
        ) : null}

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchLecturers()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : lecturers.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            action={<Button onClick={openCreate}>{copy.create}</Button>}
          />
        ) : (
          <AdminTableCard
            title={copy.tableTitle}
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
              <div className="space-y-3 md:hidden" role="list" aria-label={copy.tableTitle}>
                {lecturers.map((lecturer) => {
                  const lecturerLabel = lecturer.user
                    ? `${lecturer.user.lastName ?? ''} ${lecturer.user.firstName ?? ''}`.trim()
                    : copy.unlinkedAccount;
                  const departmentLabel = getLocalizedName(
                    locale,
                    lecturer.department,
                    lecturer.department?.name || copy.unassigned,
                  );

                  return (
                    <article
                      key={`${lecturer.id}-mobile`}
                      className="rounded-lg border border-border/70 bg-card p-4 shadow-sm"
                      role="listitem"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                            {lecturer.employeeId}
                          </p>
                          <h3 className="mt-1 font-semibold text-foreground">{lecturerLabel}</h3>
                          <p className="mt-1 break-all text-sm text-muted-foreground">
                            {lecturer.user?.email || copy.noEmail}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(lecturer.isActive ? 'success' : 'neutral')}`}>
                          {lecturer.isActive ? copy.active : copy.inactive}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.department}
                          </dt>
                          <dd className="mt-1 text-foreground">{departmentLabel}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.specialization}
                          </dt>
                          <dd className="mt-1 text-foreground">
                            {lecturer.specialization || copy.notProvided}
                          </dd>
                        </div>
                      </dl>
                      <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(lecturer)}
                          aria-label={editLabel(lecturer.employeeId)}
                          title={editLabel(lecturer.employeeId)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(lecturer)}
                          disabled={deletingLecturerId !== null}
                          aria-label={deleteLabel(lecturer.employeeId)}
                          title={deleteLabel(lecturer.employeeId)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AdminRowActions>
                    </article>
                  );
                })}
              </div>
              <AdminTableScroll className="hidden md:block">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="bg-secondary text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">{copy.headers.employeeId}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.lecturer}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.email}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.department}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.specialization}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.status}</th>
                      <th className="px-2 py-3 text-right font-medium">{copy.headers.actions}</th>
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
                            ? `${lecturer.user.lastName ?? ''} ${lecturer.user.firstName ?? ''}`.trim()
                            : copy.unlinkedAccount}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {lecturer.user?.email || copy.noEmail}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {getLocalizedName(
                            locale,
                            lecturer.department,
                            lecturer.department?.name || copy.unassigned,
                          )}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {lecturer.specialization || copy.notProvided}
                        </td>
                        <td className="px-2 py-4">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(lecturer.isActive ? 'success' : 'neutral')}`}>
                            {lecturer.isActive ? copy.active : copy.inactive}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(lecturer)}
                              aria-label={editLabel(lecturer.employeeId)}
                              title={editLabel(lecturer.employeeId)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(lecturer)}
                              disabled={deletingLecturerId !== null}
                              aria-label={deleteLabel(lecturer.employeeId)}
                              title={deleteLabel(lecturer.employeeId)}
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
        title={editingLecturer ? copy.editTitle : copy.createTitle}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label={copy.fields.employeeId}>
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
            <AdminFormField label={copy.fields.userId}>
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
                placeholder={copy.fields.userIdPlaceholder}
                required
              />
            </AdminFormField>
          </div>

          <Select
            label={copy.fields.department}
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

          <AdminFormField label={copy.fields.specialization}>
            <Input
              type="text"
              value={formData.specialization}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  specialization: event.target.value,
                }))
              }
              placeholder={copy.fields.specializationPlaceholder}
            />
          </AdminFormField>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? copy.saving
                : editingLecturer
                  ? messages.common.actions.saveChanges
                  : copy.create}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
