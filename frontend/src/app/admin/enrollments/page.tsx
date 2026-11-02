'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Eye, FileText, Search, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  coursesApi,
  enrollmentsApi,
  adminSemestersApi,
  fetchAllPages,
  sectionsApi,
} from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminPaginationFooter,
  AdminRowActions,
  AdminTableCard,
  AdminTableScroll,
  AdminToolbarCard,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { metricToneClass } from '@/components/ui/status';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import { adminAcademicsEn, adminAcademicsVi } from '@/i18n/messages-admin-academics';
import {
  getLocalizedCourseLabel,
  getLocalizedName,
} from '@/lib/academic-content';
import { ACADEMIC_REFERENCE_LIMIT } from '@/lib/reference-data';

interface Enrollment {
  id: string;
  studentId: string;
  sectionId: string;
  semesterId: string;
  status: 'ENROLLED' | 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'DROPPED' | 'CANCELLED';
  enrolledAt: string;
  droppedAt?: string;
  finalGrade?: number;
  letterGrade?: string;
  student?: {
    user?: { firstName?: string; lastName?: string; email?: string };
    studentCode?: string;
    studentId?: string;
  };
  section?: {
    sectionNumber: string;
    course?: { code?: string; name?: string; nameEn?: string; nameVi?: string };
    lecturer?: { user?: { firstName?: string; lastName?: string } };
  };
  semester?: { name: string; nameEn?: string; nameVi?: string; type?: string };
}

interface Semester {
  id: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
  type?: string;
}

interface Course {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
}

interface Section {
  id: string;
  sectionNumber: string;
}

const statusColors: Record<string, string> = {
  ENROLLED: metricToneClass('success'),
  PENDING: metricToneClass('warning'),
  CONFIRMED: metricToneClass('info'),
  COMPLETED: metricToneClass('success'),
  DROPPED: metricToneClass('danger'),
  CANCELLED: metricToneClass('neutral'),
};

function formatVietnameseName(user?: { firstName?: string; lastName?: string }) {
  if (!user) return '';
  const last = user.lastName?.trim() || '';
  const first = user.firstName?.trim() || '';
  if (last && first) return `${last} ${first}`;
  return last || first;
}

function getLearnerLabel(enrollment: Enrollment) {
  const formatted = formatVietnameseName(enrollment.student?.user);
  return formatted || enrollment.student?.user?.email || enrollment.studentId;
}

function getStudentCodeLabel(enrollment: Enrollment) {
  const candidate = enrollment.student?.studentCode || enrollment.student?.studentId;
  if (candidate && !candidate.startsWith('student-profile')) {
    return candidate;
  }
  if (enrollment.studentId && !enrollment.studentId.startsWith('student-profile')) {
    return enrollment.studentId;
  }
  // The backend id is an opaque profile key ('student-profile' / 'student-profile-N'),
  // never an MSSV — never fabricate a code from its suffix, leave the cell unresolved.
  if (enrollment.studentId?.startsWith('student-profile')) {
    return '';
  }
  return candidate || enrollment.studentId;
}

