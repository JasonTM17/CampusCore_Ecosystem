'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, BookMarked, BookOpen, Calendar, ClipboardList, CreditCard, FileText, GraduationCap, TrendingUp } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { enrollmentsApi, semestersApi } from '@/lib/api';
import { pickPreferredSemesterId } from '@/lib/semesters';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-block';
import {
  WorkspaceActionTile,
  WorkspaceMetricCard,
  WorkspacePanel,
} from '@/components/dashboard/WorkspaceSurface';

interface Enrollment {
  id: string;
  status: string;
  section?: {
    course?: {
      code: string;
      name: string;
    };
    sectionNumber: string;
  };
}

interface Semester {
  id: string;
  name: string;
  status: string;
}

const quickActions = [
  {
    href: '/dashboard/register',
    icon: ClipboardList,
    label: 'Register courses',
    description: 'Browse available sections and make enrollment decisions.',
    tone: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  },
  {
    href: '/dashboard/schedule',
    icon: Calendar,
    label: 'Open schedule',
    description: 'Check what is on the calendar this week.',
    tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  },
  {
    href: '/dashboard/grades',
    icon: TrendingUp,
    label: 'Review grades',
    description: 'See published results and academic standing.',
    tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  },
  {
    href: '/dashboard/invoices',
    icon: CreditCard,
    label: 'Check invoices',
    description: 'Keep track of outstanding balances and payment status.',
    tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  },
];

