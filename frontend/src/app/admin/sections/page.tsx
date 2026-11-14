'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  adminSectionsApi,
  adminSemestersApi,
  classroomsApi,
  coursesApi,
  lecturersApi,
} from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminDialogFooter,
  AdminFormField,
  AdminFormSection,
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
import { statusToneClass, type StatusTone } from '@/components/ui/status';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { useI18n } from '@/i18n';
import { sessionExpiredLoginHref } from '@/lib/login-portal';
import { campusErrorMessage } from '@/lib/campus-error';
import { createRequestEpoch } from '@/lib/request-epoch';
import {
  getLocalizedCourseLabel,
  getLocalizedName,
} from '@/lib/academic-content';
import {
  ACADEMIC_REFERENCE_LIMIT,
  PEOPLE_REFERENCE_LIMIT,
} from '@/lib/reference-data';
import { SearchableSelect } from '@/components/ui/searchable-select';

interface Section {
  id: string;
  sectionNumber: string;
  courseId: string;
  semesterId: string;
  lecturerId?: string;
  capacity: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  course?: {
    code: string;
    name: string;
    nameEn?: string;
    nameVi?: string;
    department?: { name: string; nameEn?: string; nameVi?: string };
  };
  semester?: { name: string; nameEn?: string; nameVi?: string; type?: string };
  lecturer?: { user?: { firstName: string; lastName: string } };
  schedules?: {
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    classroom?: { id?: string; building: string; roomNumber: string };
  }[];
}

function sectionStatusTone(status: Section['status']): StatusTone {
  if (status === 'OPEN') return 'success';
  if (status === 'CANCELLED') return 'danger';
  return 'neutral';
}

interface Course {
  id: string;
  code: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
}

interface Semester {
  id: string;
  name: string;
  nameEn?: string;
  nameVi?: string;
  type?: string;
}

interface Lecturer {
  id: string;
  employeeId: string;
  user?: { firstName: string; lastName: string };
}

interface Classroom {
  id: string;
  building: string;
  roomNumber: string;
}

interface ScheduleEntry {
  rowId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  classroomId: string;
}

const sectionStatuses = ['OPEN', 'CLOSED', 'CANCELLED'] as const;
type SectionStatus = (typeof sectionStatuses)[number];

type SectionScheduleSnapshot = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  classroomId?: string;
  classroom?: { id?: string };
};

