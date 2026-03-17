'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  BookOpen, 
  GraduationCap,
  Calendar,
  FileText,
  CreditCard,
  Bell,
  BarChart3,
  Building2,
  DoorOpen,
  School,
  ArrowRight,
  TrendingUp,
  UserPlus,
  BookMarked,
  Clock
} from 'lucide-react';

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
    label: 'User Management', 
    description: 'Manage user accounts, roles, and permissions',
    color: 'from-blue-500 to-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20'
  },
  { 
    href: '/admin/students', 
    icon: GraduationCap, 
    label: 'Students', 
    description: 'Manage student profiles and records',
    color: 'from-emerald-500 to-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20'
  },
  { 
    href: '/admin/lecturers', 
    icon: School, 
    label: 'Lecturers', 
    description: 'Manage lecturer profiles and assignments',
    color: 'from-purple-500 to-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20'
  },
  { 
    href: '/admin/courses', 
    icon: BookOpen, 
    label: 'Courses', 
    description: 'Create and manage courses and curricula',
    color: 'from-amber-500 to-amber-600',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20'
  },
  { 
    href: '/admin/sections', 
    icon: BookMarked, 
    label: 'Sections', 
    description: 'Manage class sections and capacity',
    color: 'from-cyan-500 to-cyan-600',
    bgColor: 'bg-cyan-50 dark:bg-cyan-900/20'
  },
  { 
    href: '/admin/enrollments', 
    icon: FileText, 
    label: 'Enrollments', 
    description: 'View and manage course enrollments',
    color: 'from-indigo-500 to-indigo-600',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/20'
  },
  { 
    href: '/admin/semesters', 
    icon: Calendar, 
    label: 'Semesters', 
    description: 'Manage academic semesters and years',
    color: 'from-rose-500 to-rose-600',
    bgColor: 'bg-rose-50 dark:bg-rose-900/20'
  },
  { 
    href: '/admin/departments', 
    icon: Building2, 
    label: 'Departments', 
    description: 'Manage academic departments',
    color: 'from-teal-500 to-teal-600',
    bgColor: 'bg-teal-50 dark:bg-teal-900/20'
  },
  { 
    href: '/admin/classrooms', 
    icon: DoorOpen, 
    label: 'Classrooms', 
    description: 'Manage rooms and facilities',
    color: 'from-orange-500 to-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20'
  },
  { 
    href: '/admin/analytics', 
    icon: BarChart3, 
    label: 'Analytics', 
    description: 'View campus statistics and insights',
    color: 'from-violet-500 to-violet-600',
    bgColor: 'bg-violet-50 dark:bg-violet-900/20'
  },
  { 
    href: '/admin/invoices', 
    icon: CreditCard, 
    label: 'Invoices', 
    description: 'Manage tuition invoices and payments',
    color: 'from-green-500 to-green-600',
    bgColor: 'bg-green-50 dark:bg-green-900/20'
  },
  { 
    href: '/admin/announcements', 
    icon: Bell, 
    label: 'Announcements', 
    description: 'Create and manage announcements',
    color: 'from-pink-500 to-pink-600',
    bgColor: 'bg-pink-50 dark:bg-pink-900/20'
  },
];

export default function AdminDashboardPage() {
  const { user, logout, isAdmin, isSuperAdmin } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<QuickStats>({
    totalStudents: 0,
    totalLecturers: 0,
    totalCourses: 0,
    totalEnrollments: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user && !isAdmin && !isSuperAdmin) {
      router.push('/dashboard');
    }
  }, [user, isAdmin, isSuperAdmin, router]);

  useEffect(() => {
    if (user && (isAdmin || isSuperAdmin)) {
      fetchStats();
    }
  }, [user, isAdmin, isSuperAdmin]);

  const fetchStats = async () => {
    try {
      const data = await analyticsApi.getOverview();
      setStats({
        totalStudents: data.totalStudents || 0,
        totalLecturers: data.totalLecturers || 0,
        totalCourses: data.totalCourses || 0,
        totalEnrollments: data.totalEnrollments || 0
      });
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user || (!isAdmin && !isSuperAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Students', value: stats.totalStudents, icon: GraduationCap, color: 'from-blue-500 to-cyan-500' },
    { label: 'Total Lecturers', value: stats.totalLecturers, icon: School, color: 'from-purple-500 to-pink-500' },
    { label: 'Total Courses', value: stats.totalCourses, icon: BookOpen, color: 'from-emerald-500 to-teal-500' },
    { label: 'Total Enrollments', value: stats.totalEnrollments, icon: TrendingUp, color: 'from-amber-500 to-orange-500' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
              <p className="text-blue-200 mt-1">Welcome back, {user.firstName}! Here's your campus overview.</p>
            </div>
            <div className="flex items-center gap-3">
              <Button 
                variant="outline" 
                className="border-white/20 text-white hover:bg-white/10"
                onClick={logout}
              >
                Logout
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            {statCards.map((stat, index) => (
              <div 
                key={index}
                className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:bg-white/20 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-200 text-sm">{stat.label}</p>
                    <p className="text-2xl font-bold mt-1">
                      {isLoading ? '...' : stat.value.toLocaleString()}
                    </p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}>
                    <stat.icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Management Console</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Access all administration tools and features</p>
        </div>

        {/* Menu Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {menuItems.map((item, index) => (
            <Link 
              key={index} 
              href={item.href}
              className="group"
            >
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 hover:shadow-xl hover:shadow-gray-500/10 transition-all duration-300">
                <div className="flex items-start justify-between">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    <item.icon className="w-7 h-7 text-white" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:translate-x-1 transition-all" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mt-4 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {item.label}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                  {item.description}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/admin/users" className="group">
            <div className="bg-gradient-to-r from-blue-600 to-cyan-600 rounded-2xl p-6 text-white hover:shadow-xl hover:shadow-blue-500/25 transition-all">
              <UserPlus className="w-8 h-8 mb-3" />
              <h3 className="font-semibold text-lg">Add New User</h3>
              <p className="text-blue-100 text-sm mt-1">Create new student, lecturer, or admin accounts</p>
            </div>
          </Link>
          <Link href="/admin/analytics" className="group">
            <div className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-6 text-white hover:shadow-xl hover:shadow-purple-500/25 transition-all">
              <BarChart3 className="w-8 h-8 mb-3" />
              <h3 className="font-semibold text-lg">View Reports</h3>
              <p className="text-purple-100 text-sm mt-1">Access detailed analytics and insights</p>
            </div>
          </Link>
          <Link href="/admin/announcements" className="group">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 text-white hover:shadow-xl hover:shadow-emerald-500/25 transition-all">
              <Bell className="w-8 h-8 mb-3" />
              <h3 className="font-semibold text-lg">Post Announcement</h3>
              <p className="text-emerald-100 text-sm mt-1">Broadcast messages to users</p>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
