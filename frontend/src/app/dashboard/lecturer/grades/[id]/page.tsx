'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle, FileText, Save, Send, Users } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { sectionsApi } from '@/lib/api';
import { SectionGrades } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { toast } from 'sonner';

type GradeUpdate = {
  enrollmentId: string;
  finalGrade: number;
  letterGrade: string;
};

const letterGrades = [
  'A+',
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D+',
  'D',
  'D-',
  'F',
];

function calculateGrade(score: number) {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 63) return 'D';
  if (score >= 60) return 'D-';
  return 'F';
}

export default function SectionGradingPage() {
  const params = useParams<{ id: string }>();
  const { hasAccess, isLoading: authLoading } = useRequireAuth(['LECTURER']);
  const [sectionData, setSectionData] = useState<SectionGrades | null>(null);
  const [grades, setGrades] = useState<Map<string, GradeUpdate>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState('');
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const sectionId = params?.id;

  const fetchSectionGrades = useCallback(async () => {
    if (!sectionId) {
      setError('The selected section could not be resolved.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const data = (await sectionsApi.getSectionGrades(sectionId)) as SectionGrades;
      setSectionData(data);

      const nextGrades = new Map<string, GradeUpdate>();
      data.enrollments.forEach((enrollment) => {
        const finalGrade = enrollment.finalGrade ?? 0;
        nextGrades.set(enrollment.id, {
          enrollmentId: enrollment.id,
          finalGrade,
          letterGrade:
            enrollment.letterGrade ?? calculateGrade(finalGrade),
        });
      });

      setGrades(nextGrades);
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.message ??
          'The grading view could not be loaded.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [sectionId]);

  useEffect(() => {
    if (hasAccess) {
      void fetchSectionGrades();
    }
  }, [fetchSectionGrades, hasAccess]);

  const hasChanges = useMemo(() => {
    if (!sectionData) {
      return false;
    }

    return sectionData.enrollments.some((enrollment) => {
      const current = grades.get(enrollment.id);
      if (!current) {
        return false;
      }

      return (
        current.finalGrade !== (enrollment.finalGrade ?? 0) ||
        current.letterGrade !== (enrollment.letterGrade ?? calculateGrade(enrollment.finalGrade ?? 0))
      );
    });
  }, [grades, sectionData]);

  const allGraded = useMemo(() => {
    if (!sectionData) {
      return false;
    }

    return sectionData.enrollments.every(
      (enrollment) => enrollment.letterGrade !== null || grades.get(enrollment.id),
    );
  }, [grades, sectionData]);

  const handleGradeChange = (
    enrollmentId: string,
    field: 'finalGrade' | 'letterGrade',
    value: number | string,
  ) => {
    setGrades((previous) => {
      const next = new Map(previous);
      const existing = next.get(enrollmentId) ?? {
        enrollmentId,
        finalGrade: 0,
        letterGrade: 'F',
      };

      if (field === 'finalGrade') {
        existing.finalGrade = value as number;
        existing.letterGrade = calculateGrade(existing.finalGrade);
      } else {
        existing.letterGrade = value as string;
      }

      next.set(enrollmentId, existing);
      return next;
    });
  };

  const handleSave = async () => {
    if (!sectionId) {
      return;
    }

    setIsSaving(true);

    try {
      await sectionsApi.updateSectionGrades(sectionId, Array.from(grades.values()));
      toast.success('Grades saved');
      await fetchSectionGrades();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ?? 'Grades could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!sectionId) {
      return;
    }

    const shouldPublish = await confirm({
      title: 'Publish grades',
      message:
        'Publish these grades now? Students will see the published results and this should be treated as a deliberate release step.',
      confirmText: 'Publish grades',
    });

    if (!shouldPublish) {
      return;
    }

    setIsPublishing(true);

    try {
      await sectionsApi.publishSectionGrades(sectionId);
      toast.success('Grades published');
      await fetchSectionGrades();
    } catch (requestError: any) {
      toast.error(
        requestError.response?.data?.message ??
          'Grades could not be published.',
      );
    } finally {
      setIsPublishing(false);
    }
  };

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading grading section" />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={<SectionEyebrow>Lecturer workspace</SectionEyebrow>}
          title="Grade management"
          description="Resolve section-level grading issues before retrying the section view."
          actions={
            <Link href="/dashboard/lecturer/grades">
              <Button
                variant="outline"
                aria-label="Back to grade management"
                title="Back to grade management"
              >
                Back to grade management
              </Button>
            </Link>
          }
        />
        <ErrorState
          title="Grading section unavailable"
          description={error}
          onRetry={() => void fetchSectionGrades()}
        />
      </div>
    );
  }

  if (isLoading || !sectionData) {
    return <LoadingState label="Loading grading section" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Lecturer workspace</SectionEyebrow>}
        title={`${sectionData.courseCode} · Section ${sectionData.sectionNumber}`}
        description={`Capture grades for ${sectionData.courseName}, review student records, and publish only when the section is ready.`}
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/lecturer/grades">
              <Button
                variant="outline"
                aria-label="Back to grade management"
                title="Back to grade management"
              >
                Back to grade management
              </Button>
            </Link>
            <Button
              type="button"
              variant="outline"
              disabled={!hasChanges || isSaving}
              onClick={() => void handleSave()}
            >
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? 'Saving grades' : 'Save grades'}
            </Button>
            <Button
              type="button"
              disabled={!allGraded || isPublishing}
              onClick={() => void handlePublish()}
            >
              <Send className="mr-2 h-4 w-4" />
              {isPublishing ? 'Publishing grades' : 'Publish grades'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card variant="elevated">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <div className="text-sm text-muted-foreground">Students</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                {sectionData.enrollments.length}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card variant="elevated">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <div className="text-sm text-muted-foreground">Graded records</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                {sectionData.enrollments.filter((enrollment) => enrollment.letterGrade).length}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card variant="elevated">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <div className="text-sm text-muted-foreground">Section status</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                {sectionData.status ?? 'OPEN'}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400">
              <FileText className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {!allGraded ? (
        <Card variant="muted">
          <CardContent className="pt-6 text-sm leading-6 text-muted-foreground">
            At least one record still needs a published grade before this section can move into the publish step.
          </CardContent>
        </Card>
      ) : null}

      {sectionData.enrollments.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No enrolled students"
          description="This section does not currently have any student enrollments to grade."
        />
      ) : (
        <Card variant="muted">
          <CardHeader>
            <CardTitle className="text-xl">Student grades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-muted-foreground">
                    <th className="px-2 py-3 font-medium">Student</th>
                    <th className="px-2 py-3 font-medium">Student ID</th>
                    <th className="px-2 py-3 font-medium">Email</th>
                    <th className="px-2 py-3 text-center font-medium">Score</th>
                    <th className="px-2 py-3 text-center font-medium">Grade</th>
                    <th className="px-2 py-3 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sectionData.enrollments.map((enrollment) => {
                    const current =
                      grades.get(enrollment.id) ?? {
                        enrollmentId: enrollment.id,
                        finalGrade: enrollment.finalGrade ?? 0,
                        letterGrade:
                          enrollment.letterGrade ??
                          calculateGrade(enrollment.finalGrade ?? 0),
                      };
                    const isPublished = enrollment.gradeStatus === 'PUBLISHED';

                    return (
                      <tr key={enrollment.id}>
                        <td className="px-2 py-4">
                          <div className="font-medium text-foreground">
                            {enrollment.studentName}
                          </div>
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {enrollment.studentCode}
                        </td>
                        <td className="px-2 py-4 text-muted-foreground">
                          {enrollment.email ?? 'Unavailable'}
                        </td>
                        <td className="px-2 py-4 text-center">
                          <div className="mx-auto max-w-[120px]">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              value={current.finalGrade}
                              onChange={(event) =>
                                handleGradeChange(
                                  enrollment.id,
                                  'finalGrade',
                                  Number(event.target.value) || 0,
                                )
                              }
                              disabled={isPublished}
                              aria-label={`Final score for ${enrollment.studentName}`}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-4 text-center">
                          <div className="mx-auto max-w-[120px]">
                            <select
                              className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background transition-[border-color,box-shadow] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                              value={current.letterGrade}
                              onChange={(event) =>
                                handleGradeChange(
                                  enrollment.id,
                                  'letterGrade',
                                  event.target.value,
                                )
                              }
                              disabled={isPublished}
                              aria-label={`Letter grade for ${enrollment.studentName}`}
                            >
                              {letterGrades.map((grade) => (
                                <option key={grade} value={grade}>
                                  {grade}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-2 py-4 text-right">
                          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            {isPublished ? 'Published' : enrollment.gradeStatus ?? 'Draft'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {confirmationDialog}
    </div>
  );
}
