'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { 
  Calendar, 
  GraduationCap,
  Bell,
  Users,
  Clock,
  BookOpen,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  ChevronRight
} from 'lucide-react';

const menuItems = [
  { 
    href: '/dashboard/lecturer/schedule', 
    icon: Calendar, 
    label: 'Teaching Schedule', 
    description: 'View your weekly timetable',
    color: 'from-blue-500 to-cyan-500'
  },
  { 
    href: '/dashboard/lecturer/grades', 
    icon: GraduationCap, 
    label: 'Grade Management', 
    description: 'Enter and publish student grades',
    color: 'from-emerald-500 to-teal-500'
  },
  { 
    href: '/dashboard/lecturer/announcements', 
    icon: Bell, 
    label: 'Announcements', 
    description: 'Post updates for your courses',
    color: 'from-purple-500 to-pink-500'
  },
];

export default function LecturerDashboardPage() {
  const { user, logout } = useAuth();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium backdrop-blur-sm">
                  Lecturer Portal
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold">
                Welcome, Professor {user?.lastName}! 👨‍🏫
              </h1>
              <p className="text-slate-300 mt-2 text-lg">
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            
            {/* Quick Stats */}
            <div className="flex gap-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 min-w-[100px]">
                <div className="text-3xl font-bold">3</div>
                <div className="text-slate-300 text-sm">Courses</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 min-w-[100px]">
                <div className="text-3xl font-bold">150</div>
                <div className="text-slate-300 text-sm">Students</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 -mt-6">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Link href="/dashboard/lecturer/grades" className="group">
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl p-5 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all group-hover:scale-105">
              <GraduationCap className="w-7 h-7 mb-2" />
              <div className="font-semibold">Submit Grades</div>
              <div className="text-emerald-100 text-sm">Enter student grades</div>
            </div>
          </Link>
          <Link href="/dashboard/lecturer/schedule" className="group">
            <div className="bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl p-5 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all group-hover:scale-105">
              <Calendar className="w-7 h-7 mb-2" />
              <div className="font-semibold">View Schedule</div>
              <div className="text-blue-100 text-sm">Today's classes</div>
            </div>
          </Link>
          <Link href="/dashboard/lecturer/announcements" className="group">
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-5 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all group-hover:scale-105">
              <Bell className="w-7 h-7 mb-2" />
              <div className="font-semibold">Post Announcement</div>
              <div className="text-purple-100 text-sm">Notify students</div>
            </div>
          </Link>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Menu Cards */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Quick Access</h2>
              <div className="space-y-3">
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

            {/* My Courses */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">My Courses This Semester</h2>
              </div>
              
              <div className="space-y-3">
                {[
                  { code: 'CS101', name: 'Introduction to Computer Science', section: 'A', students: 45, schedule: 'Mon, Wed 10:00-12:00' },
                  { code: 'CS201', name: 'Data Structures and Algorithms', section: 'A', students: 35, schedule: 'Tue, Thu 14:00-16:00' },
                  { code: 'CS301', name: 'Database Management Systems', section: 'B', students: 40, schedule: 'Wed, Fri 08:00-10:00' },
                ].map((course, i) => (
                  <div 
                    key={i}
                    className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                      <BookOpen className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-white">
                        {course.code} - {course.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Section {course.section} • {course.schedule}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Users className="w-4 h-4" />
                        <span className="text-sm">{course.students}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Today's Schedule */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Today's Classes</h2>
              <div className="space-y-4">
                {[
                  { time: '10:00 - 12:00', course: 'CS101', room: 'Room 301' },
                  { time: '14:00 - 16:00', course: 'CS201', room: 'Lab 202' },
                ].map((cls, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-16 text-sm font-medium text-gray-500 dark:text-gray-400">{cls.time}</div>
                    <div className="flex-1 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                      <p className="font-medium text-gray-900 dark:text-white text-sm">{cls.course}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{cls.room}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pending Actions */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Pending Actions</h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">Grade Submission</p>
                    <p className="text-gray-500 dark:text-gray-400 text-xs">CS101 midterm grades due in 3 days</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
                  <Bell className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">New Announcement</p>
                    <p className="text-gray-500 dark:text-gray-400 text-xs">Department meeting on Friday</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white">
              <h3 className="font-semibold mb-4">This Month</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Classes Taught</span>
                  <span className="font-semibold">24</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Students</span>
                  <span className="font-semibold">120</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Graded</span>
                  <span className="font-semibold">85%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
