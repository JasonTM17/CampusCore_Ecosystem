'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Ban,
  Bookmark,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  CreditCard,
  Filter,
  GraduationCap,
  Lock,
  Search,
  Star,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@/context/AuthContext';
import { useI18n } from '@/i18n';
import {
  bursarApi,
  enrollmentsApi,
  registrationApi,
  type RegistrationCatalogMode,
  type RegistrationRoadmapCourse,
  type RegistrationSection,
  type RegistrationWish,
} from '@/lib/api';
import type { Enrollment } from '@/types/api';
import { useApiQuery } from '@/lib/query';
import {
  findScheduleConflict,
  matchesSectionSearch,
  resolveRegistrationActionMessage,
  seatTier,
  sortSectionGroups,
  type CourseGroup,
  type RegistrationSectionSchedule,
  type SectionSortMode,
} from '@/lib/registration-browse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import {
  WeeklyGrid,
  shortDayLabel,
  type WeeklyGridAgendaItem,
} from '@/components/schedule/weekly-grid';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { campusCodeMessage, campusErrorCode } from '@/lib/campus-error';
import { countLabel } from '@/lib/plural';
import { toast } from 'sonner';

const ACTIVE_ENROLLMENT_STATUSES = new Set(['ENROLLED', 'CONFIRMED', 'PENDING']);
const SORT_MODES: SectionSortMode[] = ['code', 'credits', 'seats'];
const CATALOG_MODES: RegistrationCatalogMode[] = ['all', 'curriculum', 'remaining', 'retake'];

/** Groups catalog rows by course inside one department bucket. */
function groupByCourse(sections: RegistrationSection[]): CourseGroup<RegistrationSection>[] {
  const groups = new Map<string, CourseGroup<RegistrationSection>>();
  for (const section of sections) {
    const group =
      groups.get(section.courseId) ??
      ({
        courseId: section.courseId,
        courseCode: section.courseCode,
        courseName: section.courseName,
        credits: section.credits,
        sections: [],
      } satisfies CourseGroup<RegistrationSection>);
    group.sections.push(section);
    groups.set(section.courseId, group);
  }
  return [...groups.values()];
}

interface DepartmentGroup {
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  courses: CourseGroup<RegistrationSection>[];
}

/** Binds a roadmap status + prerequisite flag into the rail chip the student sees. */
function roadmapStatus(course: RegistrationRoadmapCourse):
  | 'completed'
  | 'inProgress'
  | 'eligible'
  | 'locked' {
  if (course.status === 'COMPLETED') return 'completed';
  if (course.status === 'IN_PROGRESS') return 'inProgress';
  return course.prerequisitesSatisfied ? 'eligible' : 'locked';
}

