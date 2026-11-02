'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  AdminToolbarCard,
  AdminToolbarMeta,
} from '@/components/admin/AdminSurface';
import { ResponsiveRecordList } from '@/components/admin/ResponsiveRecordList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { statusToneClass } from '@/components/ui/status';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { toast } from 'sonner';
import { useI18n } from '@/i18n';
import { adminAcademicsEn, adminAcademicsVi } from '@/i18n/messages-admin-academics';
import { campusErrorMessage } from '@/lib/campus-error';
import {
  getLocalizedDescription,
  getLocalizedName,
} from '@/lib/academic-content';

interface Department {
  id: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
  code: string;
  description?: string;
  descriptionEn?: string;
  descriptionVi?: string;
  isActive: boolean;
}

function departmentOverviewCounts(totalItems: number | null, departments: Department[]) {
  return {
    unitCount: totalItems,
    activeOnPageCount: departments.filter((department) => department.isActive).length,
  };
}

export default function AdminDepartmentsPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { href, locale, messages } = useI18n();
  const router = useRouter();
  const copy = { en: adminAcademicsEn.departments, vi: adminAcademicsVi.departments }[locale];
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [deletingDepartmentId, setDeletingDepartmentId] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [formData, setFormData] = useState({
    nameEn: '',
    nameVi: '',
    code: '',
    descriptionEn: '',
    descriptionVi: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const overviewCounts = departmentOverviewCounts(totalItems, departments);
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const editLabel = (name: string) =>
    copy.editLabel.replace('{name}', () => name);
  const deleteLabel = (name: string) =>
    copy.deleteLabel.replace('{name}', () => name);

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
    setIsLoading(true);
    setError('');

    try {
      // Search is a server-side filter: paging through 20-row pages and narrowing
      // them in the browser reports "no results" for anything on another page.
      const query = { page, limit: 20, search: search || undefined };
      const response = await departmentsApi.getAll(query);

      setDepartments(response.data || []);
      setTotalItems(response.meta?.total ?? null);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      setError(copy.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [copy, page, search]);

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
    }
  }, [canAccess, fetchDepartments]);

  const pageSummary = useMemo(() => {
    if (departments.length === 0) {
      return copy.pageSummaryEmpty;
    }

    return copy.pageSummary
      .replace('{currentPage}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  }, [copy, departments.length, page, totalPages]);

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const resetForm = () => {
    setEditingDepartment(null);
    setFormData({
      nameEn: '',
      nameVi: '',
      code: '',
      descriptionEn: '',
      descriptionVi: '',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (department: Department) => {
    setEditingDepartment(department);
    setFormData({
      nameEn: department.nameEn || department.name,
      nameVi: department.nameVi || '',
      code: department.code,
      descriptionEn: department.descriptionEn || department.description || '',
      descriptionVi: department.descriptionVi || '',
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

  const handleDelete = async (department: Department) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingDepartmentId(department.id);

    try {
      const departmentLabel = getLocalizedName(
        locale,
        department,
        department.name,
      );
      const shouldDelete = await confirm({
        title: copy.deleteTitle,
        message: copy.deleteMessage.replace('{name}', () => departmentLabel),
        confirmText: copy.deleteConfirm,
        variant: 'destructive',
      });

      if (!shouldDelete) return;

      await departmentsApi.delete(department.id);
      toast.success(copy.deleted);
      if (departments.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchDepartments();
      }
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      deletingRef.current = false;
      setDeletingDepartmentId(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const payload = {
        ...formData,
        name: formData.nameEn || formData.nameVi,
        description: formData.descriptionEn || formData.descriptionVi,
        descriptionEn: formData.descriptionEn,
        descriptionVi: formData.descriptionVi,
      };
      if (editingDepartment) {
        await departmentsApi.update(editingDepartment.id, payload);
        toast.success(copy.updated);
      } else {
        await departmentsApi.create(payload);
        toast.success(copy.created);
      }

      closeModal();
      await fetchDepartments();
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
        {/* Executive Department Overview & Campus Lab Banner */}
        <div className="relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-br from-primary/10 via-background to-secondary/20 shadow-xs">
          <div className="grid grid-cols-1 lg:grid-cols-12 items-center">
            <div className="p-6 lg:col-span-8 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Building2 className="h-3.5 w-3.5" />
                <span>{copy.banner.eyebrow}</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {copy.banner.title}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground max-w-2xl">
                {copy.banner.description}
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-2 text-xs font-medium text-muted-foreground">
                <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/80 px-3 py-1.5 shadow-2xs">
                  <span className="font-bold text-foreground text-sm">{overviewCounts.unitCount ?? '—'}</span>
                  <span>{copy.banner.unitsLabel}</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/80 px-3 py-1.5 shadow-2xs">
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    {overviewCounts.activeOnPageCount}
                  </span>
                  <span>{copy.banner.activeOnPage}</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/80 px-3 py-1.5 shadow-2xs">
                  <span className="font-bold text-primary text-sm">100%</span>
                  <span>{copy.banner.curriculumLabel}</span>
                </div>
              </div>
            </div>
            <div className="relative h-48 lg:h-full lg:col-span-4 overflow-hidden border-t lg:border-t-0 lg:border-l border-border/60 min-h-[160px]">
              <picture className="absolute inset-0 block">
                <source srcSet="/images/banners/department_research_lab.webp" type="image/webp" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/banners/department_research_lab.jpg"
                  alt={copy.banner.imageAlt}
                  width={1376}
                  height={768}
                  className="h-full w-full object-cover object-center transition duration-500 hover:scale-105"
                />
              </picture>
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent lg:hidden" />
              <div className="absolute bottom-2 left-3 rounded-md bg-background/80 px-2 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur-xs">
                {copy.banner.labLabel}
              </div>
            </div>
          </div>
        </div>

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

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchDepartments()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : departments.length === 0 ? (
          <EmptyState
            icon={Building2}
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
              <ResponsiveRecordList
                items={departments}
                keyOf={(department) => department.id}
                ariaLabel={copy.tableTitle}
                renderCard={(department) => {
                  const departmentLabel = getLocalizedName(locale, department, department.name);
                  const departmentDescription = getLocalizedDescription(
                    locale,
                    department,
                    copy.noDescription,
                  );

                  return (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                            {department.code}
                          </p>
                          <h3 className="mt-1 font-semibold text-foreground">{departmentLabel}</h3>
                        </div>
                        <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(department.isActive ? 'success' : 'neutral')}`}>
                          {department.isActive ? copy.active : copy.inactive}
                        </span>
                      </div>
                      <p className="mt-4 border-t border-border/60 pt-3 text-sm leading-6 text-muted-foreground">
                        {departmentDescription}
                      </p>
                      <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(department)}
                          aria-label={editLabel(departmentLabel)}
                          title={editLabel(departmentLabel)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(department)}
                          disabled={deletingDepartmentId !== null}
                          aria-label={deleteLabel(departmentLabel)}
                          title={deleteLabel(departmentLabel)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AdminRowActions>
                    </>
                  );
                }}
              >
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-secondary/50 text-left text-muted-foreground">
                      <th className="px-4 py-3.5 font-medium">{copy.headers.code}</th>
                      <th className="px-4 py-3.5 font-medium">{copy.headers.name}</th>
                      <th className="px-4 py-3.5 font-medium">{copy.headers.description}</th>
                      <th className="px-4 py-3.5 font-medium">{copy.headers.status}</th>
                      <th className="px-4 py-3.5 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {departments.map((department) => {
                      const departmentLabel = getLocalizedName(
                        locale,
                        department,
                        department.name,
                      );
                      const departmentDescription = getLocalizedDescription(
                        locale,
                        department,
                        copy.noDescription,
                      );

                      return (
                      <tr key={department.id} className="transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3.5 font-medium text-foreground">
                          {department.code}
                        </td>
                        <td className="px-4 py-3.5 text-foreground">
                          <div className="space-y-1">
                            <div>{departmentLabel}</div>
                            {department.nameEn && department.nameVi ? (
                              <div className="text-xs text-muted-foreground">
                                {locale === 'vi'
                                  ? department.nameEn
                                  : department.nameVi}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {departmentDescription}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(department.isActive ? 'success' : 'neutral')}`}>
                            {department.isActive ? copy.active : copy.inactive}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(department)}
                              aria-label={editLabel(departmentLabel)}
                              title={editLabel(departmentLabel)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(department)}
                              disabled={deletingDepartmentId !== null}
                              aria-label={deleteLabel(departmentLabel)}
                              title={deleteLabel(departmentLabel)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AdminRowActions>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ResponsiveRecordList>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingDepartment ? copy.editTitle : copy.createTitle}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label={copy.fields.code}>
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
            <AdminFormField label={copy.fields.englishName}>
              <Input
                type="text"
                value={formData.nameEn}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    nameEn: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
            <AdminFormField
              label={copy.fields.vietnameseName}
            >
              <Input
                type="text"
                value={formData.nameVi}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    nameVi: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField
              label={copy.fields.englishDescription}
            >
              <Textarea
                value={formData.descriptionEn}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    descriptionEn: event.target.value,
                  }))
                }
                rows={4}
              />
            </AdminFormField>
            <AdminFormField
              label={copy.fields.vietnameseDescription}
            >
              <Textarea
                value={formData.descriptionVi}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    descriptionVi: event.target.value,
                  }))
                }
                rows={4}
              />
            </AdminFormField>
          </div>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? copy.saving
                : editingDepartment
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
