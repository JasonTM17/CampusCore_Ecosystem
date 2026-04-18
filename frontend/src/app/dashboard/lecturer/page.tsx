'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  AlertCircle,
  Bell,
  BookOpen,
  Calendar,
  ChevronRight,
  GraduationCap,
  Users,
} from 'lucide-react';

const menuItems = [
  {
    href: '/dashboard/lecturer/schedule',
    icon: Calendar,
    label: 'Teaching Schedule',
    description: 'View your weekly timetable',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    href: '/dashboard/lecturer/grades',
    icon: GraduationCap,
    label: 'Grade Management',
    description: 'Enter and publish student grades',
    color: 'from-emerald-500 to-teal-500',
  },
  {
    href: '/dashboard/lecturer/announcements',
    icon: Bell,
    label: 'Announcements',
    description: 'Post updates for your courses',
    color: 'from-purple-500 to-pink-500',
  },
];

export default function LecturerDashboardPage() {
  const { user } = useAuth();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="mb-2 inline-flex items-center rounded-full bg-white/20 px-3 py-1 text-sm font-medium backdrop-blur-sm">
                Lecturer Portal
              </h2>
              <h1 className="text-3xl font-bold md:text-4xl">
                Welcome, Professor {user?.lastName}!
              </h1>
              <p className="mt-2 text-lg text-slate-300">
                {currentTime.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>

            <div className="flex gap-4">
              <div className="min-w-[100px] rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
                <div className="text-3xl font-bold">3</div>
                <div className="text-sm text-slate-300">Courses</div>
              </div>
              <div className="min-w-[100px] rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
                <div className="text-3xl font-bold">150</div>
                <div className="text-sm text-slate-300">Students</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="-mt-6 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link href="/dashboard/lecturer/grades" className="group">
            <div className="rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 p-5 text-white shadow-lg shadow-emerald-500/25 transition-all group-hover:scale-105 group-hover:shadow-emerald-500/40">
              <GraduationCap className="mb-2 h-7 w-7" />
              <div className="font-semibold">Submit Grades</div>
              <div className="text-sm text-emerald-100">Enter student grades</div>
            </div>
          </Link>
          <Link href="/dashboard/lecturer/schedule" className="group">
            <div className="rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-500 p-5 text-white shadow-lg shadow-blue-500/25 transition-all group-hover:scale-105 group-hover:shadow-blue-500/40">
              <Calendar className="mb-2 h-7 w-7" />
              <div className="font-semibold">View Schedule</div>
              <div className="text-sm text-blue-100">Today&apos;s classes</div>
            </div>
          </Link>
          <Link href="/dashboard/lecturer/announcements" className="group">
            <div className="rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 p-5 text-white shadow-lg shadow-purple-500/25 transition-all group-hover:scale-105 group-hover:shadow-purple-500/40">
              <Bell className="mb-2 h-7 w-7" />
              <div className="font-semibold">Post Announcement</div>
              <div className="text-sm text-purple-100">Notify students</div>
            </div>
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-2xl border border-gray-100 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
                Quick Access
              </h2>
              <div className="space-y-3">
                {menuItems.map((item) => (
                  <Link key={item.href} href={item.href} className="group">
                    <div className="flex items-center gap-4 rounded-xl border border-gray-100 p-4 transition-all hover:border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-700/50">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${item.color} shadow-lg transition-transform group-hover:scale-110`}
                      >
                        <item.icon className="h-6 w-6 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-gray-900 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                          {item.label}
                        </h3>
                        <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                          {item.description}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400 transition-all group-hover:translate-x-1 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  My Courses This Semester
                </h2>
              </div>

              <div className="space-y-3">
                {[
                  {
                    code: 'CS101',
                    name: 'Introduction to Computer Science',
                    section: 'A',
                    students: 45,
                    schedule: 'Mon, Wed 10:00-12:00',
                  },
                  {
                    code: 'CS201',
                    name: 'Data Structures and Algorithms',
                    section: 'A',
                    students: 35,
                    schedule: 'Tue, Thu 14:00-16:00',
                  },
                  {
                    code: 'CS301',
                    name: 'Database Management Systems',
                    section: 'B',
                    students: 40,
                    schedule: 'Wed, Fri 08:00-10:00',
                  },
                ].map((course) => (
                  <div
                    key={`${course.code}-${course.section}`}
                    className="flex items-center gap-4 rounded-xl bg-gray-50 p-4 transition-colors hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
                      <BookOpen className="h-6 w-6 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-gray-900 dark:text-white">
                        {course.code} - {course.name}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Section {course.section} | {course.schedule}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Users className="h-4 w-4" />
                        <span className="text-sm">{course.students}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
                Today&apos;s Classes
              </h2>
              <div className="space-y-4">
                {[
                  { time: '10:00 - 12:00', course: 'CS101', room: 'Room 301' },
                  { time: '14:00 - 16:00', course: 'CS201', room: 'Lab 202' },
                ].map((session) => (
                  <div key={`${session.time}-${session.course}`} className="flex items-center gap-3">
                    <div className="w-16 text-sm font-medium text-gray-500 dark:text-gray-400">
                      {session.time}
                    </div>
                    <div className="flex-1 rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {session.course}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{session.room}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
                Pending Actions
              </h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      Grade Submission
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      CS101 midterm grades due in 3 days
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <Bell className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      New Announcement
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Department meeting on Friday
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-white">
              <h3 className="mb-4 font-semibold">This Month</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Classes Taught</span>
                  <span className="font-semibold">24</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Students</span>
                  <span className="font-semibold">120</span>
                </div>
                <div className="flex items-center justify-between">
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
