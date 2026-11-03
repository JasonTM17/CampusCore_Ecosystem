'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { coursesApi, departmentsApi } from '@/lib/api';
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
import { Textarea } from '@/components/ui/textarea';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import { adminAcademicsEn, adminAcademicsVi } from '@/i18n/messages-admin-academics';
import { campusErrorKind, campusErrorMessage } from '@/lib/campus-error';
import { createRequestEpoch } from '@/lib/request-epoch';
import {
  getLocalizedDescription,
  getLocalizedName,
} from '@/lib/academic-content';
import { ACADEMIC_REFERENCE_LIMIT } from '@/lib/reference-data';

interface Course {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
  description?: string;
  descriptionEn?: string;
  descriptionVi?: string;
  credits: number;
  departmentId: string;
  department?: { name: string; nameEn?: string; nameVi?: string };
  isActive: boolean;
}

function hasCourseSnapshotChanged(baseline: Course, current: Course): boolean {
  return baseline.code !== current.code
    || baseline.name !== current.name
    || (baseline.nameEn || baseline.name) !== (current.nameEn || current.name)
    || (baseline.nameVi || '') !== (current.nameVi || '')
    || baseline.description !== current.description
    || (baseline.descriptionEn || baseline.description || '')
      !== (current.descriptionEn || current.description || '')
    || (baseline.descriptionVi || '') !== (current.descriptionVi || '')
    || baseline.credits !== current.credits
    || baseline.departmentId !== current.departmentId
    || baseline.isActive !== current.isActive;
}

function buildCourseUpdatePayload(
  baseline: Course,
  formData: {
    code: string;
    nameEn: string;
    nameVi: string;
    credits: number;
    departmentId: string;
    descriptionEn: string;
    descriptionVi: string;
  },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const nameEnChanged = formData.nameEn !== (baseline.nameEn || baseline.name);
  const nameViChanged = formData.nameVi !== (baseline.nameVi || '');
  const descriptionEnChanged = formData.descriptionEn
    !== (baseline.descriptionEn || baseline.description || '');
  const descriptionViChanged = formData.descriptionVi !== (baseline.descriptionVi || '');

  if (formData.code !== baseline.code) payload.code = formData.code;
  if (nameEnChanged) payload.nameEn = formData.nameEn;
  if (nameViChanged) payload.nameVi = formData.nameVi;
  const name = formData.nameEn || formData.nameVi;
  if ((nameEnChanged || nameViChanged) && name !== baseline.name) payload.name = name;
  if (formData.credits !== baseline.credits) payload.credits = formData.credits;
  if (formData.departmentId !== baseline.departmentId) payload.departmentId = formData.departmentId;
  if (descriptionEnChanged) payload.descriptionEn = formData.descriptionEn;
  if (descriptionViChanged) payload.descriptionVi = formData.descriptionVi;
  const description = formData.descriptionEn || formData.descriptionVi;
  if ((descriptionEnChanged || descriptionViChanged)
      && description !== (baseline.description || '')) {
    payload.description = description;
  }
  return payload;
}

interface Department {
  id: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
}

