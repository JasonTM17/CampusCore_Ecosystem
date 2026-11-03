'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { statusToneClass, type StatusTone } from '@/components/ui/status';
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

interface Semester {
  id: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
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

function semesterStatusTone(status: string): StatusTone {
  switch (status) {
    case 'ACTIVE':
    case 'IN_PROGRESS':
      return 'success';
    case 'REGISTRATION_OPEN':
    case 'ADD_DROP_OPEN':
      return 'info';
    case 'DRAFT':
      return 'warning';
    default:
      return 'neutral';
  }
}

function buildSemesterUpdatePayload(
  baseline: Semester,
  formData: {
    nameEn: string;
    nameVi: string;
    type: string;
    academicYearId: string;
    startDate: string;
    endDate: string;
  },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const dateOnly = (value: string) => value.split('T')[0];
  const nameEnChanged = formData.nameEn !== (baseline.nameEn || baseline.name);
  const nameViChanged = formData.nameVi !== (baseline.nameVi || '');

  if (nameEnChanged) payload.nameEn = formData.nameEn;
  if (nameViChanged) payload.nameVi = formData.nameVi;
  const name = formData.nameEn || formData.nameVi;
  if ((nameEnChanged || nameViChanged) && name !== baseline.name) payload.name = name;
  if (formData.type !== baseline.type) payload.type = formData.type;
  if (formData.academicYearId !== baseline.academicYearId) {
    payload.academicYearId = formData.academicYearId;
  }
  if (formData.startDate !== dateOnly(baseline.startDate)) payload.startDate = formData.startDate;
  if (formData.endDate !== dateOnly(baseline.endDate)) payload.endDate = formData.endDate;
  return payload;
}

export default function AdminSemestersPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { href, locale, formatDate, messages } = useI18n();
  const router = useRouter();
  const copy = { en: adminAcademicsEn.semesters, vi: adminAcademicsVi.semesters }[locale];
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSemester, setEditingSemester] = useState<Semester | null>(null);
  const semestersEpoch = useRef(createRequestEpoch()).current;
  const [isSaving, setIsSaving] = useState(false);
  const [deletingSemesterId, setDeletingSemesterId] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [formData, setFormData] = useState({
    nameEn: '',
    nameVi: '',
    type: 'FIRST',
    academicYearId: '',
    startDate: '',
    endDate: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
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

  const fetchAcademicYears = useCallback(async () => {
    setReferenceError('');
    try {
      const response = await academicYearsApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT });
      setAcademicYears(response.data || []);
    } catch {
      setReferenceError(copy.referenceLoadFailed);
    }
  }, [copy]);

  const fetchSemesters = useCallback(async () => {
    const epoch = semestersEpoch.begin();
    setIsLoading(true);
    setError('');

    try {
      // Search is a server-side filter: paging through 20-row pages and narrowing
      // them in the browser reports "no results" for anything on another page.
      const query = { page, limit: 20, search: search || undefined };
      const response = await adminSemestersApi.getAll(query);

      if (!semestersEpoch.isCurrent(epoch)) return;
      setSemesters(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      if (!semestersEpoch.isCurrent(epoch)) return;
      setError(copy.loadFailed);
    } finally {
      if (!semestersEpoch.isCurrent(epoch)) return;
      setIsLoading(false);
    }
  }, [copy, page, search, semestersEpoch]);

  useEffect(() => () => {
    semestersEpoch.invalidate();
  }, [semestersEpoch]);

  const semesterTypeOptions = useMemo(
    () => [
      // FIRST/SECOND match the seeded semester vocabulary; FALL/SPRING stay so
      // older records still resolve to a label instead of a raw enum.
      { value: 'FIRST', label: copy.typeOptions.FIRST },
      { value: 'SECOND', label: copy.typeOptions.SECOND },
      { value: 'SUMMER', label: copy.typeOptions.SUMMER },
      { value: 'FALL', label: copy.typeOptions.FALL },
      { value: 'SPRING', label: copy.typeOptions.SPRING },
    ],
    [copy.typeOptions],
  );

  const getSemesterTypeLabel = useCallback(
    (type: string) =>
      semesterTypeOptions.find((option) => option.value === type)?.label ?? type,
    [semesterTypeOptions],
  );

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
      void fetchSemesters();
    }
  }, [canAccess, fetchAcademicYears, fetchSemesters]);

  const pageSummary = useMemo(() => {
    if (semesters.length === 0) {
      return copy.pageSummaryEmpty;
    }

    return copy.pageSummary
      .replace('{currentPage}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  }, [copy, page, semesters.length, totalPages]);

  const academicYearOptions = useMemo(
    () => [
      { value: '', label: copy.selectAcademicYear },
      ...academicYears.map((year) => ({
        value: year.id,
        label: String(year.year),
      })),
    ],
    [academicYears, copy.selectAcademicYear],
  );

  const semesterStatusLabel = (status: string) =>
    copy.statusLabels[status as keyof typeof copy.statusLabels] ??
    messages.common.statuses[status as keyof typeof messages.common.statuses] ??
    messages.common.statuses.UNKNOWN;

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const resetForm = () => {
    setEditingSemester(null);
    setFormData({
      nameEn: '',
      nameVi: '',
      type: 'FIRST',
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
      nameEn: semester.nameEn || semester.name,
      nameVi: semester.nameVi || '',
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

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    // `search` and `page` are fetch dependencies, so committing the term here is
    // what re-issues the request. Calling the fetch directly would run it against
    // the previous closure and fire twice.
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleDelete = async (semester: Semester) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingSemesterId(semester.id);

    try {
      const semesterLabel = getLocalizedName(locale, semester, semester.name);
      const shouldDelete = await confirm({
        title: copy.deleteTitle,
        message: copy.deleteMessage.replace('{name}', () => semesterLabel),
        confirmText: copy.deleteConfirm,
        variant: 'destructive',
      });

      if (!shouldDelete) {
        return;
      }

      await adminSemestersApi.delete(semester.id).catch((deleteError: unknown) => {
        // The goal state of a delete is the row being gone: an already-removed
        // row answers 404, which is still a success, not a false failure.
        if (campusErrorKind(deleteError) !== 'notFound') throw deleteError;
      });
      toast.success(copy.deleted);
      if (semesters.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchSemesters();
      }
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      deletingRef.current = false;
      setDeletingSemesterId(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingSemester) {
        const payload = buildSemesterUpdatePayload(editingSemester, formData);
        if (Object.keys(payload).length > 0) {
          await adminSemestersApi.update(editingSemester.id, payload);
        }
        toast.success(copy.updated);
      } else {
        const payload = {
          ...formData,
          name: formData.nameEn || formData.nameVi,
        };
        await adminSemestersApi.create(payload);
        toast.success(copy.created);
      }

      closeModal();
      await fetchSemesters();
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
            onRetry={() => void fetchAcademicYears()}
          />
        ) : null}

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchSemesters()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : semesters.length === 0 ? (
          <EmptyState
            icon={Calendar}
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
                {semesters.map((semester) => {
                  const semesterLabel = getLocalizedName(locale, semester, semester.name);

                  return (
                    <article
                      key={`${semester.id}-mobile`}
                      className="rounded-lg border border-border/70 bg-card p-4 shadow-sm"
                      role="listitem"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-foreground">{semesterLabel}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {getSemesterTypeLabel(semester.type)} · {semester.academicYear?.year || copy.unassigned}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(semesterStatusTone(semester.status))}`}>
                          {semesterStatusLabel(semester.status)}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.startDate}
                          </dt>
                          <dd className="mt-1 text-foreground">{formatDate(semester.startDate)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.endDate}
                          </dt>
                          <dd className="mt-1 text-foreground">{formatDate(semester.endDate)}</dd>
                        </div>
                      </dl>
                      <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(semester)}
                          aria-label={editLabel(semesterLabel)}
                          title={editLabel(semesterLabel)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(semester)}
                          disabled={deletingSemesterId !== null}
                          aria-label={deleteLabel(semesterLabel)}
                          title={deleteLabel(semesterLabel)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AdminRowActions>
                    </article>
                  );
                })}
              </div>
              <AdminTableScroll className="hidden md:block">
                <table className="w-full min-w-[840px] text-sm">
                  <thead>
                    <tr className="bg-secondary text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">{copy.headers.name}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.type}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.academicYear}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.startDate}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.endDate}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.status}</th>
                      <th className="px-2 py-3 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {semesters.map((semester) => {
                      const semesterLabel = getLocalizedName(
                        locale,
                        semester,
                        semester.name,
                      );

                      return (
                      <tr key={semester.id}>
                        <td className="px-2 py-4 font-medium text-foreground">
                          <div className="space-y-1">
                            <div>{semesterLabel}</div>
                            {semester.nameEn && semester.nameVi ? (
                              <div className="text-xs font-normal text-muted-foreground">
                                {locale === 'vi' ? semester.nameEn : semester.nameVi}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {getSemesterTypeLabel(semester.type)}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {semester.academicYear?.year || copy.unassigned}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(semester.startDate)}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {formatDate(semester.endDate)}
                        </td>
                        <td className="px-2 py-4">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(semesterStatusTone(semester.status))}`}>
                            {semesterStatusLabel(semester.status)}
                          </span>
                        </td>
                        <td className="px-2 py-4">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(semester)}
                              aria-label={editLabel(semesterLabel)}
                              title={editLabel(semesterLabel)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(semester)}
                              disabled={deletingSemesterId !== null}
                              aria-label={deleteLabel(semesterLabel)}
                              title={deleteLabel(semesterLabel)}
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
              </AdminTableScroll>
          </AdminTableCard>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingSemester ? copy.editTitle : copy.createTitle}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField
              label={copy.fields.englishName}
            >
              <Input
                type="text"
                value={formData.nameEn}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    nameEn: event.target.value,
                  }))
                }
                placeholder={copy.fields.englishNamePlaceholder}
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
                placeholder={copy.fields.namePlaceholder}
                required
              />
            </AdminFormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={copy.fields.type}
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
              label={copy.fields.academicYear}
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
            <AdminFormField label={copy.fields.startDate}>
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
            <AdminFormField label={copy.fields.endDate}>
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
              {isSaving
                ? copy.saving
                : editingSemester
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
