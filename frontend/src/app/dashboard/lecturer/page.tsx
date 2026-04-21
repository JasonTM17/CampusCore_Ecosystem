'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Calendar, FileText, Users } from 'lucide-react';
import { useRequireAuth } from '@/context/AuthContext';
import { announcementsApi, sectionsApi } from '@/lib/api';
import { GradingSection, LecturerSection } from '@/types/api';
import { PageHeader, SectionEyebrow } from '@/components/ui/page-header';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/state-block';
import {
  WorkspaceActionTile,
  WorkspaceMetricCard,
  WorkspacePanel,
} from '@/components/dashboard/WorkspaceSurface';

type LecturerAnnouncement = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  priority: string;
};

const quickLinks = [
  {
    href: '/dashboard/lecturer/schedule',
    title: 'Teaching schedule',
    description: 'Check rooms, sections, and meeting times for the current term.',
    icon: Calendar,
    tone: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  },
  {
    href: '/dashboard/lecturer/grades',
    title: 'Grade management',
    description: 'Finish grading queues and move publish-ready sections forward.',
    icon: FileText,
    tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  },
  {
    href: '/dashboard/lecturer/announcements',
    title: 'Announcements',
    description: 'Review broadcast updates that affect your sections and teaching day.',
    icon: Bell,
    tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  },
];

export default function LecturerDashboardPage() {
  const { user, hasAccess, isLoading: authLoading } = useRequireAuth([
    'LECTURER',
  ]);
  const [scheduleSections, setScheduleSections] = useState<LecturerSection[]>([]);
  const [gradingSections, setGradingSections] = useState<GradingSection[]>([]);
  const [announcements, setAnnouncements] = useState<LecturerAnnouncement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const [scheduleData, gradingData, announcementsData] = await Promise.all([
        sectionsApi.getMySchedule(),
        sectionsApi.getMyGradingSections(),
        announcementsApi.getMy({ page: 1, limit: 5 }),
      ]);

      setScheduleSections(scheduleData);
      setGradingSections(gradingData);
      setAnnouncements(announcementsData.data ?? []);
    } catch {
      setError('The lecturer dashboard could not load its operational data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAccess) {
      void fetchData();
    }
  }, [fetchData, hasAccess]);

  const totalStudents = useMemo(() => {
    return scheduleSections.reduce(
      (sum, section) => sum + (section.enrolledCount ?? 0),
      0,
    );
  }, [scheduleSections]);

  const readyToPublish = useMemo(() => {
    return gradingSections.filter((section) => section.canPublish).length;
  }, [gradingSections]);

  if (authLoading || !hasAccess) {
    return <LoadingState label="Loading lecturer dashboard" />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<SectionEyebrow>Lecturer workspace</SectionEyebrow>}
        title={`Welcome back, ${user?.firstName ?? 'lecturer'}`}
        description="Keep section operations, grading queues, and teaching updates in one lecturer-focused shell."
      />

      {error ? (
        <ErrorState
          title="Lecturer dashboard unavailable"
          description={error}
          onRetry={() => void fetchData()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading lecturer dashboard" />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <WorkspaceMetricCard
              label="Sections"
              value={scheduleSections.length.toLocaleString()}
              icon={<Calendar className="h-5 w-5" />}
              detail="Assigned teaching sections stay visible so grading and scheduling decisions remain grounded in the same term context."
              toneClassName="bg-blue-500/12 text-blue-600 dark:text-blue-400"
            />
            <WorkspaceMetricCard
              label="Students"
              value={totalStudents.toLocaleString()}
              icon={<Users className="h-5 w-5" />}
              detail="Enrollment volume stays close to the lecturer shell so section-level follow-up remains visible."
              toneClassName="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
            />
            <WorkspaceMetricCard
              label="Ready to publish"
              value={readyToPublish.toLocaleString()}
              icon={<FileText className="h-5 w-5" />}
              detail="Publish-ready grading work surfaces early so final review does not get lost behind the rest of the workflow."
              toneClassName="bg-violet-500/12 text-violet-600 dark:text-violet-400"
            />
            <WorkspaceMetricCard
              label="Fresh notices"
              value={announcements.length.toLocaleString()}
              icon={<Bell className="h-5 w-5" />}
              detail="Broadcast updates that affect teaching operations remain visible without pulling attention away from the grading queue."
              toneClassName="bg-amber-500/12 text-amber-600 dark:text-amber-400"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <WorkspacePanel
              title="Quick actions"
              description="Open the lecturer tools that usually drive the next teaching action."
              variant="muted"
              contentClassName="grid gap-4 sm:grid-cols-3"
            >
                {quickLinks.map((item) => (
                  <WorkspaceActionTile
                    key={item.href}
                    href={item.href}
                    icon={<item.icon className="h-5 w-5" />}
                    title={item.title}
                    description={item.description}
                    toneClassName={item.tone}
                    ctaLabel="Open tool"
                  />
                ))}
            </WorkspacePanel>

            <WorkspacePanel
              title="Grading queue"
              description="Sections nearest to final review stay visible here so grading work remains the primary next step."
              contentClassName="space-y-3"
            >
                {gradingSections.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No grading assignments"
                    description="Teaching sections with grading responsibility will appear here once they are active."
                    className="min-h-[240px] border-none bg-transparent px-0 py-0"
                  />
                ) : (
                  gradingSections.slice(0, 4).map((section) => (
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
                            Section {section.sectionNumber} - {section.semester}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground sm:text-right">
                          <div>{section.gradedCount}/{section.enrolledCount} graded</div>
                          <div className="mt-1">
                            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                              {section.canPublish ? 'Ready to publish' : 'In progress'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
            </WorkspacePanel>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <WorkspacePanel
              title="Sections in scope"
              description="Assigned sections stay visible with capacity and department context before you move into schedule or grading detail."
              contentClassName="space-y-3"
            >
                {scheduleSections.length === 0 ? (
                  <EmptyState
                    icon={Calendar}
                    title="No teaching assignments yet"
                    description="Assigned sections will appear here as soon as the current term is configured."
                    className="min-h-[240px] border-none bg-transparent px-0 py-0"
                  />
                ) : (
                  scheduleSections.slice(0, 5).map((section) => (
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
                          <div className="mt-1">{section.status}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
            </WorkspacePanel>

            <WorkspacePanel
              title="Latest announcements"
              description="Broadcast updates that affect teaching operations surface here without taking the page away from the current workload."
              variant="muted"
              contentClassName="space-y-3"
            >
                {announcements.length === 0 ? (
                  <EmptyState
                    icon={Bell}
                    title="No new notices"
                    description="Shared notices for the lecturer workspace will show up here once they are published."
                    className="min-h-[240px] border-none bg-transparent px-0 py-0"
                  />
                ) : (
                  announcements.map((announcement) => (
                    <div
                      key={announcement.id}
                      className="rounded-lg border border-border/70 bg-card px-4 py-4"
                    >
                      <div className="font-medium text-foreground">
                        {announcement.title}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {announcement.content}
                      </p>
                      <div className="mt-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {new Date(announcement.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
            </WorkspacePanel>
          </div>
        </>
      )}
    </div>
  );
}
