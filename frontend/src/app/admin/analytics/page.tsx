'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, BookOpen, Building2, GraduationCap, MapPin, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import {
  AdminMetricCard,
  AdminTableCard,
  AdminTableScroll,
} from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/state-block';
import { useI18n } from '@/i18n';

interface AnalyticsOverview {
  totalStudents: number;
  totalLecturers: number;
  totalCourses: number;
  totalSections: number;
  totalEnrollments: number;
  totalDepartments: number;
  totalFaculties: number;
  totalAcademicYears: number;
  totalSemesters: number;
  totalClassrooms: number;
}

interface SemesterEnrollment {
  semesterId: string;
  semesterName: string;
  academicYear: number;
  enrollmentCount: number;
}

interface SectionOccupancy {
  sectionId: string;
  sectionNumber: string;
  courseCode: string;
  courseName: string;
  semesterName: string;
  capacity: number;
  enrolledCount: number;
  occupancyRate: number;
}

interface GradeDistribution {
  grade: string;
  count: number;
  percentage: number;
}

interface EnrollmentTrend {
  month: string;
  enrolled: number;
  dropped: number;
  completed: number;
}

const gradeColors: Record<string, string> = {
  A: 'bg-emerald-500',
  'A-': 'bg-emerald-400',
  'B+': 'bg-blue-500',
  B: 'bg-blue-400',
  'B-': 'bg-blue-300',
  'C+': 'bg-amber-500',
  C: 'bg-amber-400',
  'C-': 'bg-amber-300',
  'D+': 'bg-orange-500',
  D: 'bg-orange-400',
  'D-': 'bg-orange-300',
  F: 'bg-red-500',
};