export default function AdminEnrollmentsPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { formatDate, formatDateTime, formatNumber, href, locale, messages } =
    useI18n();
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [sectionReferenceError, setSectionReferenceError] = useState('');
  const [filters, setFilters] = useState({
    semesterId: '',
    courseId: '',
    sectionId: '',
    status: '',
  });
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedEnrollment, setSelectedEnrollment] = useState<Enrollment | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [deletingEnrollmentId, setDeletingEnrollmentId] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const deletingRef = useRef(false);
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const copy = { en: adminAcademicsEn.enrollments, vi: adminAcademicsVi.enrollments }[locale];
  const viewLabel = (learnerLabel: string) =>
    copy.viewLabel.replace('{learnerLabel}', () => learnerLabel);
  const viewStudentLabel = (learnerLabel: string) =>
    copy.viewStudentLabel.replace('{learnerLabel}', () => learnerLabel);
  const deleteLabel = (learnerLabel: string) =>
    copy.deleteLabel.replace('{learnerLabel}', () => learnerLabel);

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

  const fetchDropdownData = useCallback(async () => {
    setReferenceError('');
    const [semestersResult, coursesResult] = await Promise.allSettled([
      adminSemestersApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT }),
      coursesApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT }),
    ]);

    if (semestersResult.status === 'fulfilled') {
      setSemesters(semestersResult.value.data || []);
    }
    if (coursesResult.status === 'fulfilled') {
      setCourses(coursesResult.value.data || []);
    }
    if (semestersResult.status === 'rejected' || coursesResult.status === 'rejected') {
      setReferenceError(messages.admin.enrollments.filterLoadFailed);
    }
  }, [messages]);

  // Request generations: a filter change (or unmount) invalidates in-flight
  // completions so a slower older response cannot repopulate the page after
  // the newer one already rendered.
  const enrollmentsRequestRef = useRef(0);
  const sectionsRequestRef = useRef(0);

  const fetchSectionsForCourse = useCallback(async (courseId: string) => {
    const requestId = ++sectionsRequestRef.current;
    const isCurrent = () => requestId === sectionsRequestRef.current;
    // Every course change drops the shown options immediately — a slower
    // pending response for the old course must not repopulate the dropdown.
    setSections([]);
    setSectionReferenceError('');
    if (!courseId) {
      return;
    }
    try {
      // Page through the course's whole section list — a one-page pull hid
      // every section beyond the first 100 from the filter dropdown.
      const rows = await fetchAllPages<Section>((p, l) =>
        sectionsApi.getAll({ courseId, page: p, limit: l }));
      if (!isCurrent()) return;
      setSections(rows);
    } catch {
      if (!isCurrent()) return;
      setSections([]);
      setSectionReferenceError(copy.sectionsLoadFailed);
    }
  }, [copy]);

  const fetchEnrollments = useCallback(async () => {
    const requestId = ++enrollmentsRequestRef.current;
    const isCurrent = () => requestId === enrollmentsRequestRef.current;
    setIsLoading(true);
    setError('');

    try {
      const params: {
        page: number;
        limit: number;
        semesterId?: string;
        courseId?: string;
        sectionId?: string;
        status?: string;
        search?: string;
      } = { page, limit: 20 };
      if (filters.semesterId) params.semesterId = filters.semesterId;
      if (filters.courseId) params.courseId = filters.courseId;
      if (filters.sectionId) params.sectionId = filters.sectionId;
      if (filters.status) params.status = filters.status;
      if (search) params.search = search;

      const response = await enrollmentsApi.getAll(params);
      if (!isCurrent()) return;
      setEnrollments(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
      setTotal(response.meta?.total || 0);
    } catch {
      if (!isCurrent()) return;
      setError(copy.loadFailed);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [copy, filters.courseId, filters.sectionId, filters.semesterId, filters.status, page, search]);

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

  const statusLabel = (status: string) =>
    copy.statusOptions[status as keyof typeof copy.statusOptions] ??
    messages.common.statuses[status.toUpperCase() as keyof typeof messages.common.statuses] ??
    messages.common.statuses.UNKNOWN;

  useEffect(() => {
    if (canAccess) {
      void fetchDropdownData();
      void fetchEnrollments();
    }
    return () => {
      enrollmentsRequestRef.current += 1;
    };
  }, [canAccess, fetchDropdownData, fetchEnrollments]);

  useEffect(() => {
    if (canAccess) {
      void fetchSectionsForCourse(filters.courseId);
    }
    return () => {
      sectionsRequestRef.current += 1;
    };
  }, [canAccess, fetchSectionsForCourse, filters.courseId]);

  const semesterOptions = useMemo(
    () => [
      { value: '', label: copy.allSemesters },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: getLocalizedName(locale, semester, semester.name),
      })),
    ],
    [copy.allSemesters, locale, semesters],
  );

  const courseOptions = useMemo(
    () => [
      { value: '', label: copy.allCourses },
      ...courses.map((course) => ({
        value: course.id,
        label: getLocalizedCourseLabel(locale, course, `${course.code} - ${course.name}`),
      })),
    ],
    [copy.allCourses, courses, locale],
  );

  const sectionOptions = useMemo(
    () => [
      { value: '', label: copy.allSections },
      ...sections.map((section) => ({
        value: section.id,
        label: section.sectionNumber,
      })),
    ],
    [copy.allSections, sections],
  );

  const statusOptions = useMemo(
    () => [
      { value: '', label: copy.allStatuses },
      { value: 'ENROLLED', label: copy.statusOptions.ENROLLED },
      { value: 'PENDING', label: copy.statusOptions.PENDING },
      { value: 'CONFIRMED', label: copy.statusOptions.CONFIRMED },
      { value: 'COMPLETED', label: copy.statusOptions.COMPLETED },
      { value: 'DROPPED', label: copy.statusOptions.DROPPED },
      { value: 'CANCELLED', label: copy.statusOptions.CANCELLED },
    ],
    [copy.allStatuses, copy.statusOptions],
  );

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const handleClearFilters = () => {
    setFilters({ semesterId: '', courseId: '', sectionId: '', status: '' });
    setSearch('');
    setSearchInput('');
    setPage(1);
  };

  const handleViewDetail = async (enrollment: Enrollment) => {
    const requestId = ++detailRequestRef.current;
    const isCurrent = () => requestId === detailRequestRef.current;
    setDetailLoadingId(enrollment.id);
    setSelectedEnrollment(null);
    setIsDetailOpen(true);
    try {
      const fullEnrollment = await enrollmentsApi.getById(enrollment.id);
      if (!isCurrent()) return;
      setSelectedEnrollment(fullEnrollment);
    } catch {
      if (!isCurrent()) return;
      setSelectedEnrollment(null);
      setIsDetailOpen(false);
      toast.error(copy.detailFailed);
    } finally {
      if (isCurrent()) {
        setDetailLoadingId(null);
      }
    }
  };

  const closeDetail = () => {
    detailRequestRef.current += 1;
    setDetailLoadingId(null);
    setSelectedEnrollment(null);
    setIsDetailOpen(false);
  };

  const handleDelete = async (enrollment: Enrollment) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingEnrollmentId(enrollment.id);

    try {
      const learnerLabel = getLearnerLabel(enrollment);
      const shouldDelete = await confirm({
        title: copy.deleteTitle,
        message: copy.deleteMessage.replace('{learnerLabel}', () => learnerLabel),
        confirmText: copy.deleteConfirm,
        variant: 'destructive',
      });

      if (!shouldDelete) return;

      await enrollmentsApi.delete(enrollment.id);
      toast.success(copy.deleted);
      if (enrollments.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchEnrollments();
      }
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      deletingRef.current = false;
      setDeletingEnrollmentId(null);
    }
  };

  const handleExportCsv = async () => {
    try {
      // Export the committed search term — searchInput is still debouncing
      // and must not leak into the CSV the filters panel describes.
      const csvData = await enrollmentsApi.exportCsv({ ...filters, search: search || undefined });
      // Same BOM convention as grade-export/attendance-export: without it,
      // Excel on Windows decodes the UTF-8 Vietnamese columns as mojibake.
      const blob = new Blob(['\uFEFF', csvData], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `enrollments_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(copy.exportStarted);
    } catch {
      toast.error(copy.exportFailed);
    }
  };

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      actions={
        <Button variant="outline" onClick={() => void handleExportCsv()}>
          <Download className="mr-2 h-4 w-4" />
          {copy.exportCsv}
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <div className="space-y-4">
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
              <div className="grid gap-4 xl:grid-cols-5">
                <Select
                  label={copy.semester}
                value={filters.semesterId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    semesterId: event.target.value,
                  }));
                  setPage(1);
                }}
                options={semesterOptions}
              />
              <Select
                label={copy.course}
                value={filters.courseId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    courseId: event.target.value,
                    sectionId: '',
                  }));
                  setPage(1);
                }}
                options={courseOptions}
              />
              <Select
                label={copy.section}
                value={filters.sectionId}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    sectionId: event.target.value,
                  }));
                  setPage(1);
                }}
                options={sectionOptions}
                disabled={!filters.courseId}
              />
              <Select
                label={copy.status}
                value={filters.status}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }));
                  setPage(1);
                }}
                options={statusOptions}
              />
              <div className="flex items-end gap-2">
                <Button variant="outline" onClick={handleClearFilters}>
                  {messages.common.actions.clearFilters}
                </Button>
                <div className="text-sm text-muted-foreground">
                  {copy.enrollmentsCount.replace('{count}', () => formatNumber(total))}
                </div>
              </div>
              </div>
            </div>
        </AdminToolbarCard>

        {referenceError ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={referenceError}
            onRetry={() => void fetchDropdownData()}
          />
        ) : null}

        {sectionReferenceError ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={sectionReferenceError}
            onRetry={() => void fetchSectionsForCourse(filters.courseId)}
          />
        ) : null}

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchEnrollments()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : enrollments.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
          />
        ) : (
          <AdminTableCard
            title={copy.tableTitle}
            footer={
              <AdminPaginationFooter
                summary={
                  copy.pageSummary
                    .replace('{currentPage}', () => String(page))
                    .replace('{pages}', () => String(totalPages))
                }
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            }
          >
              <div className="space-y-3 md:hidden" role="list" aria-label={copy.tableTitle}>
                {enrollments.map((enrollment) => {
                  const learnerLabel = getLearnerLabel(enrollment);
                  const studentCodeLabel = getStudentCodeLabel(enrollment);
                  const courseLabel = enrollment.section?.course
                    ? getLocalizedCourseLabel(
                        locale,
                        enrollment.section.course,
                        `${enrollment.section.course.code || ''} ${enrollment.section.course.name || ''}`.trim(),
                      )
                    : copy.noCourseName;
                  const semesterLabel = enrollment.semester
                    ? getLocalizedName(
                        locale,
                        enrollment.semester,
                        enrollment.semester.name,
                      )
                    : copy.unassigned;
                  const lecturerLabel = enrollment.section?.lecturer?.user
                    ? formatVietnameseName(enrollment.section.lecturer.user)
                    : copy.unassigned;
                  const enrollmentStatusLabel = statusLabel(enrollment.status);

                  return (
                    <article
                      key={`${enrollment.id}-mobile`}
                      className="rounded-lg border border-border/70 bg-card p-4 shadow-sm"
                      role="listitem"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => void handleViewDetail(enrollment)}
                          disabled={detailLoadingId !== null}
                          className="min-w-0 rounded-md text-left outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          aria-label={viewStudentLabel(learnerLabel)}
                          title={viewStudentLabel(learnerLabel)}
                        >
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                            {studentCodeLabel || '—'}
                          </p>
                          <h3 className="mt-1 break-words font-semibold text-foreground">
                            {learnerLabel}
                          </h3>
                          <p className="mt-1 break-words text-sm text-muted-foreground">
                            {enrollment.student?.user?.email || copy.noEmail}
                          </p>
                        </button>
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${statusColors[enrollment.status] || metricToneClass('neutral')}`}
                        >
                          {enrollmentStatusLabel}
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-3 border-t border-border/60 pt-3 text-sm sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.course}
                          </dt>
                          <dd className="mt-1 break-words text-foreground">
                            <span className="font-medium">
                              {enrollment.section?.course?.code || copy.unknownCourse}
                            </span>
                            <span className="block text-muted-foreground">{courseLabel}</span>
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.section}
                          </dt>
                          <dd className="mt-1 break-words text-foreground">
                            {enrollment.section?.sectionNumber || copy.unknownSection}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.semester}
                          </dt>
                          <dd className="mt-1 break-words text-foreground">{semesterLabel}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.lecturer}
                          </dt>
                          <dd className="mt-1 break-words text-foreground">{lecturerLabel}</dd>
                        </div>
                        <div className="min-w-0 sm:col-span-2">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.enrolledDate}
                          </dt>
                          <dd className="mt-1 break-words text-foreground">
                            {formatDate(enrollment.enrolledAt)}
                          </dd>
                        </div>
                      </dl>
                      <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => void handleViewDetail(enrollment)}
                          disabled={detailLoadingId !== null}
                          aria-label={viewLabel(learnerLabel)}
                          title={viewLabel(learnerLabel)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(enrollment)}
                          disabled={deletingEnrollmentId !== null}
                          aria-label={deleteLabel(learnerLabel)}
                          title={deleteLabel(learnerLabel)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AdminRowActions>
                    </article>
                  );
                })}
              </div>
              <AdminTableScroll className="hidden md:block">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-muted-foreground">
                      <th className="px-2 py-3 font-medium">{copy.headers.student}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.course}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.section}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.semester}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.lecturer}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.status}</th>
                      <th className="px-2 py-3 font-medium">{copy.headers.enrolledDate}</th>
                      <th className="px-2 py-3 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {enrollments.map((enrollment) => {
                      const learnerLabel = getLearnerLabel(enrollment);
                      const courseLabel = enrollment.section?.course
                        ? getLocalizedCourseLabel(
                            locale,
                            enrollment.section.course,
                            `${enrollment.section.course.code || ''} ${enrollment.section.course.name || ''}`.trim(),
                          )
                        : copy.noCourseName;
                      const semesterLabel = enrollment.semester
                        ? getLocalizedName(
                            locale,
                            enrollment.semester,
                            enrollment.semester.name,
                          )
                        : copy.unassigned;

                  return (
                    <tr key={enrollment.id}>
                      <td className="px-2 py-4">
                            <button
                              type="button"
                              onClick={() => void handleViewDetail(enrollment)}
                              disabled={detailLoadingId !== null}
                              className="space-y-1 rounded-md text-left outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                              aria-label={viewStudentLabel(learnerLabel)}
                              title={viewStudentLabel(learnerLabel)}
                            >
                              <p className="font-medium text-foreground transition-colors hover:text-primary">
                                {learnerLabel}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {enrollment.student?.user?.email || copy.noEmail}
                              </p>
                              <p className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-foreground">
                                {getStudentCodeLabel(enrollment) || '—'}
                              </p>
                            </button>
                          </td>
                          <td className="px-2 py-4">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">
                                {enrollment.section?.course?.code || copy.unknownCourse}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {courseLabel}
                              </p>
                            </div>
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.section?.sectionNumber || copy.unknownSection}
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {semesterLabel}
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {enrollment.section?.lecturer?.user
                              ? formatVietnameseName(enrollment.section.lecturer.user)
                              : copy.unassigned}
                          </td>
                          <td className="px-2 py-4">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${statusColors[enrollment.status] || metricToneClass('neutral')}`}
                            >
                              {statusLabel(enrollment.status)}
                            </span>
                          </td>
                          <td className="px-2 py-4 text-muted-foreground">
                            {formatDate(enrollment.enrolledAt)}
                          </td>
                          <td className="px-2 py-4">
                            <AdminRowActions>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => void handleViewDetail(enrollment)}
                                disabled={detailLoadingId !== null}
                                aria-label={viewLabel(learnerLabel)}
                                title={viewLabel(learnerLabel)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void handleDelete(enrollment)}
                                disabled={deletingEnrollmentId !== null}
                                aria-label={deleteLabel(learnerLabel)}
                                title={deleteLabel(learnerLabel)}
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
        isOpen={isDetailOpen}
        onClose={closeDetail}
        title={copy.detail.title}
        closeLabel={copy.closeDetail}
        className="max-w-2xl"
      >
        {detailLoadingId !== null ? (
          <LoadingState label={copy.loading} className="min-h-[150px]" />
        ) : selectedEnrollment ? (
          <div className="space-y-4">
            <section className="rounded-lg border border-border/70 bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                    <UserRound className="h-3.5 w-3.5" />
                    {copy.detail.studentProfile}
                  </div>
                  <h3 className="mt-2 break-words text-lg font-semibold text-foreground">
                    {getLearnerLabel(selectedEnrollment)}
                  </h3>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {selectedEnrollment.student?.user?.email || copy.noEmail}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusColors[selectedEnrollment.status] || metricToneClass('neutral')}`}
                >
                  {statusLabel(selectedEnrollment.status)}
                </span>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {copy.detail.studentCode}
                  </dt>
                  <dd className="mt-1 break-words font-semibold text-foreground">
                    {getStudentCodeLabel(selectedEnrollment) || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {copy.detail.studentId}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">
                    {selectedEnrollment.studentId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {copy.detail.enrollmentId}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs text-foreground">
                    {selectedEnrollment.id}
                  </dd>
                </div>
              </dl>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.course}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.course?.code} -{' '}
                  {selectedEnrollment.section?.course
                    ? getLocalizedName(
                        locale,
                        selectedEnrollment.section.course,
                        selectedEnrollment.section.course.name || copy.noCourseName,
                      )
                    : copy.noCourseName}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.section}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.sectionNumber}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.semester}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.semester
                    ? getLocalizedName(
                        locale,
                        selectedEnrollment.semester,
                        selectedEnrollment.semester.name,
                      )
                    : copy.unassigned}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.lecturer}
                </label>
                <p className="mt-1 text-foreground">
                  {selectedEnrollment.section?.lecturer?.user
                    ? formatVietnameseName(selectedEnrollment.section.lecturer.user)
                    : copy.unassigned}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {copy.detail.enrolledAt}
                </label>
                <p className="mt-1 text-foreground">
                  {formatDateTime(selectedEnrollment.enrolledAt)}
                </p>
              </div>
              {selectedEnrollment.droppedAt ? (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {copy.detail.droppedAt}
                  </label>
                  <p className="mt-1 text-foreground">
                    {formatDateTime(selectedEnrollment.droppedAt)}
                  </p>
                </div>
              ) : null}
            </div>

            {selectedEnrollment.finalGrade !== null &&
            selectedEnrollment.finalGrade !== undefined ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {copy.detail.finalGrade}
                  </label>
                  <p className="mt-1 text-foreground">
                    {formatNumber(selectedEnrollment.finalGrade)}
                  </p>
                </div>
                {selectedEnrollment.letterGrade ? (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {copy.detail.letterGrade}
                    </label>
                    <p className="mt-1 text-foreground">
                      {selectedEnrollment.letterGrade}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <AdminDialogFooter className="pt-0">
              <Button variant="outline" onClick={closeDetail}>
                {copy.detail.close}
              </Button>
            </AdminDialogFooter>
          </div>
        ) : null}
      </Modal>

      {confirmationDialog}
    </AdminFrame>
  );
}