const portalLinks = [
  {
    href: '/dashboard/enrollments',
    icon: BookOpen,
    label: 'My courses',
    description: 'Current registrations, section details, and status.',
    tone: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-400',
  },
  {
    href: '/dashboard/transcript',
    icon: FileText,
    label: 'Transcript',
    description: 'Semester history and cumulative academic outcomes.',
    tone: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400',
  },
  {
    href: '/dashboard/announcements',
    icon: Bell,
    label: 'Announcements',
    description: 'Shared updates from the university and course teams.',
    tone: 'bg-pink-500/12 text-pink-600 dark:text-pink-400',
  },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [currentSemester, setCurrentSemester] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const semestersRes = await semestersApi.getAll();
      setSemesters(semestersRes.data);

      const preferredSemesterId = pickPreferredSemesterId(semestersRes.data);
      if (preferredSemesterId) {
        setCurrentSemester(preferredSemesterId);
        const enrollmentData = await enrollmentsApi.getMyEnrollments(preferredSemesterId);
        setEnrollments(enrollmentData);
      } else {
        setEnrollments([]);
      }
    } catch {
      setError('Your dashboard data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const currentSemesterName = useMemo(() => {
    return semesters.find((semester) => semester.id === currentSemester)?.name || 'No active term';
  }, [currentSemester, semesters]);

  const confirmedCourses = enrollments.filter(
    (enrollment) => enrollment.status === 'CONFIRMED',
  );
  const pendingCourses = enrollments.filter(
    (enrollment) => enrollment.status === 'PENDING',
  );
  const highlightedCourses = confirmedCourses.slice(0, 3);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Student workspace</SectionEyebrow>}
        title={`Welcome back, ${user?.firstName ?? 'student'}`}
        description={`The current term is ${currentSemesterName}. Move between registration, coursework, billing, and profile updates without leaving the student shell.`}
        actions={
          <div className="inline-flex rounded-full border border-border/70 bg-secondary/35 px-3.5 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {new Intl.DateTimeFormat('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            }).format(new Date())}
          </div>
        }
      />

      {error ? (
        <ErrorState
          title="Dashboard unavailable"
          description={error}
          onRetry={() => void fetchData()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading dashboard" />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <WorkspaceMetricCard
              label="Courses in scope"
              value={enrollments.length.toLocaleString()}
              icon={<BookOpen className="h-5 w-5" />}
              detail="Registration, section context, and current coursework remain visible from the same student shell."
              toneClassName="bg-blue-500/12 text-blue-600 dark:text-blue-400"
            />
            <WorkspaceMetricCard
              label="Confirmed enrollments"
              value={confirmedCourses.length.toLocaleString()}
              icon={<GraduationCap className="h-5 w-5" />}
              detail="Confirmed sections stay close so you can move into schedules, grades, and transcript work without losing context."
              toneClassName="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
            />
            <WorkspaceMetricCard
              label="Pending decisions"
              value={pendingCourses.length.toLocaleString()}
              icon={<ClipboardList className="h-5 w-5" />}
              detail="Anything that still needs attention stays visible before it turns into a registration surprise."
              toneClassName="bg-amber-500/12 text-amber-600 dark:text-amber-400"
            />
            <WorkspaceMetricCard
              label="Current semester"
              value={currentSemesterName}
              icon={<Calendar className="h-5 w-5" />}
              detail="The dashboard keeps one active academic context so the rest of the student tools stay aligned."
              toneClassName="bg-violet-500/12 text-violet-600 dark:text-violet-400"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <WorkspacePanel
              title="Next actions"
              description="Open the student tools that usually need attention first during the current term."
              variant="muted"
              contentClassName="grid gap-4 sm:grid-cols-2"
            >
                {quickActions.map((action) => (
                  <WorkspaceActionTile
                    key={action.href}
                    href={action.href}
                    icon={<action.icon className="h-5 w-5" />}
                    title={action.label}
                    description={action.description}
                    toneClassName={action.tone}
                    ctaLabel="Open tool"
                  />
                ))}
            </WorkspacePanel>

            <WorkspacePanel
              title="Current courses"
              description="Confirmed enrollments stay visible here so you can check course context before moving deeper into the workspace."
              variant="muted"
            >
                {highlightedCourses.length === 0 ? (
                  <EmptyState
                    icon={BookMarked}
                    title="No confirmed courses yet"
                    description="Once enrollment is confirmed, your current courses will appear here."
                    action={
                      <Link href="/dashboard/register">
                        <Button>Browse sections</Button>
                      </Link>
                    }
                    className="min-h-[280px] border-none bg-transparent px-0 py-0"
                  />
                ) : (
                  <div className="space-y-3">
                    {highlightedCourses.map((enrollment) => (
                      <div
                        key={enrollment.id}
                        className="flex items-center gap-4 rounded-lg border border-border/70 bg-card px-4 py-4"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-foreground">
                          <BookMarked className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">
                            {enrollment.section?.course?.code} - {enrollment.section?.course?.name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Section {enrollment.section?.sectionNumber}
                          </div>
                        </div>
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                          {enrollment.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
            </WorkspacePanel>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <WorkspacePanel
              title="Reference links"
              description="Keep the supporting student views close without leaving the same session-backed shell."
              contentClassName="grid gap-4 md:grid-cols-3"
            >
                {portalLinks.map((item) => (
                  <WorkspaceActionTile
                    key={item.href}
                    href={item.href}
                    icon={<item.icon className="h-5 w-5" />}
                    title={item.label}
                    description={item.description}
                    toneClassName={item.tone}
                    ctaLabel="Open view"
                    className="bg-secondary/35 hover:bg-secondary/60"
                  />
                ))}
            </WorkspacePanel>

            <WorkspacePanel
              title="Current status"
              description="A quick read on the active academic context and any follow-up that still needs attention."
              contentClassName="space-y-4"
            >
                <div className="rounded-lg border border-border/70 bg-secondary/30 px-4 py-4">
                  <div className="text-sm font-semibold text-foreground">
                    Semester selection
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {currentSemester
                      ? `The dashboard is using ${currentSemesterName} for the current academic context.`
                      : 'No preferred semester is active yet.'}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/30 px-4 py-4">
                  <div className="text-sm font-semibold text-foreground">
                    Enrollment health
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {pendingCourses.length > 0
                      ? `${pendingCourses.length} registration item(s) still need attention.`
                      : 'No pending registration issues are blocking the current view.'}
                  </p>
                </div>
                <Link href="/dashboard/profile">
                  <Button variant="outline" className="w-full">
                    Review profile settings
                  </Button>
                </Link>
            </WorkspacePanel>
          </div>
        </>
      )}
    </div>
  );
}
