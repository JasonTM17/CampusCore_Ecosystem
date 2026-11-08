'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Award, BookOpen, ChevronDown, FileText, GraduationCap, Info, Printer, TrendingUp } from 'lucide-react';
import { WorkspaceForbiddenState } from '@/components/ProtectedRoute';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { metricToneClass } from '@/components/ui/status';
import { StatusPill } from '@/components/ui/status-pill';
import {
  GpaTrendChart,
  GradeDistributionChart,
  TenScaleTrendChart,
} from '@/components/dashboard/TranscriptCharts';
import {
  buildCumulativeGpaTrendPoints,
  buildGpaTrendPoints,
  buildGradeDistribution,
  buildTenScaleTrendPoints,
} from '@/lib/transcript-charts';
import { GradeDetailModal } from '@/components/dashboard/GradeDetailModal';
import { cn } from '@/lib/utils';
import { useRequireAuth } from '@/context/AuthContext';
import { conductApi, curriculumApi, gradesApi, semestersApi } from '@/lib/api';
import { getLocalizedFlatLabel, getLocalizedName } from '@/lib/academic-content';
import {
  type MyCurriculumCourse,
  type MyCurriculumResponse,
  Semester,
  StudentGradeRecord,
  StudentTranscriptSemester,
} from '@/types/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useI18n } from '@/i18n';
import { CONVERSION_TABLE, resolveGradePoint, bandUpperDisplay } from '@/lib/grade-scale';
import { StudentUteProfileGradeView } from '@/components/dashboard/StudentUteProfileGradeView';

function getGradeTone(letterGrade: string | null) {
  if (!letterGrade) {
    return metricToneClass('neutral');
  }

  if (letterGrade.startsWith('A')) {
    return metricToneClass('success');
  }

  if (letterGrade.startsWith('B')) {
    return metricToneClass('info');
  }

  if (letterGrade.startsWith('C') || letterGrade.startsWith('D')) {
    return metricToneClass('warning');
  }

  return metricToneClass('danger');
}

function getGradePoint(record: StudentGradeRecord) {
  return resolveGradePoint(record);
}

// The transcript summary is best-attempt basis (repeat-course policy), so it can
// legitimately differ from the semester rows. The backend explains that with an
// optional basisNote on the summary; accept both a plain string and a {vi,en}
// object so the note renders as soon as either shape arrives.
function resolveBasisNote(
  basisNote: string | { vi?: string; en?: string } | undefined,
  locale: string,
): string | null {
  if (!basisNote) return null;
  if (typeof basisNote === 'string') {
    return basisNote.trim() || null;
  }
  const text = locale === 'vi' ? basisNote.vi : basisNote.en;
  const fallback = text ?? basisNote.vi ?? basisNote.en ?? '';
  return fallback.trim() || null;
}