export default function CourseRegistrationPage() {
  const { locale, messages, formatNumber, formatCurrency } = useI18n();
  const copy = messages.courseRegistration;
  const pro = messages.courseRegistrationPro;
  const { user, isLoading: authLoading, hasAccess, isForbidden } = useRequireAuth(['STUDENT']);
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const canLoad = hasAccess && !isForbidden;

  // ---- server state ----
  const roundsQuery = useApiQuery(['registration', 'rounds'], () => registrationApi.rounds(), {
    enabled: canLoad,
    staleTime: 2 * 60_000,
  });

  const nowBucket = Math.floor(Date.now() / 60_000);
  const currentRound = useMemo(() => {
    const rounds = roundsQuery.data ?? [];
    const withinWindow = (round: { status: string; windowStart: string; windowEnd: string }) =>
      round.status === 'OPEN'
      && new Date(round.windowStart).getTime() <= Date.now()
      && Date.now() <= new Date(round.windowEnd).getTime();
    const live = rounds.filter(withinWindow);
    return live.find((round) => round.kind === 'REGISTRATION') ?? live[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundsQuery.data, nowBucket]);

  const roundId = currentRound?.id;
  const semesterId = currentRound?.semesterId;

  const eligibilityQuery = useApiQuery(
    ['registration', 'eligibility', roundId ?? ''],
    () => registrationApi.eligibility({ semesterId, roundId }),
    { enabled: canLoad && Boolean(roundId), staleTime: 2 * 60_000 },
  );

  const roadmapQuery = useApiQuery(
    ['registration', 'roadmap', semesterId ?? ''],
    () => registrationApi.roadmap(semesterId),
    { enabled: canLoad && Boolean(semesterId), staleTime: 5 * 60_000 },
  );

  // ---- catalog filters (server-side params + client refinements) ----
  const [mode, setMode] = useState<RegistrationCatalogMode>('curriculum');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortMode, setSortMode] = useState<SectionSortMode>('code');
  const [seatsOnly, setSeatsOnly] = useState(false);
  const [noConflictOnly, setNoConflictOnly] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingWish, setPendingWish] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [previewSectionId, setPreviewSectionId] = useState<string | null>(null);

  /** Maps backend codes to registration-specific copy, then shared campus errors. */
  const actionMessage = useCallback(
    (cause: unknown) => {
      const code = campusErrorCode(cause);
      if (code === 'TUITION_HOLD') return pro.errorCodes.tuitionHold;
      if (code === 'WISH_DUPLICATE') return pro.errorCodes.wishDuplicate;
      const specific = resolveRegistrationActionMessage(code, copy.errorCodes);
      return specific ?? campusCodeMessage(cause, messages.common.campusErrors);
    },
    [copy, pro, messages],
  );

  const sectionsQuery = useApiQuery(
    ['registration', 'sections', roundId ?? '', mode, departmentId, debouncedSearch],
    () =>
      registrationApi.sections({
        semesterId,
        roundId,
        mode,
        departmentId: departmentId || undefined,
        search: debouncedSearch || undefined,
      }),
    { enabled: canLoad && Boolean(roundId), staleTime: 60_000 },
  );

  const enrollmentsQuery = useApiQuery(
    ['registration', 'enrollments', semesterId ?? '', user?.id ?? ''],
    () => enrollmentsApi.getMyEnrollments(semesterId),
    { enabled: hasAccess && Boolean(semesterId), staleTime: 2 * 60_000 },
  );

  const summaryQuery = useApiQuery(
    ['registration', 'summary', semesterId ?? ''],
    () => registrationApi.summary(semesterId),
    { enabled: canLoad && Boolean(semesterId), staleTime: 2 * 60_000 },
  );

  const wishesQuery = useApiQuery(
    ['registration', 'wishes', semesterId ?? ''],
    () => registrationApi.wishes(semesterId),
    { enabled: canLoad && Boolean(semesterId), staleTime: 2 * 60_000 },
  );

  const accountQuery = useApiQuery(
    ['bursar', 'account', user?.id ?? ''],
    () => bursarApi.account(),
    { enabled: canLoad, staleTime: 2 * 60_000, retry: false },
  );

  // ---- derived ----
  const sections = useMemo(() => sectionsQuery.data ?? [], [sectionsQuery.data]);
  const enrollments = useMemo(() => enrollmentsQuery.data ?? [], [enrollmentsQuery.data]);
  const enrollmentDataReady = enrollmentsQuery.isSuccess;
  const wishes = useMemo(() => wishesQuery.data ?? [], [wishesQuery.data]);

  const enrollmentBySection = useMemo(() => {
    const map = new Map<string, Enrollment>();
    for (const enrollment of enrollments) {
      if (!ACTIVE_ENROLLMENT_STATUSES.has(enrollment.status)) continue;
      map.set(enrollment.sectionId, enrollment);
    }
    return map;
  }, [enrollments]);

  const registered = enrollments.filter((item) => ACTIVE_ENROLLMENT_STATUSES.has(item.status));
  const totalRegisteredCredits = registered.reduce(
    (sum, item) => sum + (item.section?.course?.credits ?? 0),
    0,
  );

  const creditLimit =
    eligibilityQuery.data && eligibilityQuery.data.creditLimit > 0
      ? eligibilityQuery.data.creditLimit
      : summaryQuery.data && summaryQuery.data.creditLimit > 0
        ? summaryQuery.data.creditLimit
        : null;

  const departmentOptions = useMemo(() => {
    const seen = new Map<string, { id: string; code: string; name: string }>();
    for (const section of sectionsQuery.data ?? []) {
      if (section.departmentId && !seen.has(section.departmentId)) {
        seen.set(section.departmentId, {
          id: section.departmentId,
          code: section.departmentCode ?? '',
          name: section.departmentName ?? '',
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [sectionsQuery.data]);

  const filteredSections = useMemo(
    () =>
      sections.filter(
        (section) =>
          matchesSectionSearch(section, searchText)
          && (!seatsOnly || section.remainingSeats > 0)
          && (!noConflictOnly || !section.scheduleConflict),
      ),
    [sections, searchText, seatsOnly, noConflictOnly],
  );

  const departmentGroups = useMemo<DepartmentGroup[]>(() => {
    const byDept = new Map<string, RegistrationSection[]>();
    for (const section of filteredSections) {
      const key = section.departmentId ?? 'other';
      byDept.set(key, [...(byDept.get(key) ?? []), section]);
    }
    return [...byDept.entries()]
      .map(([id, rows]) => ({
        departmentId: id,
        departmentCode: rows[0]?.departmentCode ?? '',
        departmentName: rows[0]?.departmentName ?? '',
        courses: sortSectionGroups(groupByCourse(rows), sortMode),
      }))
      .sort((a, b) => a.departmentCode.localeCompare(b.departmentCode));
  }, [filteredSections, sortMode]);

  const sectionsById = useMemo(() => {
    const map = new Map<string, RegistrationSection>();
    for (const section of sections) map.set(section.id, section);
    return map;
  }, [sections]);

  const wishedCourseIds = useMemo(
    () => new Set(wishes.map((wish) => wish.courseId)),
    [wishes],
  );

  const holds = accountQuery.data?.holds ?? [];
  const holdBlocked = holds.length > 0;

  // ---- roadmap rail ----
  const roadmapGroups = useMemo(() => {
    const courses = roadmapQuery.data?.courses ?? [];
    const years = new Map<number, Map<number, RegistrationRoadmapCourse[]>>();
    for (const course of courses) {
      const year = years.get(course.year) ?? new Map<number, RegistrationRoadmapCourse[]>();
      year.set(course.semester, [...(year.get(course.semester) ?? []), course]);
      years.set(course.year, year);
    }
    return [...years.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, semesters]) => ({
        year,
        semesters: [...semesters.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([semester, items]) => ({ semester, courses: items })),
      }));
  }, [roadmapQuery.data]);

  const roadmapProgress = useMemo(() => {
    const courses = roadmapQuery.data?.courses ?? [];
    const done = courses
      .filter((course) => course.status === 'COMPLETED')
      .reduce((sum, course) => sum + course.credits, 0);
    return { done, total: roadmapQuery.data?.curriculum.totalCredits ?? 0 };
  }, [roadmapQuery.data]);

  // ---- timetable preview ----
  const timetableItems = useMemo<WeeklyGridAgendaItem[]>(() => {
    const items: WeeklyGridAgendaItem[] = [];
    for (const item of registered) {
      item.section?.schedules?.forEach((schedule, index) => {
        items.push({
          id: `reg:${item.id}:${index}`,
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          courseCode: item.section?.course?.code ?? item.sectionId ?? '',
          sectionNumber: item.section?.sectionNumber ?? '',
          courseName: item.section?.course?.name,
          roomNumber: schedule.classroom?.roomNumber,
        });
      });
    }
    return items;
  }, [registered]);

  const previewTimetable = useMemo<WeeklyGridAgendaItem[]>(() => {
    const section = previewSectionId ? sectionsById.get(previewSectionId) : undefined;
    if (!section || enrollmentBySection.has(section.id)) return [];
    return (section.schedules ?? []).map((schedule, index) => ({
      id: `preview:${index}`,
      dayOfWeek: schedule.dayOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      courseCode: section.courseCode,
      sectionNumber: section.sectionNumber,
      courseName: section.courseName,
      roomNumber: schedule.room ?? undefined,
    }));
  }, [previewSectionId, sectionsById, enrollmentBySection]);

  const previewConflictIds = useMemo(() => {
    const conflicts = new Set<string>();
    if (previewTimetable.length === 0) return conflicts;
    for (const item of previewTimetable) {
      const hit = findScheduleConflict(
        [{ dayOfWeek: item.dayOfWeek, startTime: item.startTime, endTime: item.endTime }],
        timetableItems,
      );
      if (hit) conflicts.add(item.id ?? '');
    }
    return conflicts;
  }, [previewTimetable, timetableItems]);

  // ---- mutations ----
  const invalidateRegistration = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['registration', 'sections'] });
    void queryClient.invalidateQueries({ queryKey: ['registration', 'enrollments'] });
    void queryClient.invalidateQueries({ queryKey: ['registration', 'summary'] });
    void queryClient.invalidateQueries({ queryKey: ['registration', 'roadmap'] });
    void queryClient.invalidateQueries({ queryKey: ['registration', 'wishes'] });
  }, [queryClient]);

  const enrollMutation = useMutation({
    mutationFn: (sectionId: string) => enrollmentsApi.enroll(sectionId, locale),
    onSuccess: () => {
      invalidateRegistration();
      toast.success(copy.success);
    },
    onError: (cause) => {
      const message = actionMessage(cause);
      setActionError(message);
      toast.error(message);
    },
  });

  const dropMutation = useMutation({
    mutationFn: (enrollmentId: string) => enrollmentsApi.drop(enrollmentId),
    onSuccess: () => {
      invalidateRegistration();
      toast.success(copy.success);
    },
    onError: (cause) => {
      const message = actionMessage(cause);
      setActionError(message);
      toast.error(message);
    },
  });

  const wishMutation = useMutation({
    mutationFn: (courseId: string) => registrationApi.addWish(courseId, semesterId ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['registration', 'wishes'] });
      toast.success(pro.wishlistAdded);
    },
    onError: (cause) => {
      toast.error(actionMessage(cause));
    },
    onSettled: () => setPendingWish(null),
  });

  const unwishMutation = useMutation({
    mutationFn: (wishId: string) => registrationApi.removeWish(wishId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['registration', 'wishes'] });
      toast.success(pro.wishlistRemoved);
    },
    onError: (cause) => toast.error(actionMessage(cause)),
    onSettled: () => setPendingWish(null),
  });

  const sectionLabel = (
    section: { sectionNumber?: string; courseCode?: string; course?: { code?: string } } | undefined,
    fallback: string,
  ) => {
    const code = section?.courseCode ?? section?.course?.code;
    const number = section?.sectionNumber;
    if (number && (!code || !number.startsWith(code))) return `${code}-${number}`;
    return number || code || fallback;
  };

  const register = async (sectionId: string) => {
    if (!enrollmentDataReady) return;
    const section = sectionsById.get(sectionId);
    if (!section) return;
    if (creditLimit !== null && totalRegisteredCredits + section.credits > creditLimit) {
      const message = copy.creditLimitExceeded.replace('{limit}', formatNumber(creditLimit));
      setActionError(message);
      toast.error(message);
      return;
    }
    const ok = await confirm({
      title: copy.confirmRegister,
      message: copy.confirmRegisterMessage.replace('{section}', sectionLabel(section, sectionId)),
      confirmText: copy.register,
    });
    if (!ok) return;
    setPending(sectionId);
    setActionError('');
    try {
      await enrollMutation.mutateAsync(sectionId);
    } catch {
      // handled by onError
    } finally {
      setPending(null);
    }
  };

  const drop = async (enrollment: Enrollment) => {
    const ok = await confirm({
      title: copy.confirmDrop,
      message: copy.confirmDropMessage.replace(
        '{section}',
        sectionLabel(enrollment.section, enrollment.sectionId),
      ),
      confirmText: copy.drop,
      variant: 'destructive',
    });
    if (!ok) return;
    setPending(enrollment.id);
    setActionError('');
    try {
      await dropMutation.mutateAsync(enrollment.id);
    } catch {
      // handled by onError
    } finally {
      setPending(null);
    }
  };

  const focusCourse = (courseCode: string) => {
    setDepartmentId('');
    setMode('all');
    setSearchText(courseCode);
    setDebouncedSearch(courseCode);
  };

  const submitSearch = (value: string) => {
    setSearchText(value);
    // Debounce the server round-trip: restart the timer per keystroke.
    window.clearTimeout((submitSearch as { timer?: number }).timer);
    (submitSearch as { timer?: number }).timer = window.setTimeout(
      () => setDebouncedSearch(value.trim()),
      350,
    );
  };

  if (authLoading) {
    return <LoadingState label={messages.common.states.loadingContent} />;
  }
  if (isForbidden || !hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  const roundOpen = Boolean(roundId) && !eligibilityQuery.isError;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {pro.backToDashboard}
          </Link>
          <Link
            href="/hoc-phi"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Wallet className="h-4 w-4" />
            {pro.tuitionLink}
          </Link>
        </div>

        <PageHeader
          eyebrow={<SectionEyebrow>{pro.eyebrow}</SectionEyebrow>}
          title={pro.title}
          description={pro.description}
        />

        {holdBlocked && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-danger/40 bg-status-danger/10 px-4 py-3">
            <div className="flex items-start gap-3">
              <Ban className="mt-0.5 h-5 w-5 text-status-danger-foreground" />
              <div>
                <p className="font-semibold text-status-danger-foreground">{pro.holdBannerTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {pro.holdBannerDescription.replace(
                    '{balance}',
                    formatCurrency(accountQuery.data?.balance ?? 0, 'VND'),
                  )}
                </p>
              </div>
            </div>
            <Link href="/hoc-phi">
              <Button variant="outline" size="sm" className="gap-2">
                <CreditCard className="h-4 w-4" />
                {pro.holdBannerCta}
              </Button>
            </Link>
          </div>
        )}

        {actionError && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 px-4 py-2.5 text-sm text-status-danger-foreground">
            <AlertCircle className="h-4 w-4" />
            {actionError}
          </div>
        )}

        {!roundOpen && !roundsQuery.isPending && (
          <div className="mt-6">
            <EmptyState title={copy.roundUnavailable} description={copy.roundUnavailableDescription} />
          </div>
        )}

        {roundOpen && (
          <div className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
            {/* ------- Left rail: curriculum roadmap ------- */}
            <aside className="space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="inline-flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      {pro.roadmapTitle}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {pro.roadmapCredits
                        .replace('{done}', formatNumber(roadmapProgress.done))
                        .replace('{total}', formatNumber(roadmapProgress.total))}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-[70vh] space-y-4 overflow-y-auto pr-2">
                  {roadmapQuery.isPending && (
                    <LoadingState label={messages.common.states.loadingContent} />
                  )}
                  {roadmapQuery.isError && (
                    <ErrorState
                      title={pro.loadRoadmapFailed}
                      description={messages.ui.state.error}
                      onRetry={() => void roadmapQuery.refetch()}
                    />
                  )}
                  {roadmapGroups.map(({ year, semesters }) => (
                    <div key={year}>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {pro.roadmapYear.replace('{year}', formatNumber(year))}
                      </p>
                      {semesters.map(({ semester, courses }) => (
                        <div key={semester} className="mb-3">
                          <p className="mb-1 border-l-2 border-primary/40 pl-2 text-xs font-medium text-muted-foreground">
                            {pro.roadmapSemester.replace('{semester}', formatNumber(semester))}
                          </p>
                          <ul className="space-y-1 pl-2">
                            {courses.map((course) => {
                              const status = roadmapStatus(course);
                              const missing = course.prerequisites
                                .filter((req) => !req.satisfied)
                                .map((req) => req.code)
                                .join(', ');
                              return (
                                <li key={course.courseId}>
                                  <button
                                    type="button"
                                    onClick={() => focusCourse(course.code)}
                                    disabled={status === 'completed'}
                                    className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                                    title={
                                      status === 'locked'
                                        ? pro.prereqMissing.replace('{code}', missing)
                                        : course.name
                                    }
                                  >
                                    <span className="mt-0.5 shrink-0">
                                      {status === 'completed' && (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-status-success-foreground" />
                                      )}
                                      {status === 'inProgress' && (
                                        <CircleDashed className="h-3.5 w-3.5 text-primary" />
                                      )}
                                      {status === 'eligible' && (
                                        <BadgeCheck className="h-3.5 w-3.5 text-status-info-foreground" />
                                      )}
                                      {status === 'locked' && (
                                        <Lock className="h-3.5 w-3.5 text-muted-foreground/60" />
                                      )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-center justify-between gap-2">
                                        <span
                                          className={`truncate text-xs font-medium ${
                                            status === 'locked'
                                              ? 'text-muted-foreground/60'
                                              : 'text-foreground group-hover:text-primary'
                                          }`}
                                        >
                                          {course.code}
                                        </span>
                                        <span className="shrink-0 text-[10px] text-muted-foreground">
                                          {formatNumber(course.credits)}tc
                                        </span>
                                      </span>
                                      <span className="block truncate text-[10px] text-muted-foreground">
                                        {locale === 'vi'
                                          ? course.nameVi || course.name
                                          : course.nameEn || course.name}
                                      </span>
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </aside>

            {/* ------- Center: catalog ------- */}
            <section className="min-w-0 space-y-4">
              <Card>
                <CardContent className="flex flex-wrap items-end gap-3 p-4">
                  <div className="min-w-[220px] flex-1">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      <Search className="mr-1 inline h-3 w-3" />
                      {pro.searchLabel}
                    </label>
                    <Input
                      value={searchText}
                      onChange={(event) => submitSearch(event.target.value)}
                      placeholder={pro.searchPlaceholder}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      <Filter className="mr-1 inline h-3 w-3" />
                      {pro.modeLabel}
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {CATALOG_MODES.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setMode(option)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            mode === option
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-card text-muted-foreground hover:bg-accent'
                          }`}
                        >
                          {option === 'all'
                            ? pro.modeAll
                            : option === 'curriculum'
                              ? pro.modeCurriculum
                              : option === 'remaining'
                                ? pro.modeRemaining
                                : pro.modeRetake}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="w-44">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {pro.departmentLabel}
                    </label>
                    <Select
                      value={departmentId}
                      onChange={(event) => setDepartmentId(event.target.value)}
                    >
                      <option value="">{pro.departmentAll}</option>
                      {departmentOptions.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.code} — {dept.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-36">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {copy.sortLabel}
                    </label>
                    <Select
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value as SectionSortMode)}
                    >
                      {SORT_MODES.map((option) => (
                        <option key={option} value={option}>
                          {option === 'code'
                            ? copy.sortCode
                            : option === 'credits'
                              ? copy.sortCredits
                              : copy.sortSeats}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex gap-3 pb-1 text-xs text-muted-foreground">
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={seatsOnly}
                        onChange={(event) => setSeatsOnly(event.target.checked)}
                      />
                      {copy.filterSeats}
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={noConflictOnly}
                        onChange={(event) => setNoConflictOnly(event.target.checked)}
                      />
                      {copy.filterNoConflict}
                    </label>
                  </div>
                </CardContent>
              </Card>

              {sectionsQuery.isPending && (
                <Card>
                  <CardContent className="p-6">
                    <LoadingState label={messages.common.states.loadingContent} />
                  </CardContent>
                </Card>
              )}
              {sectionsQuery.isError && (
                <Card>
                  <CardContent className="p-6">
                    <ErrorState
                      title={copy.loadFailed}
                      description={messages.ui.state.error}
                      onRetry={() => void sectionsQuery.refetch()}
                    />
                  </CardContent>
                </Card>
              )}
              {sectionsQuery.isSuccess && departmentGroups.length === 0 && (
                <Card>
                  <CardContent className="p-6">
                    <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} />
                  </CardContent>
                </Card>
              )}

              {departmentGroups.map((dept) => (
                <Card key={dept.departmentId}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>
                        {dept.departmentCode}
                        {dept.departmentName ? ` — ${dept.departmentName}` : ''}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {countLabel(dept.courses.length, pro.sectionsInDept, pro.sectionsInDeptPlural)}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {dept.courses.map((group) => (
                      <div key={group.courseId} className="rounded-lg border border-border">
                        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {group.courseCode} — {group.courseName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatNumber(group.credits)} {copy.creditsUnit} ·{' '}
                              {countLabel(group.sections.length, copy.groupSectionCountOne, copy.groupSectionCount)}
                            </p>
                          </div>
                          {!wishedCourseIds.has(group.courseId) && (
                            <button
                              type="button"
                              disabled={pendingWish === group.courseId}
                              onClick={() => {
                                setPendingWish(group.courseId);
                                wishMutation.mutate(group.courseId);
                              }}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              title={pro.wishlistAdd}
                            >
                              <Star className="h-3.5 w-3.5" />
                              {pro.wishlistAdd}
                            </button>
                          )}
                        </div>
                        <ul className="divide-y divide-border">
                          {group.sections.map((section) => {
                            const enrolled = enrollmentBySection.get(section.id);
                            const tier = seatTier(section);
                            return (
                              <li
                                key={section.id}
                                onMouseEnter={() => setPreviewSectionId(section.id)}
                                onMouseLeave={() =>
                                  setPreviewSectionId((current) =>
                                    current === section.id ? null : current,
                                  )
                                }
                                className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                              >
                                <div className="min-w-[120px]">
                                  <p className="text-sm font-medium">{section.sectionNumber}</p>
                                  <p
                                    className={`text-xs ${
                                      tier === 'open'
                                        ? 'text-status-success-foreground'
                                        : tier === 'low'
                                          ? 'text-status-warning-foreground'
                                          : 'text-muted-foreground'
                                    }`}
                                  >
                                    {section.remainingSeats > 0
                                      ? countLabel(
                                          section.remainingSeats,
                                          copy.seatsOpenOne,
                                          copy.seatsOpen,
                                        )
                                      : copy.full}
                                  </p>
                                </div>
                                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                                  {(section.schedules ?? []).length === 0 && (
                                    <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                      {copy.scheduleNone}
                                    </span>
                                  )}
                                  {(section.schedules ?? []).map(
                                    (schedule: RegistrationSectionSchedule, index: number) => (
                                      <span
                                        key={index}
                                        className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                                      >
                                        {shortDayLabel(locale, schedule.dayOfWeek)}{' '}
                                        {schedule.startTime}-{schedule.endTime}
                                        {schedule.room ? ` · ${schedule.room}` : ''}
                                      </span>
                                    ),
                                  )}
                                  {section.scheduleConflict && (
                                    <span
                                      className="rounded bg-status-danger/10 px-2 py-0.5 text-[11px] font-medium text-status-danger-foreground"
                                      title={copy.scheduleConflictTooltip}
                                    >
                                      {copy.conflictBadge}
                                    </span>
                                  )}
                                </div>
                                <div className="shrink-0">
                                  {enrolled ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={pending === enrolled.id}
                                      onClick={() => void drop(enrolled)}
                                      className="gap-1.5 text-status-danger-foreground"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      {pending === enrolled.id ? copy.working : copy.drop}
                                    </Button>
                                  ) : section.alreadyEnrolled ? (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-status-success/10 px-2.5 py-1.5 text-xs font-medium text-status-success-foreground">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      {copy.registered}
                                    </span>
                                  ) : (
                                    <Button
                                      size="sm"
                                      disabled={
                                        pending === section.id
                                        || section.remainingSeats <= 0
                                        || !enrollmentDataReady
                                      }
                                      onClick={() => void register(section.id)}
                                      className="gap-1.5"
                                    >
                                      <ClipboardList className="h-3.5 w-3.5" />
                                      {pending === section.id ? copy.working : copy.register}
                                    </Button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </section>

            {/* ------- Right rail: cart + wishlist + timetable ------- */}
            <aside className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    {pro.cartTitle}
                    <span className="text-xs font-normal text-muted-foreground">
                      {pro.cartCredits
                        .replace('{used}', formatNumber(totalRegisteredCredits))
                        .replace('{limit}', creditLimit !== null ? formatNumber(creditLimit) : '—')}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {registered.length === 0 && (
                    <p className="text-sm text-muted-foreground">{pro.cartEmpty}</p>
                  )}
                  {registered.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.section?.course?.code ?? item.sectionId}
                          {item.section?.sectionNumber
                            ? ` · ${item.section.sectionNumber}`
                            : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(item.section?.course?.credits ?? 0)} {copy.creditsUnit}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={pending === item.id}
                        onClick={() => void drop(item)}
                        className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-status-danger/10 hover:text-status-danger-foreground"
                        title={copy.drop}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bookmark className="h-4 w-4" />
                    {pro.wishlistTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {wishes.length === 0 && (
                    <p className="text-sm text-muted-foreground">{pro.wishlistEmpty}</p>
                  )}
                  {wishes.map((wish: RegistrationWish) => (
                    <div
                      key={wish.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {wish.courseCode} —{' '}
                          {locale === 'vi' ? wish.courseNameVi || wish.courseName : wish.courseName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(wish.credits)} {copy.creditsUnit}
                          {wish.alreadyEnrolled
                            ? ` · ${pro.wishlistEnrolled}`
                            : wish.openSectionCount > 0
                              ? ` · ${countLabel(wish.openSectionCount, pro.openSections, pro.openSectionsPlural)}`
                              : ` · ${pro.wishlistNoSections}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {!wish.alreadyEnrolled && wish.openSectionCount > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => focusCourse(wish.courseCode)}
                          >
                            {copy.register}
                          </Button>
                        )}
                        <button
                          type="button"
                          disabled={pendingWish === wish.id}
                          onClick={() => {
                            setPendingWish(wish.id);
                            unwishMutation.mutate(wish.id);
                          }}
                          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-status-danger/10 hover:text-status-danger-foreground"
                          title={pro.wishlistRemove}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {(timetableItems.length > 0 || previewTimetable.length > 0) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{copy.miniTimetableTitle}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <WeeklyGrid
                      items={[...timetableItems, ...previewTimetable]}
                      locale={locale}
                      compact
                      highlightedIds={new Set(previewTimetable.map((item) => item.id ?? ''))}
                      conflictIds={previewConflictIds}
                      labels={{
                        gridAriaLabel: copy.miniTimetableTitle,
                        today: messages.studentPages.schedule.today,
                        sectionPrefix: messages.studentPages.schedule.sectionPrefix,
                        roomPending: messages.studentPages.schedule.roomPending,
                        noSlot: copy.timetableNoMeetings,
                        blockHint: '',
                        item: copy.timetableMeeting,
                        items: copy.timetableMeetings,
                      }}
                    />
                  </CardContent>
                </Card>
              )}
            </aside>
          </div>
        )}
      </div>
      {confirmationDialog}
    </div>
  );
}
