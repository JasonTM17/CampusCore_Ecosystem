'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, MapPin, Users } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { sectionsApi, semestersApi } from '@/lib/api';
import { LecturerSection, Semester } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';

type TeachingSlot = {
  id: string;
  courseCode: string;
  courseName: string;
  sectionNumber: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  building: string;
  roomNumber: string;
  enrolledCount: number;
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

export default function LecturerSchedulePage() {
  const { hasAccess, isLoading: authLoading } = useRequireAuth(['LECTURER']);
  const [sections, setSections] = useState<LecturerSection[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSemesters = useCallback(async () => {
    const response = await semestersApi.getAll();
    setSemesters(response.data ?? []);
  }, []);

  const fetchSchedule = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await sectionsApi.getMySchedule(selectedSemester || undefined);
      setSections(data);
    } catch {
      setError('Teaching assignments could not be loaded.');
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
      void fetchSchedule();
    }
  }, [fetchSchedule, hasAccess]);

  const slots = useMemo(() => {
    return sections
      .flatMap((section) =>
        section.schedules.map((schedule, index) => ({
          id: `${section.id}-${index}`,
          courseCode: section.courseCode,
          courseName: section.courseName,
          sectionNumber: section.sectionNumber,
          dayOfWeek: schedule.dayOfWeek,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          building: schedule.building,
          roomNumber: schedule.roomNumber,
          enrolledCount: section.enrolledCount,
        })),
      )
      .sort((left, right) => {
        if (left.dayOfWeek !== right.dayOfWeek) {
          return left.dayOfWeek - right.dayOfWeek;
        }
        return left.startTime.localeCompare(right.startTime);
      });
  }, [sections]);

  const slotsByDay = useMemo(() => {
    return slots.reduce<Record<number, TeachingSlot[]>>((groups, slot) => {
      if (!groups[slot.dayOfWeek]) {
        groups[slot.dayOfWeek] = [];
      }

      groups[slot.dayOfWeek].push(slot);
      return groups;
    }, {});
  }, [slots]);

  const selectedSemesterName = useMemo(() => {
    return (
      semesters.find((semester) => semester.id === selectedSemester)?.name ??
      'all semesters'
    );
  }, [selectedSemester, semesters]);

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading teaching schedule" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Lecturer workspace</SectionEyebrow>}
        title="Teaching schedule"
        description={`Keep your timetable for ${selectedSemesterName} visible while grading and section operations stay one click away.`}
        actions={
          <div className="min-w-[220px]">
            <Select
              aria-label="Select semester for teaching schedule"
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
        }
      />

      {error ? (
        <ErrorState
          title="Teaching schedule unavailable"
          description={error}
          onRetry={() => void fetchSchedule()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading teaching schedule" />
      ) : slots.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No teaching assignments yet"
          description="Sections with active classroom schedules will appear here once they are assigned."
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Teaching slots</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {slots.length}
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
                  <div className="text-sm text-muted-foreground">Assigned sections</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {sections.length}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <Users className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <div className="text-sm text-muted-foreground">Students in scope</div>
                  <div className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {sections.reduce((sum, section) => sum + section.enrolledCount, 0)}
                  </div>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400">
                  <Users className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Card variant="muted">
              <CardHeader>
                <CardTitle className="text-xl">Weekly agenda</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {dayNames.slice(1, 6).map((dayName, index) => {
                  const dayOfWeek = index + 1;
                  const items = slotsByDay[dayOfWeek] ?? [];

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
                          No teaching slot scheduled.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {items.map((slot) => (
                            <div
                              key={slot.id}
                              className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3"
                            >
                              <div className="font-medium text-foreground">
                                {slot.courseCode} - {slot.courseName}
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                Section {slot.sectionNumber}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                                <span className="inline-flex items-center gap-2">
                                  <Clock className="h-4 w-4" />
                                  {slot.startTime} - {slot.endTime}
                                </span>
                                <span className="inline-flex items-center gap-2">
                                  <MapPin className="h-4 w-4" />
                                  {slot.building} {slot.roomNumber}
                                </span>
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
                <CardTitle className="text-xl">Assigned sections</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {sections.map((section) => (
                  <div
                    key={section.id}
                    className="rounded-lg border border-border/70 bg-card px-4 py-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-foreground">
                          {section.courseCode} - {section.courseName}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Section {section.sectionNumber} - {section.departmentName}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground sm:text-right">
                        <div>{section.enrolledCount}/{section.capacity} students</div>
                        <div className="mt-1">
                          {section.status}
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