export default function TranscriptPage() {
  const { user, hasAccess, isLoading: authLoading } = useRequireAuth(['STUDENT']);
  const { locale, formatDate, formatNumber, messages } = useI18n();
  const transcriptMessages = messages.studentPages.transcript;
  const [transcriptData, setTranscriptData] = useState<{
    summary: {
      cumulativeGpa: number;
      totalCreditsEarned: number;
      totalCreditsAttempted: number;
      basisNote?: string | { vi?: string; en?: string };
    };
    semesters: StudentTranscriptSemester[];
  } | null>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [semesterOverrides, setSemesterOverrides] = useState<Record<string, boolean>>({});
  const [selectedRecord, setSelectedRecord] = useState<StudentGradeRecord | null>(null);
  const [gpaMode, setGpaMode] = useState<'cumulative' | 'semester' | 'both'>('both');
  const [curriculumData, setCurriculumData] = useState<MyCurriculumResponse | null>(null);
  const [curriculumState, setCurriculumState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // The office-issued MSSV lives on the student record, not on the auth
  // session (whose `studentId` is the internal profile id, e.g.
  // "student-profile"). It is resolved through the student-readable conduct
  // summary, which returns the real `studentCode`.
  const [studentCode, setStudentCode] = useState('');
  const loadGeneration = useRef(0);

  const fetchSemesters = useCallback(async () => {
    try {
      const response = await semestersApi.getAll();
      setSemesters(response.data ?? []);
    } catch {
      // Non-fatal: the semester filter stays on "all" while the transcript
      // fetch below still reports its own error state.
    }
  }, []);

  const fetchTranscript = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    setError('');

    try {
      const data = await gradesApi.getMyTranscript();
      if (generation !== loadGeneration.current) return;
      setTranscriptData(data);
    } catch {
      if (generation !== loadGeneration.current) return;
      setError(transcriptMessages.loadFailed);
    } finally {
      if (generation === loadGeneration.current) {
        setIsLoading(false);
      }
    }
  }, [transcriptMessages.loadFailed]);

  useEffect(() => {
    if (hasAccess) {
      void fetchSemesters();
    }
  }, [fetchSemesters, hasAccess]);

  useEffect(() => {
    if (hasAccess) {
      void fetchTranscript();
    }
  }, [fetchTranscript, hasAccess]);

  useEffect(() => {
    if (!hasAccess) return;
    let cancelled = false;
    setCurriculumState('loading');
    curriculumApi
      .getMyCurriculum()
      .then((data) => {
        if (cancelled) return;
        setCurriculumData(data);
        setCurriculumState('ready');
      })
      .catch(() => {
        if (!cancelled) setCurriculumState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [hasAccess]);

  useEffect(() => {
    if (!hasAccess) return;
    let cancelled = false;
    conductApi
      .getMyConduct()
      .then((summary) => {
        if (cancelled) return;
        const code = summary?.studentCode?.trim();
        // The backend stringifies the column, so a missing record arrives as
        // the literal "null"; treat that as unresolved rather than as an MSSV.
        if (code && code !== 'null' && code !== 'undefined') setStudentCode(code);
      })
      .catch(() => {
        // The MSSV is a display field: an unavailable lookup stays blank (the
        // printout renders an em-dash) and never falls back to the internal
        // profile id.
      });
    return () => {
      cancelled = true;
    };
  }, [hasAccess]);

  const transcriptSemesters = useMemo(() => {
    const all = transcriptData?.semesters ?? [];
    if (!selectedSemester) return all;
    return all.filter((semester) => semester.semesterId === selectedSemester);
  }, [transcriptData, selectedSemester]);

  const selectedSemesterName = useMemo(() => {
    return (
      getLocalizedName(
        locale,
        semesters.find((semester) => semester.id === selectedSemester),
        transcriptMessages.allSemestersFallback,
      ) ??
      transcriptMessages.allSemestersFallback
    );
  }, [locale, selectedSemester, semesters, transcriptMessages.allSemestersFallback]);

  const gpaTrendPoints = useMemo(
    () => buildGpaTrendPoints(transcriptData?.semesters ?? [], locale),
    [locale, transcriptData],
  );

  const cumulativeGpaTrendPoints = useMemo(
    () =>
      buildCumulativeGpaTrendPoints(
        transcriptData?.semesters ?? [],
        locale,
        transcriptData?.summary?.cumulativeGpa,
      ),
    [locale, transcriptData],
  );

  const gradeDistribution = useMemo(
    () => buildGradeDistribution(transcriptSemesters),
    [transcriptSemesters],
  );

  const tenScaleTrendPoints = useMemo(
    () => buildTenScaleTrendPoints(transcriptData?.semesters ?? [], locale),
    [locale, transcriptData],
  );

  const summaryBasisNote = useMemo(
    () => resolveBasisNote(transcriptData?.summary?.basisNote, locale),
    [locale, transcriptData],
  );

  // The printed conversion note reuses the same table the on-screen scale
  // renders, so the letter bands cannot drift from the official scale.
  const gradeScaleNote = useMemo(
    () =>
      CONVERSION_TABLE.map((row) =>
        row.letter === 'F'
          ? `${row.letter} (< 4.0: ${row.point.toFixed(1)})`
          : `${row.letter} (${row.min.toFixed(1)} – ${bandUpperDisplay(row.max!)}: ${row.point.toFixed(1)})`,
      ).join(', '),
    [],
  );

  const curriculumCourses = curriculumData?.courses ?? [];

  const curriculumGroups = useMemo(() => {
    const courses = curriculumData?.courses ?? [];
    const groups = new Map<string, { year: number; semester: number; courses: MyCurriculumCourse[] }>();
    courses.forEach((course) => {
      const key = `${course.year}-${course.semester}`;
      const group = groups.get(key) ?? { year: course.year, semester: course.semester, courses: [] };
      group.courses.push(course);
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => a.year - b.year || a.semester - b.semester);
  }, [curriculumData]);

  const completedCourseCount = curriculumData
    ? curriculumCourses.filter((course) => course.status === 'COMPLETED').length
    : (transcriptData?.semesters ?? []).reduce(
        (sum, semester) =>
          sum + semester.records.filter((record) => Boolean(record.letterGrade)).length,
        0,
      );

  const inProgressCourseCount = curriculumData
    ? curriculumCourses.filter((course) => course.status === 'IN_PROGRESS').length
    : (transcriptData?.semesters ?? []).reduce(
        (sum, semester) =>
          sum + semester.records.filter((record) => !record.letterGrade).length,
        0,
      );

  const curriculumCompletedCredits = curriculumCourses
    .filter((course) => course.status === 'COMPLETED')
    .reduce((sum, course) => sum + course.credits, 0);

  const curriculumCreditPercent = useMemo(() => {
    const total = curriculumData?.curriculum.totalCredits ?? 0;
    if (total <= 0) return 0;
    return Math.min(100, Math.round((curriculumCompletedCredits / total) * 100));
  }, [curriculumCompletedCredits, curriculumData]);

  const statusLabel = (status: string | null | undefined) =>
    messages.common.statuses[
      (status ?? 'UNKNOWN').toUpperCase() as keyof typeof messages.common.statuses
    ] ?? messages.common.statuses.UNKNOWN;

  const renderCurriculumStatus = (course: MyCurriculumCourse) => {
    if (course.status === 'COMPLETED') {
      return (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          <StatusPill tone="success" className="py-1 font-semibold">
            {transcriptMessages.statusCompleted}
          </StatusPill>
          {course.letterGrade ? (
            <span className="text-xs font-semibold text-foreground">
              {course.letterGrade}
              {typeof course.finalGrade === 'number'
                ? ` · ${course.finalGrade.toFixed(1)}`
                : ''}
            </span>
          ) : null}
        </span>
      );
    }
    if (course.status === 'IN_PROGRESS') {
      return (
        <StatusPill tone="info" className="py-1 font-semibold">
          {transcriptMessages.statusInProgress}
        </StatusPill>
      );
    }
    return <StatusPill tone="neutral">{transcriptMessages.statusNotStarted}</StatusPill>;
  };

  if (authLoading) {
    return <LoadingState label={transcriptMessages.loading} />;
  }

  if (!hasAccess) {
    return <WorkspaceForbiddenState signedIn={Boolean(user)} />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>{transcriptMessages.eyebrow}</SectionEyebrow>}
        title={transcriptMessages.title}
        description={transcriptMessages.description}
        actions={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-[220px]">
              <Select
                aria-label={transcriptMessages.selectSemester}
                value={selectedSemester}
                onChange={(event) => setSelectedSemester(event.target.value)}
                options={[
                  { value: '', label: transcriptMessages.allSemesters },
                  ...semesters.map((semester) => ({
                    value: semester.id,
                    label: getLocalizedName(locale, semester, semester.name),
                  })),
                ]}
              />
            </div>
            <LinkButton href="/dashboard/grades" variant="outline">
              {transcriptMessages.openGrades}
            </LinkButton>
            <Button
              variant="outline"
              onClick={() => window.print()}
              className="print:hidden"
            >
              <Printer className="mr-1.5 h-4 w-4" />
              {transcriptMessages.printTranscript}
            </Button>
          </div>
        }
      />

      {error ? (
        <ErrorState
          title={transcriptMessages.unavailableTitle}
          description={error}
          onRetry={() => void fetchTranscript()}
        />
      ) : isLoading ? (
        <LoadingState label={transcriptMessages.loading} />
      ) : !transcriptData || transcriptSemesters.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={transcriptMessages.emptyTitle}
          description={transcriptMessages.emptyDescription}
          action={
            <LinkButton href="/dashboard/grades">{transcriptMessages.openGrades}</LinkButton>
          }
        />
      ) : (
        <>
          {/* Printable Official Institutional Header */}
          <div className="hidden print:block mb-6 border-b-2 border-primary/40 pb-4 text-center">
            <div className="text-xs uppercase font-bold tracking-wider text-muted-foreground">
              {transcriptMessages.print.ministry}
            </div>
            <div className="text-sm font-extrabold text-foreground">
              {transcriptMessages.print.office}
            </div>
            <h1 className="text-xl font-black text-primary mt-2 uppercase tracking-wide">
              {transcriptMessages.print.title}
            </h1>
            <p className="text-xs italic text-muted-foreground mt-0.5">
              {transcriptMessages.print.subtitle}
            </p>
            <div className="flex flex-wrap justify-center gap-6 mt-4 text-xs text-foreground font-medium border-t border-border/40 pt-3">
              {/* Official printout binds to the signed-in student only: a
                  missing field stays visibly blank instead of falling back to
                  another person's record. */}
              <span><strong>{transcriptMessages.print.fullName}</strong> {`${user?.lastName ?? ''} ${user?.firstName ?? ''}`.trim() || '—'}</span>
              <span><strong>{transcriptMessages.print.studentId}</strong> {studentCode || '—'}</span>
              <span><strong>{transcriptMessages.print.major}</strong> {curriculumData?.curriculum?.name || '—'}</span>
              <span><strong>{transcriptMessages.print.selectedTerm}</strong> {selectedSemesterName}</span>
            </div>
          </div>

          <StudentUteProfileGradeView
            transcriptSemesters={transcriptSemesters}
            curriculumData={curriculumData}
            selectedSemesterId={selectedSemester}
            onSemesterChange={setSelectedSemester}
            studentCode={studentCode}
            availableSemesters={semesters.map((s) => ({
              id: s.id,
              name: getLocalizedName(locale, s, s.name),
            }))}
          />

          <div className="grid gap-4 md:grid-cols-4">
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">{transcriptMessages.cumulativeGpa}</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {typeof transcriptData.summary.cumulativeGpa === 'number'
                      ? transcriptData.summary.cumulativeGpa.toFixed(2)
                      : '—'}
                  </div>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${metricToneClass('info')}`}>
                  <TrendingUp className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">{transcriptMessages.earnedCredits}</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatNumber(transcriptData.summary.totalCreditsEarned)}
                    {curriculumData ? (
                      <span className="text-lg font-medium text-muted-foreground">
                        {' '}/ {formatNumber(curriculumData.curriculum.totalCredits)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${metricToneClass('success')}`}>
                  <Award className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">{transcriptMessages.completedCourses}</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatNumber(completedCourseCount)}
                  </div>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${metricToneClass('neutral')}`}>
                  <GraduationCap className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">{transcriptMessages.inProgressCourses}</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatNumber(inProgressCourseCount)}
                  </div>
                </div>
                <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${metricToneClass('warning')}`}>
                  <FileText className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {summaryBasisNote ? (
            <p className="-mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{summaryBasisNote}</span>
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card variant="elevated">
              <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">{transcriptMessages.gpaTrend}</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {gpaMode === 'cumulative'
                      ? transcriptMessages.gpaAllTrend
                      : gpaMode === 'semester'
                        ? transcriptMessages.gpaSemesterTrend
                        : transcriptMessages.gpaBothTrend}
                  </p>
                </div>
                {/* Round-5 polish: a single pill-shaped segmented control —
                    the active mode is a filled primary pill, the rest quiet. */}
                <div
                  className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/50 p-1 text-xs font-medium"
                  role="group"
                  aria-label={transcriptMessages.gpaTrend}
                >
                  {([
                    ['cumulative', transcriptMessages.gpaAllTrend],
                    ['semester', transcriptMessages.gpaSemesterTrend],
                    ['both', transcriptMessages.gpaBothTrend],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={gpaMode === mode}
                      onClick={() => setGpaMode(mode)}
                      className={cn(
                        'rounded-full px-3.5 py-1.5 transition-all duration-150',
                        gpaMode === mode
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <GpaTrendChart
                  points={gpaTrendPoints}
                  cumulativePoints={cumulativeGpaTrendPoints}
                  mode={gpaMode}
                  selectedLabel={selectedSemester ? selectedSemesterName : undefined}
                  ariaLabel={transcriptMessages.gpaTrend}
                  chartLabels={transcriptMessages.chartLabels}
                />
              </CardContent>
            </Card>
            {/* The 0-10 average gets its own axis; plotting it on the 4.0 plot
                put both series at nearly the same height. */}
            {tenScaleTrendPoints.length > 0 ? (
              <Card variant="elevated">
                <CardHeader className="border-b border-border/70">
                  <CardTitle className="text-base">{transcriptMessages.avgTenScale}</CardTitle>
                  <CardDescription>{transcriptMessages.tenScaleTrendHint}</CardDescription>
                </CardHeader>
                <CardContent>
                  <TenScaleTrendChart
                    points={tenScaleTrendPoints}
                    ariaLabel={`${transcriptMessages.gpaTrend} — ${transcriptMessages.avgTenScale}`}
                    chartLabels={transcriptMessages.chartLabels}
                  />
                </CardContent>
              </Card>
            ) : null}
            <Card variant="elevated">
              <CardHeader>
                <CardTitle className="text-base">{transcriptMessages.distribution}</CardTitle>
              </CardHeader>
              <CardContent>
                <GradeDistributionChart
                  buckets={gradeDistribution}
                  ariaLabel={transcriptMessages.distribution}
                  chartLabels={transcriptMessages.chartLabels}
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {transcriptSemesters.map((semester, semesterIndex) => {
              const isSemesterOpen =
                semesterOverrides[semester.semesterId] ??
                semesterIndex === transcriptSemesters.length - 1;
              const semesterLabel = getLocalizedFlatLabel(
                locale,
                semester.semesterName,
                semester.semesterNameEn,
                semester.semesterNameVi,
                semester.semesterName,
              );
              return (
              <Card key={semester.semesterId} variant="muted">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-xl">
                      {semesterLabel}
                    </CardTitle>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{transcriptMessages.clickToViewDetail}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground">
                      {formatNumber(semester.records.length)}{' '}
                      {semester.records.length === 1 ? transcriptMessages.courseWord : transcriptMessages.coursesWord}{' '}
                      - {formatNumber(semester.creditsAttempted)} {transcriptMessages.creditsAttempted} -{' '}
                      {transcriptMessages.gradePointLabel}{' '}
                      {typeof semester.gpa === 'number' ? semester.gpa.toFixed(2) : '—'}
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden"
                      aria-expanded={isSemesterOpen}
                      aria-label={`${semesterLabel}: ${transcriptMessages.toggleSemester}`}
                      onClick={() =>
                        setSemesterOverrides((current) => ({
                          ...current,
                          [semester.semesterId]: !(
                            current[semester.semesterId] ??
                            semesterIndex === transcriptSemesters.length - 1
                          ),
                        }))
                      }
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${isSemesterOpen ? '' : '-rotate-90'}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className={isSemesterOpen ? undefined : 'hidden print:block'}>
                  <div
                    className="space-y-3 md:hidden"
                    role="list"
                    aria-label={transcriptMessages.headers.course}
                  >
                    {semester.records.map((record) => (
                      <div key={`${record.id}-mobile`} role="listitem">
                      <article
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedRecord(record)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedRecord(record);
                          }
                        }}
                        className="cursor-pointer rounded-xl border border-border/80 bg-card p-5 shadow-xs transition hover:border-primary/50 hover:bg-muted/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                              {record.courseCode}
                            </p>
                            <h3 className="mt-1 break-words font-semibold text-foreground">
                              {getLocalizedFlatLabel(
                                locale,
                                record.courseName,
                                record.courseNameEn,
                                record.courseNameVi,
                                record.courseName,
                              )}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {record.sectionCode}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${getGradeTone(record.letterGrade)}`}
                          >
                            {record.letterGrade || '-'}
                          </span>
                        </div>
                        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 text-sm">
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {transcriptMessages.headers.credits}
                            </dt>
                            <dd className="mt-1 text-foreground">
                              {formatNumber(record.credits)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {transcriptMessages.headers.score}
                            </dt>
                            <dd className="mt-1 text-foreground">
                              {typeof record.finalGrade === 'number'
                                ? record.finalGrade.toFixed(1)
                                : '-'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {transcriptMessages.headers.points}
                            </dt>
                            <dd className="mt-1 text-foreground">
                              {typeof getGradePoint(record) === 'number'
                                ? getGradePoint(record)?.toFixed(1)
                                : '-'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {transcriptMessages.headers.enrollment}
                            </dt>
                            <dd className="mt-1 break-words text-foreground">
                              {statusLabel(record.enrollmentStatus)}
                            </dd>
                          </div>
                          <div className="col-span-2 border-t border-border/60 pt-3">
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {transcriptMessages.headers.gradeStatus}
                            </dt>
                            <dd className="mt-1 break-words text-foreground">
                              {statusLabel(record.gradeStatus)}
                            </dd>
                          </div>
                        </dl>
                      </article>
                      </div>
                    ))}
                  </div>
                  <div
                    className="hidden overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block"
                    role="region"
                    aria-label={transcriptMessages.headers.course}
                    tabIndex={0}
                  >
                    <table className="w-full min-w-[840px] text-sm">
                      <thead>
                        <tr className="border-b border-border/70 text-left text-muted-foreground">
                          <th className="px-4 py-3.5 font-medium">{transcriptMessages.headers.course}</th>
                          <th className="px-4 py-3.5 font-medium">{transcriptMessages.headers.section}</th>
                          <th className="px-4 py-3.5 text-center font-medium">{transcriptMessages.headers.credits}</th>
                          <th className="px-4 py-3.5 text-center font-medium">{transcriptMessages.headers.score}</th>
                          <th className="px-4 py-3.5 text-center font-medium">{transcriptMessages.headers.grade}</th>
                          <th className="px-4 py-3.5 text-center font-medium">{transcriptMessages.headers.points}</th>
                          <th className="px-4 py-3.5 text-center font-medium">{transcriptMessages.headers.enrollment}</th>
                          <th className="px-4 py-3.5 text-right font-medium">{transcriptMessages.headers.gradeStatus}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {semester.records.map((record) => (
                          <tr
                            key={record.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedRecord(record)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedRecord(record);
                              }
                            }}
                            className="group cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                            title={transcriptMessages.clickToViewDetail}
                          >
                            <td className="px-4 py-3.5">
                              <div className="font-medium text-foreground group-hover:text-primary transition-colors">
                                {record.courseCode}
                              </div>
                              <div className="text-muted-foreground">
                                {getLocalizedFlatLabel(
                                  locale,
                                  record.courseName,
                                  record.courseNameEn,
                                  record.courseNameVi,
                                  record.courseName,
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {record.sectionCode}
                            </td>
                            <td className="px-4 py-3.5 text-center text-muted-foreground">
                              {formatNumber(record.credits)}
                            </td>
                            <td className="px-4 py-3.5 text-center text-foreground font-semibold">
                              {typeof record.finalGrade === 'number'
                                ? record.finalGrade.toFixed(1)
                                : '-'}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              {record.letterGrade ? (
                                <span
                                  className={`inline-flex min-w-[2.75rem] items-center justify-center rounded-md px-2.5 py-1 text-xs font-semibold ${getGradeTone(
                                    record.letterGrade,
                                  )}`}
                                >
                                  {record.letterGrade}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center text-muted-foreground">
                              {typeof getGradePoint(record) === 'number'
                                ? getGradePoint(record)?.toFixed(1)
                                : '-'}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                                {statusLabel(record.enrollmentStatus)}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                                {statusLabel(record.gradeStatus)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>

          {/* Study program: per-course status grouped by year and semester */}
          {curriculumState === 'loading' ? (
            <Card variant="muted">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                {transcriptMessages.programLoading}
              </CardContent>
            </Card>
          ) : curriculumData ? (
            <Card variant="muted">
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-xl">{transcriptMessages.programTitle}</CardTitle>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {getLocalizedFlatLabel(
                      locale,
                      curriculumData.curriculum.name,
                      curriculumData.curriculum.nameEn,
                      curriculumData.curriculum.nameVi,
                      curriculumData.curriculum.name,
                    )}
                    {' · '}
                    {curriculumData.curriculum.code}
                  </p>
                </div>
                <div className="w-full max-w-xs shrink-0 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatNumber(curriculumCompletedCredits)} /{' '}
                      {formatNumber(curriculumData.curriculum.totalCredits)}{' '}
                      {transcriptMessages.programCreditsUnit}
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {curriculumCreditPercent}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${curriculumCreditPercent}%` }}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {curriculumGroups.map((group) => (
                  <section
                    key={`${group.year}-${group.semester}`}
                    aria-label={transcriptMessages.yearSemesterLabel.replace('{year}', String(group.year)).replace('{semester}', String(group.semester))}
                  >
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {transcriptMessages.yearSemesterLabel.replace('{year}', String(group.year)).replace('{semester}', String(group.semester))}
                    </h3>
                    <div className="space-y-2 md:hidden">
                      {group.courses.map((course) => (
                        <div
                          key={course.courseId}
                          className="rounded-lg border border-border/70 bg-card p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                {course.code}
                              </p>
                              <h4 className="mt-0.5 break-words text-sm font-semibold text-foreground">
                                {getLocalizedFlatLabel(
                                  locale,
                                  course.name,
                                  course.nameEn,
                                  course.nameVi,
                                  course.name,
                                )}
                              </h4>
                            </div>
                            {renderCurriculumStatus(course)}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                            <span>
                              {formatNumber(course.credits)} {transcriptMessages.programHeaders.credits}
                            </span>
                            {course.isMandatory ? (
                              <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                                {transcriptMessages.mandatory}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div
                      className="hidden overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block"
                      role="region"
                      aria-label={transcriptMessages.programHeaders.course}
                      tabIndex={0}
                    >
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/70 text-left text-muted-foreground">
                            <th className="px-2 py-2.5 font-medium">{transcriptMessages.programHeaders.course}</th>
                            <th className="px-2 py-2.5 text-center font-medium">{transcriptMessages.programHeaders.credits}</th>
                            <th className="px-2 py-2.5 text-center font-medium">{transcriptMessages.mandatory}</th>
                            <th className="px-2 py-2.5 text-right font-medium">{transcriptMessages.programHeaders.status}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {group.courses.map((course) => (
                            <tr key={course.courseId} className="transition-colors hover:bg-muted/50">
                              <td className="px-2 py-3">
                                <div className="font-medium text-foreground">{course.code}</div>
                                <div className="text-muted-foreground">
                                  {getLocalizedFlatLabel(
                                    locale,
                                    course.name,
                                    course.nameEn,
                                    course.nameVi,
                                    course.name,
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-3 text-center text-muted-foreground">
                                {formatNumber(course.credits)}
                              </td>
                              <td className="px-2 py-3 text-center">
                                {course.isMandatory ? (
                                  <span className="inline-flex rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                                    {transcriptMessages.mandatory}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="px-2 py-3 text-right">
                                {renderCurriculumStatus(course)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={BookOpen}
              title={transcriptMessages.programEmpty}
              description={
                transcriptMessages.programEmptyDescription
              }
              className="min-h-[120px] border-none bg-transparent px-0 py-0"
            />
          )}

          {/* Feedback item 2: the official 10 → letter → 4.0 conversion is a
              first-class, always-visible card (previously it existed only in
              the print block). One source of truth in grade-scale.ts. */}
          <Card className="mt-6 print:mt-10">
            <CardHeader>
              <CardTitle className="text-base">
                {transcriptMessages.print.conversionTitle}
              </CardTitle>
              <CardDescription>
                {transcriptMessages.print.conversionDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-hidden rounded-lg border border-border/70">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-secondary/50 text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">
                        {transcriptMessages.print.tenPointScale}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {transcriptMessages.print.letterGrade}
                      </th>
                      <th className="px-3 py-2 font-semibold">
                        {transcriptMessages.print.fourPointScale}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {CONVERSION_TABLE.map((row, index) => (
                      <tr
                        key={row.letter}
                        className={index % 2 === 0 ? 'bg-card' : 'bg-secondary/20'}
                      >
                        <td className="px-3 py-1.5 font-mono text-foreground">
                          {row.letter === 'F'
                            ? '< 4.0'
                            : `${row.min.toFixed(1)} – ${bandUpperDisplay(row.max!)}`}
                        </td>
                        <td className="px-3 py-1.5 font-semibold text-foreground">{row.letter}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">
                          {row.point.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {locale === 'vi' ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {transcriptMessages.print.failingNote}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Official Institutional Sign-off Block for Print Document */}
          <div className="hidden print:block mt-10 pt-6 border-t border-border/80">
            <div className="text-[11px] text-muted-foreground mb-4 space-y-1">
              <p><strong>{transcriptMessages.print.creditScaleNote}</strong></p>
              <p>
                {transcriptMessages.print.letterGradesLabel}
                {gradeScaleNote}
                {transcriptMessages.print.letterGradesFailure}
              </p>
            </div>
            {/* Machine-generated documents claim no officials: the former
                "TRƯỞNG KHOA CNTT" and "KT. HIỆU TRƯỞNG / PHÓ HIỆU TRƯỞNG"
                slots invented authority that never signed anything. Only a
                neutral preparer slot with the system name and the generation
                date remains; an authenticated signature block can be added
                when the backend actually issues one. */}
            <div className="flex justify-center text-center text-xs">
              <div>
                <p className="font-bold uppercase tracking-wider">
                  {transcriptMessages.print.preparedBy}
                </p>
                <p className="italic text-muted-foreground mt-1">
                  {transcriptMessages.print.signatureHint}
                </p>
                <div className="h-20" />
                <p className="font-semibold">{transcriptMessages.print.systemName}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {transcriptMessages.print.generatedOn.replace(
                    '{date}',
                    formatDate(new Date(), { month: 'numeric', day: 'numeric', year: 'numeric' }),
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Grade Detail Modal for GK / CK Breakdown */}
          <GradeDetailModal
            record={selectedRecord}
            isOpen={Boolean(selectedRecord)}
            onClose={() => setSelectedRecord(null)}
          />
        </>
      )}
    </div>
  );
}
