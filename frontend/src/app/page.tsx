'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const { user, isLoading } = useAuth();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <Link href="/" className="text-xl font-bold text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300">
            CampusCore
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {!isLoading && (
              user ? (
                <Link href="/dashboard">
                  <Button>Dashboard</Button>
                </Link>
              ) : (
                <Link href="/login">
                  <Button>Login</Button>
                </Link>
              )
            )}
          </div>
        </div>
      </nav>

      <div className="container mx-auto py-12 px-4">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Welcome to CampusCore</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">Student Portal - Course Registration Platform</p>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/dashboard/register">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2 dark:text-white">Course Registration</h2>
              <p className="text-gray-600 dark:text-gray-400">Browse and enroll in courses for the current semester</p>
            </div>
          </Link>

          <Link href="/dashboard/enrollments">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2 dark:text-white">My Enrollments</h2>
              <p className="text-gray-600 dark:text-gray-400">View your enrolled courses and status</p>
            </div>
          </Link>

          <Link href="/dashboard/grades">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2 dark:text-white">Grades</h2>
              <p className="text-gray-600 dark:text-gray-400">View your grades and academic progress</p>
            </div>
          </Link>

          <Link href="/dashboard/schedule">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2 dark:text-white">Schedule</h2>
              <p className="text-gray-600 dark:text-gray-400">View your weekly class schedule</p>
            </div>
          </Link>

          <Link href="/dashboard/invoices">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2 dark:text-white">Invoices</h2>
              <p className="text-gray-600 dark:text-gray-400">View and pay your tuition invoices</p>
            </div>
          </Link>

          <Link href="/dashboard/announcements">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer">
              <h2 className="text-xl font-semibold mb-2 dark:text-white">Announcements</h2>
              <p className="text-gray-600 dark:text-gray-400">Stay updated with latest announcements</p>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