function sectionScheduleListsEqual(
  left: SectionScheduleSnapshot[],
  right: SectionScheduleSnapshot[],
): boolean {
  const normalize = (schedules: SectionScheduleSnapshot[]) => schedules
    .map((schedule) => ({
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      classroomId: schedule.classroomId ?? schedule.classroom?.id ?? '',
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function hasSectionSnapshotChanged(baseline: Section, current: Section): boolean {
  return baseline.courseId !== current.courseId
    || baseline.semesterId !== current.semesterId
    || baseline.sectionNumber !== current.sectionNumber
    || (baseline.lecturerId || '') !== (current.lecturerId || '')
    || baseline.capacity !== current.capacity
    || baseline.status !== current.status
    || !sectionScheduleListsEqual(baseline.schedules || [], current.schedules || []);
}

function buildSectionUpdatePayload(
  baseline: Section,
  formData: {
    courseId: string;
    semesterId: string;
    sectionNumber: string;
    capacity: number;
    status: string;
    lecturerId: string;
  },
  schedules: ScheduleEntry[],
  schedulesLoaded: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (formData.courseId !== baseline.courseId) payload.courseId = formData.courseId;
  if (formData.semesterId !== baseline.semesterId) payload.semesterId = formData.semesterId;
  if (formData.sectionNumber !== baseline.sectionNumber) payload.sectionNumber = formData.sectionNumber;
  if (Number(formData.capacity) !== baseline.capacity) payload.capacity = Number(formData.capacity);
  if (formData.status !== baseline.status) payload.status = formData.status;
  if (formData.lecturerId !== (baseline.lecturerId || '')) payload.lecturerId = formData.lecturerId;
  if (schedulesLoaded && !sectionScheduleListsEqual(baseline.schedules || [], schedules)) {
    payload.schedules = schedules.map(({ dayOfWeek, startTime, endTime, classroomId }) => ({
      dayOfWeek,
      startTime,
      endTime,
      classroomId,
    }));
  }
  return payload;
}

function isSectionStatus(value: string): value is SectionStatus {
  return sectionStatuses.includes(value as SectionStatus);
}

export default function AdminSectionsPage() {
  const { user, isAdmin, isSuperAdmin, isLoading: isAuthLoading, isLoggingOut } = useAuth();
  const { formatNumber, href, locale, messages } = useI18n();
  const { sections: copy } = messages.adminPages;
  const router = useRouter();
  const [sections, setSections] = useState<Section[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseQuery, setCourseQuery] = useState('');
  const [lecturerQuery, setLecturerQuery] = useState('');
  const [referenceSearching, setReferenceSearching] = useState(false);
  const [pinnedCourse, setPinnedCourse] = useState<{ value: string; label: string } | null>(null);
  const [pinnedLecturer, setPinnedLecturer] = useState<{ value: string; label: string } | null>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [editingSectionBaseline, setEditingSectionBaseline] = useState<Section | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingSectionId, setDeletingSectionId] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [formData, setFormData] = useState({
    courseId: '',
    semesterId: '',
    sectionNumber: '',
    capacity: 30,
    status: 'OPEN',
    lecturerId: '',
  });
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const scheduleLoadRequestRef = useRef(0);
  const sectionsEpoch = useRef(createRequestEpoch()).current;
  // A failed schedule read must never read as "no schedules added yet": this
  // flag keeps an outage distinguishable from a schedule-free section.
  const [schedulesError, setSchedulesError] = useState('');
  const [schedulesLoaded, setSchedulesLoaded] = useState(true);
  const nextScheduleId = useRef(0);
  const createScheduleRowId = () => `schedule-row-${++nextScheduleId.current}`;
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));
  const { confirm, confirmationDialog } = useConfirmationDialog();

  useEffect(() => {
    if (isAuthLoading || isLoggingOut) {
      return;
    }

    if (!user) {
      router.replace(sessionExpiredLoginHref(href, 'admin'));
      return;
    }

    if (!isAdmin && !isSuperAdmin) {
      router.replace(href('/dashboard'));
    }
  }, [href, isAdmin, isSuperAdmin, isAuthLoading, isLoggingOut, router, user]);

  const fetchDropdownData = useCallback(async () => {
    setReferenceError('');
    const [coursesResult, semestersResult, lecturersResult, classroomsResult] =
      await Promise.allSettled([
        coursesApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT }),
        adminSemestersApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT }),
        lecturersApi.getAll({ limit: PEOPLE_REFERENCE_LIMIT }),
        classroomsApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT }),
      ]);

    if (coursesResult.status === 'fulfilled') setCourses(coursesResult.value.data || []);
    if (semestersResult.status === 'fulfilled') setSemesters(semestersResult.value.data || []);
    if (lecturersResult.status === 'fulfilled') setLecturers(lecturersResult.value.data || []);
    if (classroomsResult.status === 'fulfilled') setClassrooms(classroomsResult.value.data || []);

    if ([coursesResult, semestersResult, lecturersResult, classroomsResult].some(
      (result) => result.status === 'rejected',
    )) {
      setReferenceError(copy.referenceDataFailed);
    }
  }, [copy]);

  // F6: course and lecturer pickers search server side so entries beyond the
  // first capped page stay assignable. A fresh counter per query drops stale
  // responses when the operator keeps typing.
  const courseSearchEpoch = useRef(0);
  const lecturerSearchEpoch = useRef(0);

  useEffect(() => {
    if (!courseQuery) return;
    const epoch = ++courseSearchEpoch.current;
    setReferenceSearching(true);
    coursesApi.getAll({ limit: ACADEMIC_REFERENCE_LIMIT, search: courseQuery })
      .then((response) => {
        if (epoch === courseSearchEpoch.current) setCourses(response.data || []);
      })
      .catch(() => {})
      .finally(() => {
        if (epoch === courseSearchEpoch.current) setReferenceSearching(false);
      });
  }, [courseQuery]);

  useEffect(() => {
    if (!lecturerQuery) return;
    const epoch = ++lecturerSearchEpoch.current;
    setReferenceSearching(true);
    lecturersApi.getAll({ limit: PEOPLE_REFERENCE_LIMIT, search: lecturerQuery })
      .then((response) => {
        if (epoch === lecturerSearchEpoch.current) setLecturers(response.data || []);
      })
      .catch(() => {})
      .finally(() => {
        if (epoch === lecturerSearchEpoch.current) setReferenceSearching(false);
      });
  }, [lecturerQuery]);

  const fetchSections = useCallback(async () => {
    const epoch = sectionsEpoch.begin();
    setIsLoading(true);
    setError('');

    try {
      const response = await adminSectionsApi.getAll({
        page,
        limit: 20,
        semesterId: semesterFilter || undefined,
        search: search || undefined,
      });
      if (!sectionsEpoch.isCurrent(epoch)) return;
      setSections(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
    } catch {
      if (!sectionsEpoch.isCurrent(epoch)) return;
      setError(copy.loadFailed);
    } finally {
      if (!sectionsEpoch.isCurrent(epoch)) return;
      setIsLoading(false);
    }
  }, [copy, page, search, sectionsEpoch, semesterFilter]);

  useEffect(() => () => {
    sectionsEpoch.invalidate();
  }, [sectionsEpoch]);

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

  const dayOptions = useMemo(
    () =>
      copy.weekdayLabels.map((label, index) => ({
        value: String(((index + 1) % 7) + 1),
        label,
      })),
    [copy.weekdayLabels],
  );

  const getDayLabel = (day: number) => {
    const normalized = day === 0 ? 1 : day;
    const match = dayOptions.find((opt) => opt.value === String(normalized));
    return match
      ? match.label
      : copy.dayFallback.replace('{day}', () => String(normalized));
  };

  const formatPageSummary = () =>
    copy.pageSummary
      .replace('{currentPage}', () => String(page))
      .replace('{pages}', () => String(totalPages));
  const formatSectionLabel = (
    template: string,
    sectionNumber: string,
    courseCode: string,
  ) =>
    template
      .replace('{sectionNumber}', () => sectionNumber)
      .replace('{courseCode}', () => courseCode);

  useEffect(() => {
    if (canAccess) {
      void fetchDropdownData();
      void fetchSections();
    }
  }, [canAccess, fetchDropdownData, fetchSections]);

  const semesterFilterOptions = useMemo(
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
    () => {
      const base = [
        { value: '', label: copy.selectCourse },
        ...courses.map((course) => ({
          value: course.id,
          label: getLocalizedCourseLabel(locale, course, `${course.code} - ${course.name}`),
        })),
      ];
      return pinnedCourse && !base.some((option) => option.value === pinnedCourse.value)
        ? [...base, pinnedCourse]
        : base;
    },
    [copy.selectCourse, courses, locale, pinnedCourse],
  );

  const semesterOptions = useMemo(
    () => [
      { value: '', label: copy.selectSemester },
      ...semesters.map((semester) => ({
        value: semester.id,
        label: getLocalizedName(locale, semester, semester.name),
      })),
    ],
    [copy.selectSemester, locale, semesters],
  );

  const lecturerOptions = useMemo(
    () => {
      const base = [
        { value: '', label: copy.noLecturerAssigned },
        ...lecturers.map((lecturer) => ({
          value: lecturer.id,
          label: lecturer.user
            ? `${lecturer.user.lastName ?? ''} ${lecturer.user.firstName ?? ''}`.trim() + ` (${lecturer.employeeId})`
            : lecturer.employeeId,
        })),
      ];
      return pinnedLecturer && !base.some((option) => option.value === pinnedLecturer.value)
        ? [...base, pinnedLecturer]
        : base;
    },
    [copy.noLecturerAssigned, lecturers, pinnedLecturer],
  );

  const classroomOptions = useMemo(
    () => [
      { value: '', label: copy.selectRoom },
      ...classrooms.map((classroom) => ({
        value: classroom.id,
        label: `${classroom.building} ${classroom.roomNumber}`,
      })),
    ],
    [classrooms, copy.selectRoom],
  );

  if (isAuthLoading || isLoggingOut || !canAccess) {
    return <LoadingState label={copy.loading} className="m-8" />;
  }

  const resetForm = () => {
    scheduleLoadRequestRef.current += 1;
    setEditingSection(null);
    setEditingSectionBaseline(null);
    setFormData({
      courseId: '',
      semesterId: '',
      sectionNumber: '',
      capacity: 30,
      status: 'OPEN',
      lecturerId: '',
    });
    setSchedules([]);
    setSchedulesError('');
    setSchedulesLoaded(true);
    setPinnedCourse(null);
    setPinnedLecturer(null);
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  // The modal must never claim a section is schedule-free just because the
  // schedule read failed: a failed load is surfaced with a retry instead.
  const loadSectionSchedules = async (section: Section) => {
    const requestId = ++scheduleLoadRequestRef.current;
    const isCurrent = () => requestId === scheduleLoadRequestRef.current;
    setSchedulesError('');
    setSchedulesLoaded(false);
    setSchedules([]);
    try {
      const fullSection = await adminSectionsApi.getById(section.id);
      if (!isCurrent()) return;
      setEditingSectionBaseline({ ...section, schedules: fullSection.schedules || [] });
      setSchedules(
        (fullSection.schedules || []).map((schedule) => ({
          rowId: schedule.id || createScheduleRowId(),
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          classroomId: schedule.classroom?.id || '',
        })),
      );
      if (!isCurrent()) return;
      setSchedulesLoaded(true);
    } catch {
      if (!isCurrent()) return;
      setSchedules([]);
      if (!isCurrent()) return;
      setSchedulesError(copy.schedulesLoadFailed);
    }
  };

  // A stale save must leave the editor on the server's latest row instead of
  // keeping a baseline that would reject every retry.
  const applySectionEditorSnapshot = (section: Section) => {
    setEditingSection(section);
    setEditingSectionBaseline(section);
    setFormData({
      courseId: section.courseId,
      semesterId: section.semesterId,
      sectionNumber: section.sectionNumber,
      capacity: section.capacity,
      status: section.status,
      lecturerId: section.lecturerId || '',
    });
    setSchedules((section.schedules || []).map((schedule) => ({
      rowId: schedule.id || createScheduleRowId(),
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      classroomId: schedule.classroom?.id || '',
    })));
    setSchedulesError('');
    setSchedulesLoaded(true);
  };

  const openEdit = (section: Section) => {
    setEditingSection(section);
    setEditingSectionBaseline(section);
    setFormData({
      courseId: section.courseId,
      semesterId: section.semesterId,
      sectionNumber: section.sectionNumber,
      capacity: section.capacity,
      status: section.status,
      lecturerId: section.lecturerId || '',
    });
    // Pin the assigned records so a filtered search never hides the current value.
    setPinnedCourse(section.course
      ? { value: section.courseId, label: getLocalizedCourseLabel(locale, section.course, `${section.course.code} - ${section.course.name}`) }
      : null);
    setPinnedLecturer(section.lecturerId
      ? { value: section.lecturerId, label: section.lecturer?.user
          ? `${section.lecturer.user.lastName ?? ''} ${section.lecturer.user.firstName ?? ''}`.trim()
          : section.lecturerId }
      : null);

    setIsModalOpen(true);
    void loadSectionSchedules(section);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleDelete = async (section: Section) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      const shouldDelete = await confirm({
        title: copy.deleteTitle,
        message: formatSectionLabel(copy.deleteMessage,
          section.sectionNumber,
          section.course?.code || copy.unknownCourse,
        ),
        confirmText: copy.deleteConfirm,
        variant: 'destructive',
      });

      if (!shouldDelete) {
        return;
      }

      setDeletingSectionId(section.id);
      await adminSectionsApi.delete(section.id);
      toast.success(copy.deleted);
      if (sections.length === 1 && page > 1) {
        setPage((prev) => prev - 1);
      } else {
        await fetchSections();
      }
    } catch {
      toast.error(copy.deleteFailed);
    } finally {
      deletingRef.current = false;
      setDeletingSectionId(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (schedules.some((s) => !s.classroomId)) {
      toast.error(copy.roomRequired);
      return;
    }

    setIsSaving(true);

    try {
      if (editingSection) {
        const currentSection = await adminSectionsApi.getById(editingSection.id);
        if (hasSectionSnapshotChanged(editingSectionBaseline || editingSection, currentSection)) {
          applySectionEditorSnapshot(currentSection);
          toast.error(copy.staleEdit);
          await fetchSections();
          return;
        }
        const payload = buildSectionUpdatePayload(
          editingSectionBaseline || editingSection,
          formData,
          schedules,
          schedulesLoaded,
        );
        await adminSectionsApi.update(editingSection.id, payload);
        toast.success(copy.updated);
      } else {
        const payload = {
          ...formData,
          capacity: Number(formData.capacity),
          schedules: schedulesLoaded
            ? schedules.map(({ dayOfWeek, startTime, endTime, classroomId }) => ({ dayOfWeek, startTime, endTime, classroomId }))
            : undefined,
        };
        await adminSectionsApi.create(payload);
        toast.success(copy.created);
      }

      closeModal();
      await fetchSections();
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

  const addSchedule = () => {
    setSchedules((current) => [
      ...current,
      { rowId: createScheduleRowId(), dayOfWeek: 1, startTime: '09:00', endTime: '10:30', classroomId: '' },
    ]);
  };

  const removeSchedule = (index: number) => {
    setSchedules((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const updateSchedule = (
    index: number,
    field: keyof ScheduleEntry,
    value: string | number,
  ) => {
    setSchedules((current) =>
      current.map((schedule, currentIndex) =>
        currentIndex === index ? { ...schedule, [field]: value } : schedule,
      ),
    );
  };

  return (
    <AdminFrame
      title={copy.title}
      description={copy.description}
      actions={
        <Button onClick={openCreate} disabled={!schedulesLoaded}>
          <Plus className="mr-2 h-4 w-4" />
          {copy.create}
        </Button>
      }
    >
      <div className="space-y-6">
        <AdminToolbarCard>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="grid w-full gap-4 md:max-w-3xl md:grid-cols-2">
                <div>
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
                <Select
                  label={copy.semester}
                  value={semesterFilter}
                  onChange={(event) => {
                    setSemesterFilter(event.target.value);
                    setPage(1);
                  }}
                  options={semesterFilterOptions}
                />
              </div>
              <div className="text-sm text-muted-foreground">
                {formatPageSummary()}
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

        {error ? (
          <ErrorState
            title={copy.unavailableTitle}
            description={error}
            onRetry={() => void fetchSections()}
          />
        ) : isLoading ? (
          <LoadingState label={copy.loading} />
        ) : sections.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            action={<Button onClick={openCreate} disabled={!schedulesLoaded}>{copy.create}</Button>}
          />
        ) : (
          <AdminTableCard
            title={copy.tableTitle}
            footer={
              <AdminPaginationFooter
                summary={formatPageSummary()}
                page={page}
                totalPages={totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            }
          >
              <div className="space-y-3 md:hidden" role="list" aria-label={copy.tableTitle}>
                {sections.map((section) => {
                  const courseLabel = section.course
                    ? getLocalizedCourseLabel(
                        locale,
                        section.course,
                        `${section.course.code} - ${section.course.name}`,
                      )
                    : copy.unknownCourse;
                  const semesterLabel = section.semester
                    ? getLocalizedName(
                        locale,
                        section.semester,
                        section.semester.name,
                      )
                    : copy.unassigned;
                  const lecturerLabel = section.lecturer?.user
                    ? `${section.lecturer.user.lastName ?? ''} ${section.lecturer.user.firstName ?? ''}`.trim()
                    : copy.unassigned;

                  return (
                    <article
                      key={`${section.id}-mobile`}
                      className="rounded-xl border border-border/80 bg-card p-4 shadow-xs"
                      role="listitem"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                            {copy.headers.course}
                          </p>
                          <h3 className="mt-1 font-semibold text-foreground">
                            {courseLabel}
                          </h3>
                        </div>
                        <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(sectionStatusTone(section.status))}`}>
                          {messages.common.statuses[section.status as keyof typeof messages.common.statuses] ?? messages.common.statuses.UNKNOWN}
                        </span>
                      </div>

                      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.section}
                          </dt>
                          <dd className="mt-1 text-foreground">{section.sectionNumber}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.semester}
                          </dt>
                          <dd className="mt-1 text-foreground">{semesterLabel}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.lecturer}
                          </dt>
                          <dd className="mt-1 text-foreground">{lecturerLabel}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {copy.headers.capacity}
                          </dt>
                          <dd className="mt-1 text-foreground">
                            {formatNumber(section.capacity)}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-4 border-t border-border/60 pt-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {copy.headers.schedule}
                        </p>
                        {section.schedules && section.schedules.length > 0 ? (
                          <div className="mt-2 space-y-1">
                            {section.schedules.map((schedule, index) => (
                              <div
                                key={schedule.id || index}
                                className="text-sm text-foreground"
                              >
                                <span className="font-medium">
                                  {getDayLabel(schedule.dayOfWeek)}
                                </span>{' '}
                                <span className="text-muted-foreground">
                                  {schedule.startTime}-{schedule.endTime}
                                </span>{' '}
                                <span className="text-muted-foreground">
                                  {schedule.classroom?.building}
                                  {schedule.classroom?.roomNumber
                                    ? ` ${schedule.classroom.roomNumber}`
                                    : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {copy.noSchedule}
                          </p>
                        )}
                      </div>

                      <AdminRowActions className="mt-4 border-t border-border/60 pt-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(section)}
                          disabled={!schedulesLoaded}
                          aria-label={formatSectionLabel(copy.editLabel,
                            section.sectionNumber,
                            section.course?.code || copy.unknownCourse,
                          )}
                          title={formatSectionLabel(copy.editLabel,
                            section.sectionNumber,
                            section.course?.code || copy.unknownCourse,
                          )}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(section)}
                          disabled={deletingSectionId !== null}
                          aria-label={formatSectionLabel(copy.deleteLabel,
                            section.sectionNumber,
                            section.course?.code || copy.unknownCourse,
                          )}
                          title={formatSectionLabel(copy.deleteLabel,
                            section.sectionNumber,
                            section.course?.code || copy.unknownCourse,
                          )}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AdminRowActions>
                    </article>
                  );
                })}
              </div>
              <AdminTableScroll className="hidden md:block">
                <table className="w-full min-w-[1120px] text-sm" aria-label={copy.title}>
                  <thead>
                    <tr className="border-b border-border/70 bg-secondary/50 text-left text-muted-foreground">
                      <th scope="col" className="px-4 py-3.5 font-medium">{copy.headers.course}</th>
                      <th scope="col" className="px-4 py-3.5 font-medium">{copy.headers.section}</th>
                      <th scope="col" className="px-4 py-3.5 font-medium">{copy.headers.semester}</th>
                      <th scope="col" className="px-4 py-3.5 font-medium">{copy.headers.lecturer}</th>
                      <th scope="col" className="px-4 py-3.5 font-medium">{copy.headers.capacity}</th>
                      <th scope="col" className="px-4 py-3.5 font-medium">{copy.headers.schedule}</th>
                      <th scope="col" className="px-4 py-3.5 font-medium">{copy.headers.status}</th>
                      <th scope="col" className="px-4 py-3.5 text-right font-medium">{copy.headers.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {sections.map((section) => {
                      const courseLabel = section.course
                        ? getLocalizedCourseLabel(
                            locale,
                            section.course,
                            `${section.course.code} - ${section.course.name}`,
                          )
                        : copy.unknownCourse;
                      const semesterLabel = section.semester
                        ? getLocalizedName(
                            locale,
                            section.semester,
                            section.semester.name,
                          )
                        : copy.unassigned;

                      return (
                      <tr key={section.id} className="transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3.5">
                            <div className="space-y-1">
                              <p className="font-medium text-foreground">
                              {section.course?.code || copy.unknownCourse}
                              </p>
                              <p className="text-xs text-muted-foreground">
                              {section.course ? courseLabel : copy.noCourseName}
                              </p>
                            </div>
                          </td>
                        <td className="px-4 py-3.5 text-foreground">
                          {section.sectionNumber}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {semesterLabel}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {section.lecturer?.user
                            ? `${section.lecturer.user.lastName ?? ''} ${section.lecturer.user.firstName ?? ''}`.trim()
                            : copy.unassigned}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatNumber(section.capacity)}
                        </td>
                        <td className="px-4 py-3.5">
                          {section.schedules && section.schedules.length > 0 ? (
                            <div className="space-y-1">
                              {section.schedules.map((schedule, index) => (
                                <div key={schedule.id || index} className="text-xs">
                                  <span className="font-medium text-foreground">
                                    {getDayLabel(schedule.dayOfWeek)}
                                  </span>{' '}
                                  <span className="text-muted-foreground">
                                    {schedule.startTime}-{schedule.endTime}
                                  </span>{' '}
                                  <span className="text-muted-foreground">
                                    {schedule.classroom?.building}
                                    {schedule.classroom?.roomNumber
                                      ? ` ${schedule.classroom.roomNumber}`
                                      : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {copy.noSchedule}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${statusToneClass(sectionStatusTone(section.status))}`}>
                            {messages.common.statuses[section.status as keyof typeof messages.common.statuses] ?? messages.common.statuses.UNKNOWN}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <AdminRowActions>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(section)}
                              disabled={!schedulesLoaded}
                              aria-label={formatSectionLabel(copy.editLabel,
                                section.sectionNumber,
                                section.course?.code || copy.unknownCourse,
                              )}
                              title={formatSectionLabel(copy.editLabel,
                                section.sectionNumber,
                                section.course?.code || copy.unknownCourse,
                              )}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDelete(section)}
                              disabled={deletingSectionId !== null}
                              aria-label={formatSectionLabel(copy.deleteLabel,
                                section.sectionNumber,
                                section.course?.code || copy.unknownCourse,
                              )}
                              title={formatSectionLabel(copy.deleteLabel,
                                section.sectionNumber,
                                section.course?.code || copy.unknownCourse,
                              )}
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
        title={editingSection ? copy.editTitle : copy.createTitle}
        className="max-w-3xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SearchableSelect
              label={copy.fields.course}
              value={formData.courseId}
              onValueChange={(value) => {
                setPinnedCourse(courseOptions.find((option) => option.value === value) ?? null);
                setFormData((current) => ({ ...current, courseId: value }));
              }}
              onSearch={setCourseQuery}
              loading={referenceSearching}
              searchPlaceholder={copy.optionsSearchPlaceholder}
              emptyLabel={copy.optionsEmpty}
              options={courseOptions}
              required
            />
            <Select
              label={copy.fields.semester}
              value={formData.semesterId}
              onChange={(event) =>
                setFormData((current) => ({
                  ...current,
                  semesterId: event.target.value,
                }))
              }
              options={semesterOptions}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <AdminFormField label={copy.fields.sectionNumber}>
              <Input
                type="text"
                value={formData.sectionNumber}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    sectionNumber: event.target.value,
                  }))
                }
                required
              />
            </AdminFormField>
            <AdminFormField label={copy.fields.capacity}>
              <Input
                type="number"
                min="1"
                value={formData.capacity}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    capacity: Number(event.target.value) || 30,
                  }))
                }
                required
              />
            </AdminFormField>
            <Select
              label={copy.fields.status}
              value={formData.status}
              onChange={(event) => {
                const nextStatus = event.target.value;
                if (isSectionStatus(nextStatus)) {
                  setFormData((current) => ({
                    ...current,
                    status: nextStatus,
                  }));
                }
              }}
              options={sectionStatuses.map((status) => ({
                value: status,
                label: status,
              }))}
            />
          </div>

          <SearchableSelect
            label={copy.fields.lecturer}
            value={formData.lecturerId}
            onValueChange={(value) => {
              setPinnedLecturer(lecturerOptions.find((option) => option.value === value) ?? null);
              setFormData((current) => ({ ...current, lecturerId: value }));
            }}
            onSearch={setLecturerQuery}
            loading={referenceSearching}
            searchPlaceholder={copy.optionsSearchPlaceholder}
            emptyLabel={copy.optionsEmpty}
            options={lecturerOptions}
          />

          <AdminFormSection
            title={copy.schedulesTitle}
            description={copy.schedulesDescription}
          >
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={addSchedule} disabled={!schedulesLoaded}>
                <Plus className="mr-2 h-4 w-4" />
                {copy.addSchedule}
              </Button>
            </div>

            {!schedulesLoaded && !schedulesError ? (
              <LoadingState label={copy.schedulesTitle} />
            ) : schedulesError ? (
              <ErrorState
                title={copy.schedulesTitle}
                description={schedulesError}
                onRetry={
                  editingSection ? () => void loadSectionSchedules(editingSection) : undefined
                }
              />
            ) : schedules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/80 bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
                {copy.noSchedules}
              </div>
            ) : (
              <div className="space-y-3">
                {schedules.map((schedule, idx) => (
                  <fieldset
                    key={schedule.rowId}
                    className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-border/70 bg-secondary/20 p-4 sm:grid-cols-2"
                  >
                    <legend className="px-1 text-sm font-medium text-foreground">
                      {copy.scheduleLabel.replace('{index}', () => String(idx + 1))}
                    </legend>
                    <Select
                      label={copy.fields.day}
                      value={String(schedule.dayOfWeek)}
                      onChange={(event) =>
                        updateSchedule(idx, 'dayOfWeek', Number(event.target.value))
                      }
                      options={dayOptions}
                    />
                    <AdminFormField label={copy.fields.start}><Input
                      type="time"
                      value={schedule.startTime}
                      onChange={(event) =>
                        updateSchedule(idx, 'startTime', event.target.value)
                      }
                    /></AdminFormField>
                    <AdminFormField label={copy.fields.end}><Input
                      type="time"
                      value={schedule.endTime}
                      onChange={(event) =>
                        updateSchedule(idx, 'endTime', event.target.value)
                      }
                    /></AdminFormField>
                    <Select
                      label={copy.fields.room}
                      value={schedule.classroomId}
                      onChange={(event) =>
                        updateSchedule(idx, 'classroomId', event.target.value)
                      }
                      options={classroomOptions}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeSchedule(idx)}
                      aria-label={copy.removeSchedule.replace('{index}', () => String(idx + 1))}
                      title={copy.removeSchedule.replace('{index}', () => String(idx + 1))}
                      className="self-end justify-self-end sm:col-span-2"
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </fieldset>
                ))}
              </div>
            )}
          </AdminFormSection>

          <AdminDialogFooter>
            <Button type="button" variant="outline" onClick={closeModal}>
              {messages.common.actions.cancel}
            </Button>
            <Button type="submit" disabled={isSaving || !schedulesLoaded}>
              {isSaving
                ? copy.saving
                : editingSection
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
