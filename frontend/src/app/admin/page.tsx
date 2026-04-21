'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart3, Bell, BookMarked, BookOpen, Building2, CreditCard, DoorOpen, FileText, GraduationCap, School, TrendingUp, UserPlus, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi } from '@/lib/api';
import { AdminFrame } from '@/components/admin/AdminFrame';
import { AdminMetricCard, AdminTableCard } from '@/components/admin/AdminSurface';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/state-block';

interface QuickStats {
  totalStudents: number;
  totalLecturers: number;
  totalCourses: number;
  totalEnrollments: number;
}

const menuItems = [
  {
    href: '/admin/users',
    icon: Users,
    label: 'User management',
    description: 'Review campus accounts, statuses, and role assignments.',
    tone: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  },
  {
    href: '/admin/lecturers',
    icon: School,
    label: 'Lecturers',
    description: 'Manage lecturer records and academic ownership data.',
    tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  },
  {
    href: '/admin/courses',
    icon: BookOpen,
    label: 'Courses',
    description: 'Maintain catalog structure, codes, and course metadata.',
    tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  },
  {
    href: '/admin/sections',
    icon: BookMarked,
    label: 'Sections',
    description: 'Watch capacity, section ownership, and classroom attachment.',
    tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  },
  {
    href: '/admin/enrollments',
    icon: FileText,
    label: 'Enrollments',
    description: 'Inspect registration outcomes and enrollment-level actions.',
    tone: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-400',
  },
  {
    href: '/admin/semesters',
    icon: GraduationCap,
    label: 'Semesters',
    description: 'Control the academic timeline and current registration window.',
    tone: 'bg-pink-500/12 text-pink-600 dark:text-pink-400',
  },
  {
    href: '/admin/departments',
    icon: Building2,
    label: 'Departments',
    description: 'Manage departmental structure and faculty mappings.',
    tone: 'bg-teal-500/12 text-teal-600 dark:text-teal-400',
  },
  {
    href: '/admin/classrooms',
    icon: DoorOpen,
    label: 'Classrooms',
    description: 'Track rooms, buildings, and capacity readiness.',
    tone: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
  },
  {
    href: '/admin/analytics',
    icon: BarChart3,
    label: 'Analytics',
    description: 'Review operational reporting and top-level data health.',
    tone: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400',
  },
  {
    href: '/admin/invoices',
    icon: CreditCard,
    label: 'Invoices',
    description: 'Handle tuition invoicing, balances, and payment review.',
    tone: 'bg-lime-500/12 text-lime-600 dark:text-lime-400',
  },
  {
    href: '/admin/announcements',
    icon: Bell,
    label: 'Announcements',
    description: 'Publish updates that flow out to the rest of the campus.',
    tone: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
  },
];

export default function AdminDashboardPage() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<QuickStats>({
    totalStudents: 0,
    totalLecturers: 0,
    totalCourses: 0,
    totalEnrollments: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await analyticsApi.getOverview();
      setStats({
        totalStudents: data.totalStudents || 0,
        totalLecturers: data.totalLecturers || 0,
        totalCourses: data.totalCourses || 0,
        totalEnrollments: data.totalEnrollments || 0,
      });
    } catch {
      setError('Campus overview is not available right now.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || (!isAdmin && !isSuperAdmin)) {
      return;
    }

    void fetchStats();
  }, [fetchStats, isAdmin, isSuperAdmin, user]);

  if (!user || (!isAdmin && !isSuperAdmin)) {
    return <LoadingState label="Loading admin workspace" className="m-8" />;
  }

  const statCards = [
    {
      label: 'Students',
      value: stats.totalStudents,
      icon: Users,
      detail: 'People records reachable through the current ownership model.',
      tone: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Lecturers',
      value: stats.totalLecturers,
      icon: School,
      detail: 'Active lecturer accounts and teaching-facing identities.',
      tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    },
    {
      label: 'Courses',
      value: stats.totalCourses,
      icon: BookOpen,
      detail: 'Catalog rows available for section planning and registration.',
      tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Enrollments',
      value: stats.totalEnrollments,
      icon: TrendingUp,
      detail: 'Enrollment rows reflected across academic and analytics views.',
      tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    },
  ];

  return (
    <AdminFrame
      title="Admin dashboard"
      description="Keep the campus workspace aligned across people, academics, finance, and reporting without leaving the admin shell."
      actions={
        <>
          <Button asChild variant="outline">
            <Link href="/admin/users">
              <UserPlus className="mr-2 h-4 w-4" />
              Add user
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/analytics">Open analytics</Link>
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState
          title="Admin overview unavailable"
          description={error}
          onRetry={() => void fetchStats()}
        />
      ) : isLoading ? (
        <LoadingState label="Loading campus overview" />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {statCards.map((stat) => (
              <AdminMetricCard
                key={stat.label}
                label={stat.label}
                value={stat.value.toLocaleString()}
                icon={<stat.icon className="h-5 w-5" />}
                detail={stat.detail}
                toneClassName={stat.tone}
              />
            ))}
          </div>

          <AdminTableCard
            title="Management console"
            description="Jump straight into the workspace that needs attention. Each area keeps the same admin shell, confirmation flow, and route grammar."
            contentClassName="space-y-0"
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {menuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-lg border border-border/70 bg-card px-5 py-5 transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="flex h-full flex-col gap-4">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-lg ${item.tone}`}
                    >
                      <item.icon className="h-5 w-5" />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold text-foreground transition-colors group-hover:text-primary">
                        {item.label}
                      </h3>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    <div className="mt-auto flex items-center gap-2 text-sm font-medium text-primary">
                      <span>Open workspace</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </AdminTableCard>
        </div>
      )}
    </AdminFrame>
  );
}
