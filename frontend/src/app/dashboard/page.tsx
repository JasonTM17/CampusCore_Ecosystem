'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { enrollmentsApi, gradesApi, semestersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { 
  ClipboardList, 
  BookOpen, 
  Calendar, 
  GraduationCap,
  CreditCard,
  Bell,
  FileText,
  ArrowRight,
  Clock,
  TrendingUp,
  BookMarked,
  Award,
  CalendarDays,
  ChevronRight
} from 'lucide-react';

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

interface GradeRecord {
  id: string;
  letterGrade?: string;
}

const menuItems = [
  { 
    href: '/dashboard/register', 
    icon: ClipboardList, 
    label: 'Course Registration', 
    description: 'Browse and enroll in courses',
    color: 'from-blue-500 to-cyan-500'
  },
  { 
    href: '/dashboard/enrollments', 
    icon: BookOpen, 
    label: 'My Courses', 
    description: 'View your enrolled courses',
    color: 'from-emerald-500 to-teal-500'
  },
  { 
    href: '/dashboard/schedule', 
    icon: Calendar, 
    label: 'Schedule', 
    description: 'View your weekly timetable',
    color: 'from-purple-500 to-pink-500'
  },
  { 
    href: '/dashboard/grades', 
    icon: GraduationCap, 
    label: 'Grades', 
    description: 'View your grades and GPA',
    color: 'from-amber-500 to-orange-500'
  },
  { 
    href: '/dashboard/transcript', 
    icon: FileText, 
    label: 'Transcript', 
    description: 'View official transcript',
    color: 'from-indigo-500 to-violet-500'
  },
  { 
    href: '/dashboard/invoices', 
    icon: CreditCard, 
    label: 'Invoices', 
    description: 'View and pay invoices',
    color: 'from-rose-500 to-pink-500'
  },
  { 
    href: '/dashboard/announcements', 
    icon: Bell, 
    label: 'Announcements', 
    description: 'Latest university updates',
    color: 'from-cyan-500 to-blue-500'
  },
];

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [currentSemester, setCurrentSemester] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [semestersRes] = await Promise.all([
        semestersApi.getAll(),
      ]);
      setSemesters(semestersRes.data);
      
      const current = semestersRes.data.find(s => 
        s.status === 'IN_PROGRESS' || s.status === 'ADD_DROP_OPEN' || s.status === 'REGISTRATION_OPEN'
      );
      if (current) {
        setCurrentSemester(current.id);
      }
    } catch (error) {
      console.error('Failed to fetch semesters:', error);
    }
  };

  useEffect(() => {
    if (currentSemester) {
      fetchEnrollments();
    }
  }, [currentSemester]);

  const fetchEnrollments = async () => {
    try {
      const data = await enrollmentsApi.getMyEnrollments(currentSemester || undefined);
      setEnrollments(data);
    } catch (error) {
      console.error('Failed to fetch enrollments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const upcomingCourses = enrollments
    .filter(e => e.status === 'CONFIRMED' || e.status === 'PENDING')
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-cyan-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium backdrop-blur-sm">
                  Student Portal
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold">
                Welcome back, {user?.firstName}! 👋
              </h1>
              <p className="text-blue-100 mt-2 text-lg">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            
            {/* Quick Stats */}
            <div className="flex gap-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 min-w-[120px]">
                <div className="text-3xl font-bold">{enrollments.length}</div>
                <div className="text-blue-100 text-sm">Courses</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 min-w-[120px]">
                <div className="text-3xl font-bold">
                  {enrollments.filter(e => e.status === 'CONFIRMED').length}
                </div>
                <div className="text-blue-100 text-sm">Enrolled</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 -mt-6">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Link href="/dashboard/register" className="group">
            <div className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl p-5 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all group-hover:scale-105">
              <ClipboardList className="w-7 h-7 mb-2" />
              <div className="font-semibold">Register Courses</div>
              <div className="text-blue-100 text-sm">Enroll now</div>
            </div>
          </Link>
          <Link href="/dashboard/schedule" className="group">
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-5 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all group-hover:scale-105">
              <Calendar className="w-7 h-7 mb-2" />
              <div className="font-semibold">View Schedule</div>
              <div className="text-purple-100 text-sm">Today's classes</div>
            </div>
          </Link>
          <Link href="/dashboard/grades" className="group">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-5 text-white shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 transition-all group-hover:scale-105">
              <TrendingUp className="w-7 h-7 mb-2" />
              <div className="font-semibold">Check Grades</div>
              <div className="text-amber-100 text-sm">View GPA</div>
            </div>
          </Link>
          <Link href="/dashboard/invoices" className="group">
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl p-5 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all group-hover:scale-105">
              <CreditCard className="w-7 h-7 mb-2" />
              <div className="font-semibold">Pay Invoices</div>
              <div className="text-emerald-100 text-sm">View bills</div>
            </div>
          </Link>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Menu Cards */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Quick Access</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {menuItems.map((item, index) => (
                  <Link 
                    key={index} 
                    href={item.href}
                    className="group"
                  >
                    <div className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                        <item.icon className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {item.label}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {item.description}
                        </p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:translate-x-1 transition-all" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Current Courses */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Current Courses</h2>
                <Link href="/dashboard/enrollments" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
                  View All <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="animate-pulse flex items-center gap-4 p-4">
                      <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
                      <div className="flex-1">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : upcomingCourses.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-500 dark:text-gray-400">No courses enrolled yet</p>
                  <Link href="/dashboard/register">
                    <Button className="mt-4">Register Courses</Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingCourses.map((enrollment) => (
                    <div 
                      key={enrollment.id}
                      className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                        <BookMarked className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 dark:text-white">
                          {enrollment.section?.course?.code} - {enrollment.section?.course?.name}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Section {enrollment.section?.sectionNumber}
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        enrollment.status === 'CONFIRMED' 
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}>
                        {enrollment.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Upcoming Events */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Upcoming</h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <CalendarDays className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">Midterm Exams</p>
                    <p className="text-gray-500 dark:text-gray-400 text-xs">Next week</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">Course Withdrawal Deadline</p>
                    <p className="text-gray-500 dark:text-gray-400 text-xs">3 days remaining</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">Grade Release</p>
                    <p className="text-gray-500 dark:text-gray-400 text-xs">End of semester</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Announcements Preview */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Announcements</h2>
                <Link href="/dashboard/announcements" className="text-blue-600 hover:text-blue-700 text-sm">
                  View All
                </Link>
              </div>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                  <p className="font-medium text-gray-900 dark:text-white text-sm">Spring 2024 Registration Open</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">2 hours ago</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <p className="font-medium text-gray-900 dark:text-white text-sm">Library Hours Update</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">Yesterday</p>
                </div>
              </div>
            </div>

            {/* Help & Support */}
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white">
              <h3 className="font-semibold mb-2">Need Help?</h3>
              <p className="text-gray-400 text-sm mb-4">Contact the academic office for assistance</p>
              <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10">
                Contact Support
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
