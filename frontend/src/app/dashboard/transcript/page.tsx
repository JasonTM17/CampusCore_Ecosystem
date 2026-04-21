'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Award, FileText, GraduationCap, TrendingUp } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { gradesApi, semestersApi } from '@/lib/api';
import {
  Semester,
  StudentGradeRecord,
  StudentTranscriptSemester,
} from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';

function getGradeTone(letterGrade: string | null) {
  if (!letterGrade) {
    return 'bg-secondary text-muted-foreground';
  }

  if (letterGrade.startsWith('A')) {
    return 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400';
  }

  if (letterGrade.startsWith('B')) {
    return 'bg-blue-500/12 text-blue-600 dark:text-blue-400';
  }

  if (letterGrade.startsWith('C')) {
    return 'bg-amber-500/12 text-amber-600 dark:text-amber-400';
  }

  if (letterGrade.startsWith('D')) {
    return 'bg-orange-500/12 text-orange-600 dark:text-orange-400';
  }

  return 'bg-rose-500/12 text-rose-600 dark:text-rose-400';
}

const gradePoints: Record<string, number> = {
  'A+': 4,
  A: 4,
  'A-': 3.7,
  'B+': 3.3,
  B: 3,
  'B-': 2.7,
  'C+': 2.3,
  C: 2,
  'C-': 1.7,
  'D+': 1.3,
  D: 1,
  'D-': 0.7,
  F: 0,
};

function getGradePoint(record: StudentGradeRecord) {
  if (typeof record.gradePoint === 'number') {
    return record.gradePoint;
  }

  if (record.letterGrade && gradePoints[record.letterGrade] !== undefined) {
    return gradePoints[record.letterGrade];
  }

  return null;
}

export default function TranscriptPage() {
  const { hasAccess, isLoading: authLoading } = useRequireAuth(['STUDENT']);
  const [transcriptData, setTranscriptData] = useState<{
    summary: {
      cumulativeGpa: number;
      totalCreditsEarned: number;
      totalCreditsAttempted: number;
    };
    semesters: StudentTranscriptSemester[];
  } | null>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSemesters = useCallback(async () => {
    const response = await semestersApi.getAll();
    setSemesters(response.data ?? []);
  }, []);

  const fetchTranscript = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await gradesApi.getMyTranscript(selectedSemester || undefined);
      setTranscriptData(data);
    } catch {
      setError('Transcript data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSemester]);

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

  const transcriptSemesters = useMemo(
    () => transcriptData?.semesters ?? [],
    [transcriptData],
  );

  const totalCourses = useMemo(
    () =>
      transcriptSemesters.reduce(
        (sum, semester) => sum + semester.records.length,
        0,
      ),
    [transcriptSemesters],
  );

  const selectedSemesterName = useMemo(() => {
    return (
      semesters.find((semester) => semester.id === selectedSemester)?.name ??
      'all semesters'
    );
  }, [selectedSemester, semesters]);

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading transcript" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Student workspace</SectionEyebrow>}
        title="Transcript"
        description={`Review the long-form academic record for ${selectedSemesterName}, including cumulative GPA and semester-by-semester outcomes.`}
        actions={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-[220px]">
              <Select
                aria-label="Select semester for transcript"
                value={selectedSemester}
                onChange={(event) => setSelectedSemester(event.target.value)}
                options={[
                  { value: '', label: 'All semesters' },
                  ...semesters.map((semester) => ({
                    value: semester.id,
                    label: semester.name,
                  })),
                ]}
              />
            </div>
            <Link href="/dashboard/grades">
              <Button variant="outline">Open grades</Button>
            </Link>
          </div>
        }
      />

      {error ? (
        <ErrorState
          title="Transcript unavailable"
          description={error}
          onRetry={() => void fetchTranscript()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading transcript" />
      ) : !transcriptData || transcriptSemesters.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No transcript records yet"
          description="Completed courses and published grades will accumulate here once academic outcomes are available."
          action={
            <Link href="/dashboard/grades">
              <Button>Open grades</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Cumulative GPA
                  </div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {transcriptData.summary.cumulativeGpa.toFixed(2)}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Earned credits
                  </div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {transcriptData.summary.totalCreditsEarned}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <Award className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Attempted credits
                  </div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {transcriptData.summary.totalCreditsAttempted}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400">
                  <GraduationCap className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Courses</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {totalCourses}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400">
                  <FileText className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            {transcriptSemesters.map((semester) => (
              <Card key={semester.semesterId} variant="muted">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-xl">{semester.semesterName}</CardTitle>
                  <div className="text-sm text-muted-foreground">
                    {semester.records.length} course
                    {semester.records.length === 1 ? '' : 's'} -{' '}
                    {semester.creditsAttempted} credits attempted - GPA{' '}
                    {semester.gpa.toFixed(2)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[840px] text-sm">
                      <thead>
                        <tr className="border-b border-border/70 text-left text-muted-foreground">
                          <th className="px-2 py-3 font-medium">Course</th>
                          <th className="px-2 py-3 font-medium">Section</th>
                          <th className="px-2 py-3 text-center font-medium">Credits</th>
                          <th className="px-2 py-3 text-center font-medium">Score</th>
                          <th className="px-2 py-3 text-center font-medium">Grade</th>
                          <th className="px-2 py-3 text-center font-medium">Points</th>
                          <th className="px-2 py-3 text-center font-medium">
                            Enrollment
                          </th>
                          <th className="px-2 py-3 text-right font-medium">
                            Grade status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {semester.records.map((record) => (
                          <tr key={record.id}>
                            <td className="px-2 py-4">
                              <div className="font-medium text-foreground">
                                {record.courseCode}
                              </div>
                              <div className="text-muted-foreground">
                                {record.courseName}
                              </div>
                            </td>
                            <td className="px-2 py-4 text-muted-foreground">
                              {record.sectionCode}
                            </td>
                            <td className="px-2 py-4 text-center text-muted-foreground">
                              {record.credits}
                            </td>
                            <td className="px-2 py-4 text-center text-foreground">
                              {typeof record.finalGrade === 'number'
                                ? record.finalGrade.toFixed(1)
                                : '-'}
                            </td>
                            <td className="px-2 py-4 text-center">
                              {record.letterGrade ? (
                                <span
                                  className={`inline-flex min-w-[2.75rem] items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ${getGradeTone(
                                    record.letterGrade,
                                  )}`}
                                >
                                  {record.letterGrade}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-2 py-4 text-center text-muted-foreground">
                              {typeof getGradePoint(record) === 'number'
                                ? getGradePoint(record)?.toFixed(1)
                                : '-'}
                            </td>
                            <td className="px-2 py-4 text-center">
                              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                                {record.enrollmentStatus}
                              </span>
                            </td>
                            <td className="px-2 py-4 text-right">
                              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                                {record.gradeStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