export default function AdminCoursesPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { href, locale, formatNumber, messages } = useI18n();
  const router = useRouter();
  const copy = { en: adminAcademicsEn.courses, vi: adminAcademicsVi.courses }[locale];
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const coursesEpoch = useRef(createRequestEpoch()).current;
  const [isSaving, setIsSaving] = useState(false);
  const [deletingCourseId, setDeletingCourseId] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [formData, setFormData] = useState({
    code: '',
    nameEn: '',
    nameVi: '',
    credits: 3,
    departmentId: '',
    descriptionEn: '',
    descriptionVi: '',
  });
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const editLabel = (label: string) =>
    copy.editLabel.replace('{code}', () => label);
  const deleteLabel = (label: string) =>
    copy.deleteLabel.replace('{code}', () => label);

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

  const fetchCourses = useCallback(async () => {
    const epoch = coursesEpoch.begin();
    setIsLoading(true);
    setError('');

    try {
      // Search and department are server-side filters: paging through 20-row
      // pages and narrowing them in the browser reports "no results" for
      // anything that lives on another page, and the pager total would keep
      // describing the unfiltered set.
      const query = {
        page,
        limit: 20,
        search: search || undefined,
        departmentId: departmentFilter || undefined,
      };
      const response = await coursesApi.getAll(query);

      if (!coursesEpoch.isCurrent(epoch)) return;
      setCourses(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      if (!coursesEpoch.isCurrent(epoch)) return;
      setError(copy.loadFailed);
    } finally {
      if (!coursesEpoch.isCurrent(epoch)) return;
      setIsLoading(false);
    }
  }, [copy, coursesEpoch, departmentFilter, page, search]);

  useEffect(() => () => {
    coursesEpoch.invalidate();
  }, [coursesEpoch]);

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
      void fetchCourses();
    }
  }, [canAccess, fetchCourses, fetchDepartments]);

  const pageSummary = useMemo(() => {
    if (courses.length === 0) {
      return copy.pageSummaryEmpty;
    }

    return copy.pageSummary
      .replace('{currentPage}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  }, [copy, courses.length, page, totalPages]);

  const departmentOptions = useMemo(
    () => [
      { value: '', label: copy.allDepartments },
      ...departments.map((department) => ({
        value: department.id,
          label: getLocalizedName(locale, department, department.name),
      })),
    ],
    [copy.allDepartments, departments, locale],
  );

  const formDepartmentOptions = useMemo(
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
    setEditingCourse(null);
    setFormData({
      code: '',
      nameEn: '',
      nameVi: '',
      credits: 3,
      departmentId: '',
      descriptionEn: '',
      descriptionVi: '',
    });
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (course: Course) => {
    setEditingCourse(course);
    setFormData({
      code: course.code,
      nameEn: course.nameEn || course.name,
      nameVi: course.nameVi || '',
      credits: course.credits,
      departmentId: course.departmentId,
      descriptionEn: course.descriptionEn || course.description || '',
      descriptionVi: course.descriptionVi || '',
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

  const handleDelete = async (course: Course) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingCourseId(course.id);

    try {
      const shouldDelete = await confirm({
        title: copy.deleteTitle,
        message: copy.deleteMessage.replace('{code}', () => course.code),
        confirmText: copy.deleteConfirm,
        variant: 'destructive',
      });

      if (!shouldDelete) {
        return;
      }

      await coursesApi.delete(course.id).catch((deleteError: unknown) => {
        // The goal state of a delete is the row being gone: an already-removed
        // row answers 404, which is still a success, not a false failure.
        if (campusErrorKind(deleteError) !== 'notFound') throw deleteError;
      });
      toast.success(copy.deleted);
      if (courses.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchCourses();
      }
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      deletingRef.current = false;
      setDeletingCourseId(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      if (editingCourse) {
        const currentCourse = await coursesApi.getById(editingCourse.id);
        if (hasCourseSnapshotChanged(editingCourse, currentCourse)) {
          toast.error(copy.staleEdit);
          return;
        }
        const payload = buildCourseUpdatePayload(editingCourse, formData);
        await coursesApi.update(editingCourse.id, payload);
        toast.success(copy.updated);
      } else {
        const payload = {
          ...formData,
          name: formData.nameEn || formData.nameVi,
          description: formData.descriptionEn || formData.descriptionVi,
          descriptionEn: formData.descriptionEn,
          descriptionVi: formData.descriptionVi,
        };
        await coursesApi.create(payload);
        toast.success(copy.created);
      }

      closeModal();
      await fetchCourses();
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
              className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"
            >
              <div className="grid w-full gap-4 xl:max-w-3xl xl:grid-cols-[minmax(0,1fr)_260px]">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
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
                <Select
                  label={copy.department}
                  value={departmentFilter}
                  onChange={(event) => {
                    setDepartmentFilter(event.target.value);
                    setPage(1);
                  }}
                  options={departmentOptions}
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
            onRetry={() => void fetchCourses()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : courses.length === 0 ? (
          <EmptyState
            icon={BookOpen}
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
                {courses.map((course) => {
                  const courseLabel = getLocalizedName(locale, course, course.name);
                  const courseDescription = getLocalizedDescription(locale, course, '');
                  const departmentLabel = course.department
                    ? getLocalizedName(locale, course.department, course.department.name)
                    : copy.unassigned;

                  return (
                    <article
                      key={`${course.id}-mobile`}
                      className="rounded-xl border border-border/80 bg-card p-4 shadow-xs"
                      role="listitem"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                            {course.code}
                          </p>
                          <h3 className="mt-1 font-semibold text-foreground">{courseLabel}</h3>
                          {courseDescription ? (
                            <p className="mt-1 text-sm leading-5 text-muted-foreground">
                              {courseDescription}
                            </p>
                          ) : null}
                        </div>
                        <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(course.isActive ? 'success' : 'neutral')}`}>
                          {course.isActive ? copy.active : copy.inactive}
                        </span>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.credits}
                          </dt>
                          <dd className="mt-1 text-foreground">{formatNumber(course.credits)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.department}
                          </dt>
                          <dd className="mt-1 text-foreground">{departmentLabel}</dd>
                        </div>
                      </dl>
                      <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(course)}
                          aria-label={editLabel(courseLabel)}
                          title={editLabel(courseLabel)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(course)}
                          disabled={deletingCourseId !== null}
                          aria-label={deleteLabel(courseLabel)}
                          title={deleteLabel(courseLabel)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AdminRowActions>
                    </article>
                  );
                })}
              </div>
              <AdminTableScroll className="hidden md:block">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-secondary/50 text-left text-muted-foreground">
                      <th className="px-4 py-3.5 font-medium">{copy.headers.code}</th>
                      <th className="px-4 py-3.5 font-medium">{copy.headers.name}</th>
                      <th className="px-4 py-3.5 font-medium">{copy.headers.credits}</th>
                      <th className="px-4 py-3.5 font-medium">{copy.headers.department}</th>
                      <th className="px-4 py-3.5 font-medium">{copy.headers.status}</th>
                      <th className="px-4 py-3.5 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {courses.map((course) => {
                      const courseLabel = getLocalizedName(locale, course, course.name);
                      const courseDescription = getLocalizedDescription(
                        locale,
                        course,
                        '',
                      );
                      const departmentLabel = course.department
                        ? getLocalizedName(
                            locale,
                            course.department,
                            course.department.name,
                          )
                        : copy.unassigned;

                      return (
                      <tr key={course.id} className="transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3.5 font-medium text-foreground">
                          {course.code}
                        </td>
                        <td className="px-4 py-3.5 text-foreground">
                          <div className="space-y-1">
                            <div>{courseLabel}</div>
                            {courseDescription ? (
                              <div className="text-xs text-muted-foreground">
                                {courseDescription}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatNumber(course.credits)}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {departmentLabel}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(course.isActive ? 'success' : 'neutral')}`}>
                            {course.isActive ? copy.active : copy.inactive}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(course)}
                              aria-label={editLabel(courseLabel)}
                              title={editLabel(courseLabel)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(course)}
                              disabled={deletingCourseId !== null}
                              aria-label={deleteLabel(courseLabel)}
                              title={deleteLabel(courseLabel)}
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
        title={editingCourse ? copy.editTitle : copy.createTitle}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminFormField label={copy.courseCode}>
              <Input
                type="text"
                value={formData.code}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                disabled={Boolean(editingCourse)}
                required
              />
            </AdminFormField>
            <AdminFormField label={copy.creditsLabel}>
              <Input
                type="number"
                min="1"
                max="12"
                value={formData.credits}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    credits: Number(event.target.value) || 3,
                  }))
                }
                required
              />
            </AdminFormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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
            <AdminFormField label={copy.fields.vietnameseName}>
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

          <Select
            label={copy.department}
            value={formData.departmentId}
            onChange={(event) =>
              setFormData((current) => ({
                ...current,
                departmentId: event.target.value,
              }))
            }
            options={formDepartmentOptions}
            required
          />

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
                placeholder={copy.descriptionPlaceholder}
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
                placeholder={copy.descriptionPlaceholder}
              />
            </AdminFormField>
          </div>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? copy.saving : editingCourse ? messages.common.actions.saveChanges : copy.create}
            </Button>
          </AdminDialogFooter>
        </form>
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