export default function AdminAnalyticsPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const { formatNumber, href, messages } = useI18n();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [enrollmentsBySemester, setEnrollmentsBySemester] = useState<SemesterEnrollment[]>([]);
  const [sectionOccupancy, setSectionOccupancy] = useState<SectionOccupancy[]>([]);
  const [gradeDistribution, setGradeDistribution] = useState<GradeDistribution[]>([]);
  const [enrollmentTrends, setEnrollmentTrends] = useState<EnrollmentTrend[]>([]);
  const canAccess = Boolean(user && (isAdmin || isSuperAdmin));

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push(href('/dashboard'));
    }
  }, [href, user, isAdmin, isSuperAdmin, router]);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [overviewData, semesterData, occupancyData, gradeData, trendsData] =
        await Promise.all([
          analyticsApi.getOverview(),
          analyticsApi.getEnrollmentsBySemester(),
          analyticsApi.getSectionOccupancy(),
          analyticsApi.getGradeDistribution(),
          analyticsApi.getEnrollmentTrends(),
        ]);

      setOverview(overviewData);
      setEnrollmentsBySemester(semesterData);
      setSectionOccupancy(occupancyData);
      setGradeDistribution(gradeData);
      setEnrollmentTrends(trendsData);
    } catch {
      setError(messages.adminAnalytics.unavailableDescription);
    } finally {
      setIsLoading(false);
    }
  }, [messages.adminAnalytics.unavailableDescription]);

  useEffect(() => {
    if (canAccess) {
      void fetchAnalytics();
    }
  }, [canAccess, fetchAnalytics]);

  if (!canAccess) {
    return <LoadingState label={messages.adminAnalytics.loading} className="m-8" />;
  }

  const stats = [
    { label: messages.adminAnalytics.stats[0], value: overview?.totalStudents || 0, detail: messages.adminAnalytics.statDetails[0], icon: Users, tone: 'bg-blue-500/12 text-blue-600 dark:text-blue-400' },
    { label: messages.adminAnalytics.stats[1], value: overview?.totalLecturers || 0, detail: messages.adminAnalytics.statDetails[1], icon: GraduationCap, tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-400' },
    { label: messages.adminAnalytics.stats[2], value: overview?.totalCourses || 0, detail: messages.adminAnalytics.statDetails[2], icon: BookOpen, tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' },
    { label: messages.adminAnalytics.stats[3], value: overview?.totalSections || 0, detail: messages.adminAnalytics.statDetails[3], icon: BarChart3, tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400' },
    { label: messages.adminAnalytics.stats[4], value: overview?.totalEnrollments || 0, detail: messages.adminAnalytics.statDetails[4], icon: TrendingUp, tone: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-400' },
    { label: messages.adminAnalytics.stats[5], value: overview?.totalDepartments || 0, detail: messages.adminAnalytics.statDetails[5], icon: Building2, tone: 'bg-pink-500/12 text-pink-600 dark:text-pink-400' },
    { label: messages.adminAnalytics.stats[6], value: overview?.totalFaculties || 0, detail: messages.adminAnalytics.statDetails[6], icon: Building2, tone: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400' },
    { label: messages.adminAnalytics.stats[7], value: overview?.totalClassrooms || 0, detail: messages.adminAnalytics.statDetails[7], icon: MapPin, tone: 'bg-teal-500/12 text-teal-600 dark:text-teal-400' },
  ];

  const maxEnrollment = Math.max(...enrollmentsBySemester.map((semester) => semester.enrollmentCount), 1);

  return (
    <AdminFrame
      title={messages.adminAnalytics.title}
      description={messages.adminAnalytics.description}
      backHref="/admin"
      backLabel={messages.adminShell.backToDashboard}
      actions={
        <Button type="button" variant="outline" onClick={() => void fetchAnalytics()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {messages.adminAnalytics.refreshData}
        </Button>
      }
    >
      {error ? (
        <ErrorState
          title={messages.adminAnalytics.unavailableTitle}
          description={error || messages.adminAnalytics.unavailableDescription}
          onRetry={() => void fetchAnalytics()}
        />
      ) : isLoading && !overview ? (
        <LoadingState label={messages.adminAnalytics.loading} />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <AdminMetricCard
                key={stat.label}
                label={stat.label}
                value={formatNumber(stat.value)}
                icon={<stat.icon className="h-5 w-5" />}
                detail={stat.detail}
                toneClassName={stat.tone}
                compact
              />
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <AdminTableCard
              title={messages.adminAnalytics.panels.enrollmentsBySemester.title}
              description={messages.adminAnalytics.panels.enrollmentsBySemester.description}
              className="h-full"
            >
                {enrollmentsBySemester.length === 0 ? (
                  <EmptyState
                    title={messages.adminAnalytics.panels.enrollmentsBySemester.emptyTitle}
                    description={messages.adminAnalytics.panels.enrollmentsBySemester.emptyDescription}
                    className="min-h-[240px] border-none bg-transparent px-0 py-0"
                  />
                ) : (
                  <div className="space-y-4">
                    {enrollmentsBySemester.map((semester) => (
                      <div key={semester.semesterId} className="space-y-2">
                        <div className="flex items-center justify-between gap-4 text-sm">
                          <div className="font-medium text-foreground">
                            {semester.semesterName}
                          </div>
                          <div className="text-muted-foreground">
                            {semester.enrollmentCount} {messages.adminAnalytics.tableHeaders.students}
                          </div>
                        </div>
                        <div className="h-2.5 rounded-full bg-secondary">
                          <div
                            className="h-2.5 rounded-full bg-primary transition-[width]"
                            style={{
                              width: `${(semester.enrollmentCount / maxEnrollment) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </AdminTableCard>

            <AdminTableCard
              title={messages.adminAnalytics.panels.gradeDistribution.title}
              description={messages.adminAnalytics.panels.gradeDistribution.description}
              className="h-full"
            >
                {gradeDistribution.length === 0 ||
                gradeDistribution.every((grade) => grade.count === 0) ? (
                  <EmptyState
                    title={messages.adminAnalytics.panels.gradeDistribution.emptyTitle}
                    description={messages.adminAnalytics.panels.gradeDistribution.emptyDescription}
                    className="min-h-[240px] border-none bg-transparent px-0 py-0"
                  />
                ) : (
                  <div className="space-y-3">
                    {gradeDistribution.map((grade) => (
                      <div key={grade.grade} className="grid grid-cols-[40px_1fr_auto] items-center gap-3">
                        <span className="text-sm font-medium text-foreground">
                          {grade.grade}
                        </span>
                        <div className="h-3 rounded-full bg-secondary">
                          <div
                            className={`h-3 rounded-full ${gradeColors[grade.grade] || 'bg-muted'}`}
                            style={{ width: `${grade.percentage}%` }}
                          />
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {grade.count} ({grade.percentage}%)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
            </AdminTableCard>
          </div>

          <AdminTableCard
            title={messages.adminAnalytics.panels.sectionOccupancy.title}
            description={messages.adminAnalytics.panels.sectionOccupancy.description}
          >
              {sectionOccupancy.length === 0 ? (
                <EmptyState
                  title={messages.adminAnalytics.panels.sectionOccupancy.emptyTitle}
                  description={messages.adminAnalytics.panels.sectionOccupancy.emptyDescription}
                  className="min-h-[240px] border-none bg-transparent px-0 py-0"
                />
              ) : (
                <AdminTableScroll>
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="border-b border-border/70 text-left text-muted-foreground">
                        <th className="px-2 py-3 font-medium">{messages.adminAnalytics.tableHeaders.course}</th>
                        <th className="px-2 py-3 font-medium">{messages.adminAnalytics.tableHeaders.section}</th>
                        <th className="px-2 py-3 font-medium">{messages.adminAnalytics.tableHeaders.semester}</th>
                        <th className="px-2 py-3 text-right font-medium">{messages.adminAnalytics.tableHeaders.capacity}</th>
                        <th className="px-2 py-3 text-right font-medium">{messages.adminAnalytics.tableHeaders.enrolled}</th>
                        <th className="px-2 py-3 text-right font-medium">{messages.adminAnalytics.tableHeaders.occupancy}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {sectionOccupancy.slice(0, 10).map((section) => (
                        <tr key={section.sectionId}>
                          <td className="px-2 py-3">
                            <div className="font-medium text-foreground">
                              {section.courseCode}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {section.courseName}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-foreground">
                            {section.sectionNumber}
                          </td>
                          <td className="px-2 py-3 text-muted-foreground">
                            {section.semesterName}
                          </td>
                          <td className="px-2 py-3 text-right text-foreground">
                            {section.capacity}
                          </td>
                          <td className="px-2 py-3 text-right text-foreground">
                            {section.enrolledCount}
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex items-center justify-end gap-3">
                              <div className="h-2.5 w-24 rounded-full bg-secondary">
                                <div
                                  className={`h-2.5 rounded-full ${
                                    section.occupancyRate >= 90
                                      ? 'bg-red-500'
                                      : section.occupancyRate >= 70
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                  }`}
                                  style={{
                                    width: `${Math.min(section.occupancyRate, 100)}%`,
                                  }}
                                />
                              </div>
                              <span className="w-12 text-right text-xs font-medium text-foreground">
                                {section.occupancyRate}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableScroll>
              )}
          </AdminTableCard>

          <AdminTableCard
            title={messages.adminAnalytics.panels.enrollmentTrends.title}
            description={messages.adminAnalytics.panels.enrollmentTrends.description}
          >
              {enrollmentTrends.length === 0 ? (
                <EmptyState
                  title={messages.adminAnalytics.panels.enrollmentTrends.emptyTitle}
                  description={messages.adminAnalytics.panels.enrollmentTrends.emptyDescription}
                  className="min-h-[220px] border-none bg-transparent px-0 py-0"
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {enrollmentTrends.map((trend) => (
                    <div
                      key={trend.month}
                      className="rounded-lg border border-border/70 bg-card px-4 py-4"
                    >
                      <div className="text-sm font-semibold text-foreground">
                        {trend.month}
                      </div>
                      <div className="mt-4 space-y-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{messages.adminAnalytics.tableHeaders.grades.enrolled}</span>
                          <span className="font-medium text-foreground">{trend.enrolled}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{messages.adminAnalytics.tableHeaders.grades.completed}</span>
                          <span className="font-medium text-[hsl(var(--success))]">
                            {trend.completed}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{messages.adminAnalytics.tableHeaders.grades.dropped}</span>
                          <span className="font-medium text-destructive">{trend.dropped}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </AdminTableCard>
        </div>
      )}
    </AdminFrame>
  );
}
