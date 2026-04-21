'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { enrollmentsApi, semestersApi } from '@/lib/api';
import { pickPreferredSemesterId } from '@/lib/semesters';
import { Enrollment, Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';

type DayAgendaItem = {
  id: string;
  courseCode: string;
  courseName: string;
  sectionNumber: string;
  startTime: string;
  endTime: string;
  dayOfWeek: number;
  building?: string;
  roomNumber?: string;
};

const dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export default function SchedulePage() {
  const { hasAccess, isLoading: authLoading } = useRequireAuth(['STUDENT']);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSemesters = useCallback(async () => {
    const response = await semestersApi.getAll();
    setSemesters(response.data ?? []);
    const preferredSemesterId = pickPreferredSemesterId(response.data);
    if (preferredSemesterId) {
      setSelectedSemester((current) => current || preferredSemesterId);
    }
  }, []);

  const fetchEnrollments = useCallback(
    async (semesterId?: string) => {
      const response = await enrollmentsApi.getMyEnrollments(semesterId);
      setEnrollments(response);
    },
    [],
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      await fetchSemesters();
    } catch {
      setError('Schedule filters could not be loaded.');
      setIsLoading(false);
    }
  }, [fetchSemesters]);

  useEffect(() => {
    if (hasAccess) {
      void loadData();
    }
  }, [hasAccess, loadData]);

  useEffect(() => {
    if (!hasAccess) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setError('');

      try {
        await fetchEnrollments(selectedSemester || undefined);
      } catch {
        if (!cancelled) {
          setError('Schedule data could not be loaded.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [fetchEnrollments, hasAccess, selectedSemester]);

  const agenda = useMemo(() => {
    const items: DayAgendaItem[] = [];

    enrollments
      .filter(
        (enrollment) =>
          enrollment.status === 'CONFIRMED' || enrollment.status === 'PENDING',
      )
      .forEach((enrollment) => {
        const section = enrollment.section;
        section?.schedules?.forEach((schedule, index) => {
          items.push({
            id: `${enrollment.id}-${index}`,
            courseCode: section.course?.code ?? 'Course',
            courseName: section.course?.name ?? 'Unavailable',
            sectionNumber: section.sectionNumber,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            dayOfWeek: schedule.dayOfWeek,
            building: schedule.classroom?.building,
            roomNumber: schedule.classroom?.roomNumber,
          });
        });
      });

    return items.sort((left, right) => {
      if (left.dayOfWeek !== right.dayOfWeek) {
        return left.dayOfWeek - right.dayOfWeek;
      }
      return left.startTime.localeCompare(right.startTime);
    });
  }, [enrollments]);

  const agendaByDay = useMemo(() => {
    return agenda.reduce<Record<number, DayAgendaItem[]>>((groups, item) => {
      if (!groups[item.dayOfWeek]) {
        groups[item.dayOfWeek] = [];
      }

      groups[item.dayOfWeek].push(item);
      return groups;
    }, {});
  }, [agenda]);

  const selectedSemesterName = useMemo(() => {
    return (
      semesters.find((semester) => semester.id === selectedSemester)?.name ??
      'all terms'
    );
  }, [selectedSemester, semesters]);

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading schedule" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Student workspace</SectionEyebrow>}
        title="Schedule"
        description={`Keep the weekly class agenda for ${selectedSemesterName} visible while the rest of the student workspace stays one click away.`}
        actions={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-[220px]">
              <Select
                aria-label="Select semester for schedule"
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
            <Link href="/dashboard/enrollments">
              <Button variant="outline">Open my courses</Button>
            </Link>
          </div>
        }
      />

      {error ? (
        <ErrorState
          title="Schedule unavailable"
          description={error}
          onRetry={() => void loadData()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading schedule" />
      ) : agenda.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No scheduled classes yet"
          description="Once sections are confirmed, their class meetings will appear here in a weekly agenda."
          action={
            <Link href="/dashboard/register">
              <Button>Browse sections</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Weekly meetings</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {agenda.length}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
                  <Calendar className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Courses in rotation</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {
                      new Set(
                        agenda.map((item) => `${item.courseCode}-${item.sectionNumber}`),
                      ).size
                    }
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <Clock className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Teaching spaces</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {new Set(
                      agenda
                        .map((item) =>
                          item.building && item.roomNumber
                            ? `${item.building}-${item.roomNumber}`
                            : null,
                        )
                        .filter(Boolean),
                    ).size}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400">
                  <MapPin className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card variant="muted">
              <CardHeader>
                <CardTitle className="text-xl">Weekly agenda</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {dayNames.slice(1, 6).map((dayName, index) => {
                  const dayOfWeek = index + 1;
                  const items = agendaByDay[dayOfWeek] ?? [];

                  return (
                    <div
                      key={dayName}
                      className="rounded-lg border border-border/70 bg-card px-4 py-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="font-semibold text-foreground">{dayName}</h2>
                        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {items.length} item{items.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      {items.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No scheduled meetings.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {items.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3"
                            >
                              <div className="font-medium text-foreground">
                                {item.courseCode} - {item.courseName}
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                Section {item.sectionNumber}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                                <span className="inline-flex items-center gap-2">
                                  <Clock className="h-4 w-4" />
                                  {item.startTime} - {item.endTime}
                                </span>
                                {item.building && item.roomNumber ? (
                                  <span className="inline-flex items-center gap-2">
                                    <MapPin className="h-4 w-4" />
                                    {item.building} {item.roomNumber}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card variant="elevated">
              <CardHeader>
                <CardTitle className="text-xl">Upcoming class list</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {agenda.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border/70 bg-card px-4 py-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-foreground">
                          {item.courseCode} - {item.courseName}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {dayNames[item.dayOfWeek]} - Section {item.sectionNumber}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground sm:text-right">
                        <div>
                          {item.startTime} - {item.endTime}
                        </div>
                        <div>
                          {item.building && item.roomNumber
                            ? `${item.building} ${item.roomNumber}`
                            : 'Room information pending'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
