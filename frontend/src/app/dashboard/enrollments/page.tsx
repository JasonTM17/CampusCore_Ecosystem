'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Calendar, Clock, MapPin, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { enrollmentsApi } from '@/lib/api';
import { Enrollment } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import { useConfirmationDialog } from '@/components/ui/use-confirmation-dialog';
import { toast } from 'sonner';

const statusTone: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  PENDING: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  DROPPED: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  COMPLETED: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
};

function getDayName(day: number) {
  return [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][day] ?? '';
}

export default function EnrollmentsPage() {
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDropping, setIsDropping] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const fetchEnrollments = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await enrollmentsApi.getMyEnrollments();
      setEnrollments(data);
    } catch {
      setError('Your current enrollments could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEnrollments();
  }, [fetchEnrollments]);

  const handleDrop = async (enrollmentId: string, courseLabel: string) => {
    if (!user?.studentId) {
      toast.error('Your student profile is not available in this session.');
      return;
    }

    const shouldContinue = await confirm({
      title: 'Drop course',
      message: `Drop ${courseLabel}? This keeps the action explicit and prevents accidental schedule changes.`,
      confirmText: 'Drop course',
      variant: 'destructive',
    });

    if (!shouldContinue) {
      return;
    }

    setIsDropping(enrollmentId);
    try {
      await enrollmentsApi.drop(enrollmentId);
      toast.success('Course dropped');
      await fetchEnrollments();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'We could not drop this course.');
    } finally {
      setIsDropping(null);
    }
  };

  const confirmedCourses = enrollments.filter(
    (enrollment) => enrollment.status === 'CONFIRMED',
  );
  const pendingCourses = enrollments.filter(
    (enrollment) => enrollment.status === 'PENDING',
  );

  const summaryCards = useMemo(
    () => [
      {
        label: 'Courses in view',
        value: enrollments.length,
        tone: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
      },
      {
        label: 'Confirmed',
        value: confirmedCourses.length,
        tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
      },
      {
        label: 'Pending',
        value: pendingCourses.length,
        tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
      },
    ],
    [confirmedCourses.length, enrollments.length, pendingCourses.length],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Student workspace</SectionEyebrow>}
        title="My courses"
        description="Track section status, review schedules, and make enrollment changes without leaving the shared workspace."
        actions={
          <Link href="/dashboard/register">
            <Button>Browse available sections</Button>
          </Link>
        }
      />

      {error ? (
        <ErrorState
          title="Enrollments unavailable"
          description={error}
          onRetry={() => void fetchEnrollments()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading enrollments" />
      ) : enrollments.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses yet"
          description="Once you enroll in a section, the current schedule and section details will appear here."
          action={
            <Link href="/dashboard/register">
              <Button>Browse available sections</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {summaryCards.map((item) => (
              <Card key={item.label} variant="elevated">
                <CardContent className="flex items-center justify-between gap-4 pt-6">
                  <div>
                    <div className="text-sm text-muted-foreground">{item.label}</div>
                    <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                      {item.value}
                    </div>
                  </div>
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-lg ${item.tone}`}
                  >
                    <BookOpen className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card variant="muted">
            <CardHeader>
              <CardTitle className="text-xl">Enrollment record</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {enrollments.map((enrollment) => {
                const courseCode = enrollment.section?.course?.code ?? 'Course';
                const courseName = enrollment.section?.course?.name ?? 'Unavailable';
                const courseLabel = `${courseCode} ${courseName}`.trim();

                return (
                  <div
                    key={enrollment.id}
                    className="rounded-lg border border-border/70 bg-card px-5 py-5"
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-foreground">
                            {courseCode} - {courseName}
                          </h2>
                          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                            Section {enrollment.section?.sectionNumber}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              statusTone[enrollment.status] ??
                              'bg-secondary text-foreground'
                            }`}
                          >
                            {enrollment.status}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            Enrolled {new Date(enrollment.enrolledAt).toLocaleDateString()}
                          </span>
                          <span>{enrollment.section?.course?.credits} credits</span>
                          {enrollment.section?.lecturer ? (
                            <span>
                              {enrollment.section.lecturer.user?.firstName}{' '}
                              {enrollment.section.lecturer.user?.lastName}
                            </span>
                          ) : null}
                          {enrollment.section?.classroom ? (
                            <span className="inline-flex items-center gap-2">
                              <MapPin className="h-4 w-4" />
                              {enrollment.section.classroom.building}{' '}
                              {enrollment.section.classroom.roomNumber}
                            </span>
                          ) : null}
                        </div>

                        {enrollment.section?.schedules?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {enrollment.section.schedules.map((schedule, index) => (
                              <span
                                key={`${enrollment.id}-${index}`}
                                className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-foreground"
                              >
                                <Clock className="h-3.5 w-3.5" />
                                {getDayName(schedule.dayOfWeek)} {schedule.startTime}-
                                {schedule.endTime}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {enrollment.status !== 'DROPPED' &&
                      enrollment.status !== 'COMPLETED' ? (
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => void handleDrop(enrollment.id, courseLabel)}
                          disabled={isDropping === enrollment.id}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {isDropping === enrollment.id ? 'Dropping course' : 'Drop course'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      {confirmationDialog}
    </div>
  );
}
