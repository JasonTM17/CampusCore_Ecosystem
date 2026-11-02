'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  AdminToolbarCard,
  AdminToolbarMeta,
} from '@/components/admin/AdminSurface';
import { ResponsiveRecordList } from '@/components/admin/ResponsiveRecordList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { statusToneClass } from '@/components/ui/status';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import { adminAcademicsEn, adminAcademicsVi } from '@/i18n/messages-admin-academics';
import { toast } from 'sonner';
import { campusErrorMessage } from '@/lib/campus-error';
import { createRequestEpoch } from '@/lib/request-epoch';

interface AcademicYear {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
  isActive?: boolean;
  isCurrent?: boolean;
}

function buildAcademicYearUpdatePayload(
  baseline: AcademicYear,
  formData: { year: number; startDate: string; endDate: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const dateOnly = (value: string) => value.split('T')[0];
  if (Number(formData.year) !== baseline.year) payload.year = Number(formData.year);
  if (formData.startDate !== dateOnly(baseline.startDate)) payload.startDate = formData.startDate;
  if (formData.endDate !== dateOnly(baseline.endDate)) payload.endDate = formData.endDate;
  return payload;
}

export default function AdminAcademicYearsPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { href, locale, formatDate, formatNumber, messages } = useI18n();
  const router = useRouter();
  const copy = { en: adminAcademicsEn.academicYears, vi: adminAcademicsVi.academicYears }[locale];
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const academicYearsEpoch = useRef(createRequestEpoch()).current;
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    year: new Date().getFullYear(),
    startDate: '',
    endDate: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const editLabel = (year: number) =>
    copy.editLabel.replace('{year}', () => String(year));
  const deleteLabel = (year: number) =>
    copy.deleteLabel.replace('{year}', () => String(year));

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

  const fetchAcademicYears = useCallback(async () => {
    const epoch = academicYearsEpoch.begin();
    setIsLoading(true);
    setError('');

    try {
      // Search is a server-side filter: paging through 20-row pages and narrowing
      // them in the browser reports "no results" for anything on another page.
      const query = { page, limit: 20, search: search || undefined };
      const response = await academicYearsApi.getAll(query);
      if (!academicYearsEpoch.isCurrent(epoch)) return;
      setAcademicYears(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      if (!academicYearsEpoch.isCurrent(epoch)) return;
      setError(copy.loadFailed);
    } finally {
      if (!academicYearsEpoch.isCurrent(epoch)) return;
      setIsLoading(false);
    }
  }, [academicYearsEpoch, copy, page, search]);

  useEffect(() => () => {
    academicYearsEpoch.invalidate();
  }, [academicYearsEpoch]);

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
      void fetchAcademicYears();
    }
  }, [canAccess, fetchAcademicYears]);

  const pageSummary = useMemo(() => {
    if (academicYears.length === 0) {
      return copy.pageSummaryEmpty;
    }

    return copy.pageSummary
      .replace('{currentPage}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  }, [academicYears.length, copy, page, totalPages]);

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
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

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    // `search` and `page` are fetch dependencies, so committing the term here is
    // what re-issues the request. Calling the fetch directly would run it against
    // the previous closure and fire twice.
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleDelete = async (record: AcademicYear) => {
    const shouldDelete = await confirm({
      title: copy.deleteTitle,
      message: copy.deleteMessage.replace('{year}', () => String(record.year)),
      confirmText: copy.deleteConfirm,
      variant: 'destructive',
    });

    if (!shouldDelete) {
      return;
    }

    try {
      await academicYearsApi.delete(record.id);
      toast.success(copy.deleted);
      // Deleting the last row of a later page leaves a stale empty view;
      // step back so the page-effect refetches real content.
      if (academicYears.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchAcademicYears();
      }
    } catch {
      toast.error(copy.deleteFailed);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // A year that ends before it starts is always a typo; catch it client-side
    // instead of round-tripping to the API for a generic rejection.
    if (formData.startDate && formData.endDate && formData.endDate < formData.startDate) {
      toast.error(copy.endDateBeforeStart);
      return;
    }
    setIsSaving(true);

    try {
      if (editingYear) {
        const payload = buildAcademicYearUpdatePayload(editingYear, formData);
        if (Object.keys(payload).length > 0) {
          await academicYearsApi.update(editingYear.id, payload);
        }
        toast.success(copy.updated);
      } else {
        await academicYearsApi.create(formData);
        toast.success(copy.created);
      }

      closeModal();
      await fetchAcademicYears();
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

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchAcademicYears()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : academicYears.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
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
                items={academicYears}
                keyOf={(record) => record.id}
                ariaLabel={copy.tableTitle}
                renderCard={(record) => (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{record.year}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{copy.headers.year}</p>
                      </div>
                      <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(record.isActive || record.isCurrent ? 'success' : 'neutral')}`}>
                        {record.isActive || record.isCurrent ? copy.active : copy.inactive}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {copy.headers.startDate}
                        </dt>
                        <dd className="mt-1 text-foreground">{formatDate(record.startDate)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {copy.headers.endDate}
                        </dt>
                        <dd className="mt-1 text-foreground">{formatDate(record.endDate)}</dd>
                      </div>
                    </dl>
                    <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(record)}
                        aria-label={editLabel(record.year)}
                        title={editLabel(record.year)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void handleDelete(record)}
                        aria-label={deleteLabel(record.year)}
                        title={deleteLabel(record.year)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AdminRowActions>
                  </>
                )}
              >
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="bg-secondary text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">{copy.headers.year}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.startDate}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.endDate}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.status}</th>
                      <th className="px-2 py-3 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {academicYears.map((record) => (
                      <tr key={record.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          {record.year}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(record.startDate)}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(record.endDate)}
                        </td>
                        <td className="px-2 py-4">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(record.isActive || record.isCurrent ? 'success' : 'neutral')}`}>
                            {record.isActive || record.isCurrent ? copy.active : copy.inactive}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(record)}
                              aria-label={editLabel(record.year)}
                              title={editLabel(record.year)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(record)}
                              aria-label={deleteLabel(record.year)}
                              title={deleteLabel(record.year)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AdminRowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveRecordList>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingYear ? copy.editTitle : copy.createTitle}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <AdminFormField label={copy.yearLabel}>
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
            <AdminFormField label={copy.startDateLabel}>
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
            <AdminFormField label={copy.endDateLabel}>
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
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? copy.saving : editingYear ? messages.common.actions.saveChanges : copy.create}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
